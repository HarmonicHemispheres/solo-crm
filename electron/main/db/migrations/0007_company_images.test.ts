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
 * T-260901-08's gate on the migration itself, as distinct from the repository
 * that uses it. A new table looks free and mostly is; what is not free is the
 * foreign key it brings, because this is the schema's **first** `ON DELETE
 * cascade` and a cascade is a thing that deletes rows. So the checks that
 * matter run against a migrated database that already holds data — the state a
 * real installation is in when it picks up this release — rather than against
 * a fresh one where there is nothing left to lose.
 *
 * Every connection goes through `openDatabase`/`getDatabase`, never a
 * directly-constructed better-sqlite3 handle: `connection.test.ts`'s "single
 * owner of the SQLite connection" test walks every `.ts` file under
 * `electron/` for that construction, this file included.
 */

const COMPANY_IMAGES_VERSION = 7

const MIGRATIONS_BEFORE: readonly MigrationDefinition[] = MIGRATIONS.filter((m) => m.version < COMPANY_IMAGES_VERSION)

afterEach(() => {
  closeDatabase()
})

let tmpDir: string | null = null

/** Opens a database migrated to the version immediately *before* this one. The migration itself is applied by the test body. */
function withPreMigrationDb<T>(fn: (db: Database.Database) => T): T {
  tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-0007-'))
  try {
    openDatabase({ userDataDir: tmpDir, migrations: MIGRATIONS_BEFORE })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = null
  }
}

function applyCompanyImages(db: Database.Database): void {
  runMigrations(db, MIGRATIONS)
}

function domainTableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return rows.map((r) => r.name).filter((name) => name !== 'schema_migrations')
}

/** Every domain table's row count, so "nothing moved" is asserted over the whole database rather than over the tables someone remembered. */
function rowCounts(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const table of domainTableNames(db)) {
    counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n
  }
  return counts
}

const T = '2026-09-01T10:00:00.000Z'

describe('0007_company_images: a database with data survives it', () => {
  it('adds the table to a seeded database and moves not one existing row', () => {
    withPreMigrationDb((db) => {
      seedFixture(db)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'company_images'").get()).toBeUndefined()

      const before = rowCounts(db)
      // The fixture is not empty — otherwise "unchanged" would be vacuous.
      expect(before.companies).toBeGreaterThan(0)
      expect(before.engagements).toBeGreaterThan(0)

      applyCompanyImages(db)

      const after = rowCounts(db)
      expect(after.company_images).toBe(0)
      delete after.company_images
      expect(after).toEqual(before)
      expect(db.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('records itself once, and a second run of the whole set is a no-op', () => {
    withPreMigrationDb((db) => {
      seedFixture(db)
      applyCompanyImages(db)
      const appliedOnce = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
      expect(appliedOnce).toContainEqual({ version: COMPANY_IMAGES_VERSION, name: '0007_company_images' })

      // `CREATE TABLE company_images` against a database that already has it
      // would throw, so the runner's bookkeeping is what makes this a no-op —
      // the idempotence property 0006's test asserts for its own case.
      expect(() => applyCompanyImages(db)).not.toThrow()
      expect(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual(appliedOnce)
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = ?').get(COMPANY_IMAGES_VERSION)
      ).toEqual({ n: 1 })
    })
  })

  it('leaves foreign keys enforced afterwards, so the new one is real rather than decorative', () => {
    withPreMigrationDb((db) => {
      applyCompanyImages(db)

      // `migrate.ts` turns foreign keys off around each migration and back on
      // after; a table whose DDL named something that does not exist would
      // show up here as an accepted bad write rather than a rejected one.
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(() =>
        db
          .prepare(
            'INSERT INTO company_images (id, company_id, slot, content_type, byte_length, width, height, ' +
              'created_at, updated_at, thumb_content_type, thumb_byte_length, thumb_bytes, bytes) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run('orphan', 'no-such-co', 'logo', 'image/png', 1, 1, 1, T, T, 'image/png', 1, Buffer.from([1]), Buffer.from([1]))
      ).toThrow(/FOREIGN KEY constraint failed/i)
    })
  })

  it('cascades on a company deleted after the migration, counted rather than read off the DDL', () => {
    withPreMigrationDb((db) => {
      db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        'pre-images-co',
        'Pre Images Co',
        T,
        T
      )
      db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        'keeper-co',
        'Keeper Co',
        T,
        T
      )

      applyCompanyImages(db)

      const insert = db.prepare(
        'INSERT INTO company_images (id, company_id, slot, content_type, byte_length, width, height, ' +
          'created_at, updated_at, thumb_content_type, thumb_byte_length, thumb_bytes, bytes) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      insert.run('img-1', 'pre-images-co', 'logo', 'image/png', 1, 1, 1, T, T, 'image/png', 1, Buffer.from([1]), Buffer.from([1]))
      insert.run('img-2', 'pre-images-co', 'banner', 'image/jpeg', 1, 1, 1, T, T, 'image/jpeg', 1, Buffer.from([1]), Buffer.from([1]))
      insert.run('img-3', 'keeper-co', 'logo', 'image/png', 1, 1, 1, T, T, 'image/png', 1, Buffer.from([1]), Buffer.from([1]))

      db.prepare('DELETE FROM companies WHERE id = ?').run('pre-images-co')

      const remaining = db.prepare('SELECT company_id FROM company_images ORDER BY id').all() as {
        company_id: string
      }[]
      expect(remaining).toEqual([{ company_id: 'keeper-co' }])
      expect(db.pragma('foreign_key_check')).toEqual([])
    })
  })

  it('the dev seed still loads into a database that reached this version by migration', () => {
    withPreMigrationDb((db) => {
      applyCompanyImages(db)
      expect(() => seedFixture(db)).not.toThrow()
      expect(db.prepare('SELECT COUNT(*) AS n FROM company_images').get()).toEqual({ n: 0 })
      expect(db.pragma('foreign_key_check')).toEqual([])
    })
  })
})
