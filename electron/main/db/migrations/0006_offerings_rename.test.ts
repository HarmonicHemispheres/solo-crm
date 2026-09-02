import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { runMigrations } from '../migrate'
import { seedFixture } from '../seed'
import { MIGRATIONS, type MigrationDefinition } from './index'

/**
 * T-260829-10's gate. A rename migration looks free and is not: the failure
 * mode is silent, not loud. A table renamed while a foreign-key reference to
 * it is left pointing at the old name leaves a database that opens, reads,
 * and only fails when something walks the relationship — so the check that
 * matters has to run against a **migrated database that already holds rows**,
 * not a fresh one where there is nothing left to orphan.
 *
 * Every connection goes through `openDatabase`/`getDatabase`, never a
 * directly-constructed better-sqlite3 handle: `connection.test.ts`'s "single
 * owner of the SQLite connection" test walks every `.ts` file under
 * `electron/` for that construction, this file included.
 */

const RENAME_VERSION = 6

const MIGRATIONS_BEFORE_RENAME: readonly MigrationDefinition[] = MIGRATIONS.filter(
  (m) => m.version < RENAME_VERSION
)

const RENAME_MIGRATION: MigrationDefinition = (() => {
  const found = MIGRATIONS.find((m) => m.version === RENAME_VERSION)
  if (!found) throw new Error(`MIGRATIONS is missing migration version ${RENAME_VERSION}`)
  return found
})()

afterEach(() => {
  closeDatabase()
})

/**
 * Opens a database migrated to the version immediately *before* the rename —
 * the state a real installation is in when it picks up this release — runs
 * `fn` against it, and cleans up. The rename itself is applied by the test
 * body, so each test can assert what was true either side of it.
 */
