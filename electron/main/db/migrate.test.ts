import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from './connection'
import { getSchemaVersion, runMigrations } from './migrate'
import { MIGRATIONS, type MigrationDefinition } from './migrations'

/**
 * Covers the migration runner's own mechanics. Goes through `openDatabase`/
 * `getDatabase` (rather than constructing a better-sqlite3 handle directly)
 * for every connection, the same as `connection.test.ts` and for the same
 * reason: `connection.test.ts`'s "single owner of the SQLite connection"
 * test walks every `.ts` file under `electron/` for the literal
 * constructor call this file would otherwise make, and a test file is not
 * exempt from that invariant just because it is a test file.
 * `schema.test.ts` covers the resulting domain schema's shape;
 * `connection.test.ts` covers `openDatabase()` itself calling this runner
 * and cleaning up after a migration failure.
 */

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function dumpSchema(db: Database.Database): unknown[] {
  return db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name, type").all()
}

afterEach(() => {
  closeDatabase()
})

describe('runMigrations: fresh vs replayed schema identity', () => {
  it('two independently opened databases end up with an identical sqlite_master dump', () => {
    const dirA = makeTmpDir('solo-crm-migrate-fresh-a-')
    const dirB = makeTmpDir('solo-crm-migrate-fresh-b-')
    try {
      openDatabase({ userDataDir: dirA })
      const dumpA = dumpSchema(getDatabase())
      closeDatabase()

      openDatabase({ userDataDir: dirB })
      const dumpB = dumpSchema(getDatabase())
      closeDatabase()

      expect(dumpA).toEqual(dumpB)
      expect(dumpA.length).toBeGreaterThan(0)
    } finally {
      closeDatabase()
      rmSync(dirA, { recursive: true, force: true })
      rmSync(dirB, { recursive: true, force: true })
    }
  })

  it('one-shot and incremental application of the same sequence produce an identical sqlite_master dump', () => {
    // The acceptance criterion proper: a database built fresh in one run
    // must match one migrated incrementally across separate boots — the
    // two-fresh-databases test above only proves determinism of a single
    // code path (T-260828-07 review, should-fix 1).
    const oneShotDir = makeTmpDir('solo-crm-migrate-oneshot-')
    const incrementalDir = makeTmpDir('solo-crm-migrate-incremental-')
    const synthetic: MigrationDefinition = {
      version: 2,
      name: 'test_add_marker_column',
      sql: 'ALTER TABLE companies ADD COLUMN test_marker TEXT;'
    }
    try {
      openDatabase({ userDataDir: oneShotDir, migrations: [...MIGRATIONS, synthetic] })
      const oneShotDump = dumpSchema(getDatabase())
      closeDatabase()

      // Incremental: 0001 lands, the app "quits", a later boot applies the
      // next migration to the existing file.
      openDatabase({ userDataDir: incrementalDir })
      closeDatabase()
      openDatabase({ userDataDir: incrementalDir, migrations: [...MIGRATIONS, synthetic] })
      const incrementalDump = dumpSchema(getDatabase())
      closeDatabase()

      expect(incrementalDump).toEqual(oneShotDump)
      expect(oneShotDump.length).toBeGreaterThan(0)
      expect(JSON.stringify(oneShotDump)).toContain('test_marker')
    } finally {
      closeDatabase()
      rmSync(oneShotDir, { recursive: true, force: true })
      rmSync(incrementalDir, { recursive: true, force: true })
    }
  })

  it('re-running the migrator against an already-migrated connection is a no-op, not a duplication', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-replay-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      const dumpBefore = dumpSchema(db)

      // "Replay" the migrator twice more against the same, already-migrated
      // connection — nothing pending either time, must not error or alter
      // the schema.
      runMigrations(db)
      runMigrations(db)

      expect(dumpSchema(db)).toEqual(dumpBefore)
      expect(getSchemaVersion(db).version).toBe(1)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('runMigrations: applies cleanly to a populated copy', () => {
  it('a later migration succeeds against a database that already holds rows, and the rows survive', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-populated-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()

      const now = '2026-08-28T10:15:00.000Z'
      db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        'company-1',
        'EZDeploy',
        now,
        now
      )
      db.prepare(
        'INSERT INTO engagements (id, name, started_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('engagement-1', 'Advisory retainer', '2026-01-01', now, now)

      const secondMigration: MigrationDefinition = {
        version: 2,
        name: 'test_add_marker_column',
        sql: 'ALTER TABLE companies ADD COLUMN test_marker TEXT;'
      }
      runMigrations(db, [...MIGRATIONS, secondMigration])

      expect(getSchemaVersion(db).version).toBe(2)
      const company = db.prepare('SELECT id, name, test_marker FROM companies WHERE id = ?').get('company-1') as {
        id: string
        name: string
        test_marker: string | null
      }
      expect(company).toEqual({ id: 'company-1', name: 'EZDeploy', test_marker: null })
      const engagement = db.prepare('SELECT id FROM engagements WHERE id = ?').get('engagement-1')
      expect(engagement).toBeDefined()
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('runMigrations: a throwing migration', () => {
  it('leaves the database at its previous version, with no partial application', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-throw-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      expect(getSchemaVersion(db).version).toBe(1)

      const breakingMigration: MigrationDefinition = {
        version: 2,
        name: 'test_broken',
        // The first statement succeeds in isolation; the second is invalid
        // SQL. Proven by hand (outside this suite) that without a shared
        // transaction the first statement's table would survive the
        // second's failure — this test's second assertion is what would
        // catch that regressing.
        sql: 'CREATE TABLE test_partial (id TEXT PRIMARY KEY); THIS IS NOT VALID SQL;'
      }

      expect(() => runMigrations(db, [...MIGRATIONS, breakingMigration])).toThrow()

      expect(getSchemaVersion(db).version).toBe(1)
      const partialTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_partial'")
        .get()
      expect(partialTable).toBeUndefined()
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('does not attempt a migration after the one that threw', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-throw-stop-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()

      const breaking: MigrationDefinition = { version: 2, name: 'test_broken', sql: 'THIS IS NOT VALID SQL;' }
      const wouldFollow: MigrationDefinition = {
        version: 3,
        name: 'test_would_follow',
        sql: 'CREATE TABLE test_should_not_exist (id TEXT PRIMARY KEY);'
      }

      expect(() => runMigrations(db, [...MIGRATIONS, breaking, wouldFollow])).toThrow()

      expect(getSchemaVersion(db).version).toBe(1)
      const followTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'test_should_not_exist'")
        .get()
      expect(followTable).toBeUndefined()
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('getSchemaVersion', () => {
  it('reads 0 and null before any migration has run', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-version-none-')
    try {
      openDatabase({ userDataDir: tmpDir, migrations: [] })
      expect(getSchemaVersion(getDatabase())).toEqual({ version: 0, lastMigrationAt: null })
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('reads the applied version and an ISO-8601 UTC applied_at after migration 0001 runs', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-version-applied-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const info = getSchemaVersion(getDatabase())
      expect(info.version).toBe(1)
      expect(info.lastMigrationAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('migration 0001 excludes search_fts (G6 / P1-06 owns it)', () => {
  it('creates no search_fts table and no trigger', () => {
    const tmpDir = makeTmpDir('solo-crm-migrate-no-fts-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      const ftsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_fts'").get()
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()
      expect(ftsTable).toBeUndefined()
      expect(triggers).toEqual([])
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