function withPreRenameDb<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-0006-'))
  try {
    openDatabase({ userDataDir: tmpDir, migrations: MIGRATIONS_BEFORE_RENAME })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** Applies the rename to an already-open database, exactly as a real boot would. */
function applyRename(db: Database.Database): void {
  runMigrations(db, [...MIGRATIONS_BEFORE_RENAME, RENAME_MIGRATION])
}

const T = '2026-08-29T10:00:00.000Z'

/**
 * Rows in the *old* shape, written with the *old* names — the fixture the
 * migration has to carry across. Deliberately not `seedFixture`: that loader
 * writes `INSERT INTO offerings …`, which is the post-rename spelling and so
 * cannot exist in a pre-rename database. The shape matters more than the
 * volume — one category, two offerings, three versions, and three engagements
 * of which one deliberately holds a NULL reference.
 */
function seedPreRenameRows(db: Database.Database): void {
  db.prepare(
    `INSERT INTO service_categories (id, name, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run('cat-1', 'Audits', '#C9A84C', 0, T, T)

  const insertService = db.prepare(
    `INSERT INTO services (id, name, type, category_id, billing_model, unit, blurb, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insertService.run('svc-1', 'Discovery Audit', 'service', 'cat-1', 'fixed', 'fixed', 'Map a business.', 1, T, T)
  insertService.run('svc-2', 'Advisory Retainer', 'service', 'cat-1', 'retainer', 'mo', 'Ongoing advice.', 1, T, T)

  const insertVersion = db.prepare(
    `INSERT INTO service_versions (id, service_id, version, rate_cents, effective_from, effective_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insertVersion.run('ver-1', 'svc-1', 1, 350_000, '2026-01-01', '2026-06-30', T, T)
  insertVersion.run('ver-2', 'svc-1', 2, 450_000, '2026-07-01', null, T, T)
  insertVersion.run('ver-3', 'svc-2', 1, 650_000, '2026-03-01', null, T, T)

  const insertEngagement = db.prepare(
    `INSERT INTO engagements (id, name, service_version_id, agreed_rate_cents, billing_model, status, started_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insertEngagement.run('eng-1', 'Audit for Rinvii', 'ver-2', 450_000, 'fixed', 'active', '2026-07-05', T, T)
  insertEngagement.run('eng-2', 'Retainer for Rinvii', 'ver-3', 650_000, 'retainer', 'active', '2026-03-01', T, T)
  // The one engagement sold from no offering at all: a NULL foreign key must
  // survive as NULL, not become a dangling non-NULL or a refused row.
  insertEngagement.run('eng-3', 'Equity advisory', null, null, 'equity', 'active', '2026-05-01', T, T)
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

function ddl(db: Database.Database, name: string): string {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name) as { sql: string } | undefined
  if (!row) throw new Error(`no sqlite_master entry for ${name}`)
  return row.sql
}

describe('0006_offerings_rename: a database with data survives the rename', () => {
  it('preserves every row and every relationship, and leaves no dangling foreign key', () => {
    withPreRenameDb((db) => {
      seedPreRenameRows(db)

      const before = {
        categories: count(db, 'service_categories'),
        offerings: count(db, 'services'),
        versions: count(db, 'service_versions'),
        engagements: count(db, 'engagements'),
        // (engagement id, version id) pairs, so a relationship that survives
        // as a *different* pairing fails as loudly as one that vanishes.
        pairs: db
          .prepare(`SELECT id, service_version_id FROM engagements ORDER BY id`)
          .all() as { id: string; service_version_id: string | null }[]
      }
      expect(before.categories).toBe(1)
      expect(before.offerings).toBe(2)
      expect(before.versions).toBe(3)
      expect(before.engagements).toBe(3)

      applyRename(db)

      expect(count(db, 'offering_categories')).toBe(before.categories)
      expect(count(db, 'offerings')).toBe(before.offerings)
      expect(count(db, 'offering_versions')).toBe(before.versions)
      expect(count(db, 'engagements')).toBe(before.engagements)

      const after = db
        .prepare(`SELECT id, offering_version_id FROM engagements ORDER BY id`)
        .all() as { id: string; offering_version_id: string | null }[]
      expect(after.map((r) => ({ id: r.id, version: r.offering_version_id }))).toEqual(
        before.pairs.map((r) => ({ id: r.id, version: r.service_version_id }))
      )

      // Every non-NULL reference still resolves to a row that exists. A LEFT
      // JOIN rather than `foreign_key_check` alone: this is the assertion that
      // the *data* is intact, not just that the DDL parses.
      const orphans = db
        .prepare(
          `SELECT e.id FROM engagements e
             LEFT JOIN offering_versions v ON v.id = e.offering_version_id
            WHERE e.offering_version_id IS NOT NULL AND v.id IS NULL`
        )
        .all() as { id: string }[]
      expect(orphans).toEqual([])

      const versionOrphans = db
        .prepare(
          `SELECT ov.id FROM offering_versions ov
             LEFT JOIN offerings o ON o.id = ov.offering_id
            WHERE ov.offering_id IS NOT NULL AND o.id IS NULL`
        )
        .all() as { id: string }[]
      expect(versionOrphans).toEqual([])
    })
  })

  it('leaves PRAGMA foreign_key_check empty on a database that holds rows', () => {
    withPreRenameDb((db) => {
      seedPreRenameRows(db)
      applyRename(db)
      // The whole-database form, not `foreign_key_check(engagements)`: a
      // rename that repointed some *other* table's reference is exactly the
      // failure this migration is being asked to avoid.
      expect(db.pragma('foreign_key_check')).toEqual([])
    })
  })

  it("rewrites the referencing DDL: engagements names offering_versions, not service_versions", () => {
    withPreRenameDb((db) => {
      seedPreRenameRows(db)
      applyRename(db)

      const engagementsDdl = ddl(db, 'engagements')
      expect(engagementsDdl).toContain('offering_version_id')
      expect(engagementsDdl).toContain('offering_versions')
      expect(engagementsDdl).not.toContain('service_version')

      const versionsDdl = ddl(db, 'offering_versions')
      expect(versionsDdl).toContain('offering_id')
      expect(versionsDdl).toContain('offerings')
      expect(versionsDdl).not.toContain('service_id')

      const offeringsDdl = ddl(db, 'offerings')
      expect(offeringsDdl).toContain('offering_categories')
      expect(offeringsDdl).not.toContain('service_categories')
    })
  })

  it('a write through the renamed foreign key is still enforced afterwards', () => {
    withPreRenameDb((db) => {
      seedPreRenameRows(db)
      applyRename(db)

      // Enforcement, not just shape: `migrate.ts` turns foreign keys off
      // around each migration and back on after, so a rename that produced a
      // DDL naming a table that does not exist would show up here as an
      // accepted bad write rather than as a rejected one.
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(() =>
        db
          .prepare(
            `INSERT INTO engagements (id, name, offering_version_id, started_on, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run('eng-bad', 'Sold from nothing', 'no-such-version', '2026-08-01', T, T)
      ).toThrow(/FOREIGN KEY constraint failed/i)
    })
  })

  it('the old names are gone', () => {
    withPreRenameDb((db) => {
      seedPreRenameRows(db)
      applyRename(db)
      const names = (
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
      ).map((r) => r.name)
      expect(names).toEqual(expect.arrayContaining(['offering_categories', 'offerings', 'offering_versions']))
      expect(names).not.toContain('service_categories')
      expect(names).not.toContain('services')
      expect(names).not.toContain('service_versions')
    })
  })

  it('the dev seed loads into a database that reached the new names by migration, not only into a fresh one', () => {
    withPreRenameDb((db) => {
      // No pre-rename rows here: `seedFixture` refuses a database that already
      // holds any row it writes, and that guard is not what this asserts. The
      // point is that the loader's `INSERT INTO offerings …` finds the same
      // tables in a migrated database as in a freshly created one —
      // `seed/index.test.ts` covers the fresh case.
      //
      // The *whole* migration set, not `applyRename`'s prefix ending at 6.
      // `seedFixture` is written against the current schema by definition, so
      // running it at an arbitrary older version asserts nothing about the
      // rename and breaks the moment any later migration adds a column the
      // seed writes — which 0008 (`retainer_basis`) did. What this test is
      // actually about is that the database *reached* today's schema through
      // the rename rather than by being created fresh, and that is exactly
      // what starting from `withPreRenameDb` and applying everything gives.
      runMigrations(db, MIGRATIONS)
      expect(() => seedFixture(db)).not.toThrow()
      expect(count(db, 'offerings')).toBe(9)
      expect(count(db, 'offering_categories')).toBe(5)
      expect(db.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('records itself in schema_migrations exactly once, and is not re-applied', () => {
    withPreRenameDb((db) => {
      seedPreRenameRows(db)
      applyRename(db)
      // A second boot must be a no-op: re-running `ALTER TABLE service_versions
      // RENAME TO offering_versions` against an already-renamed database would
      // throw "no such table", so the runner's bookkeeping is load-bearing here
      // in a way it was not for 0001-0005.
      expect(() => applyRename(db)).not.toThrow()
      const rows = db
        .prepare(`SELECT version FROM schema_migrations WHERE version = ?`)
        .all(RENAME_VERSION) as { version: number }[]
      expect(rows).toHaveLength(1)
    })
  })
})
