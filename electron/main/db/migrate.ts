import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../shared/format'
import { MIGRATIONS, type MigrationDefinition } from './migrations'

/**
 * The runtime migration runner (T-260828-07's `migrate.ts`). Deliberately
 * not drizzle-orm's own `migrate()` helper: that helper's bookkeeping table
 * stores an epoch-millisecond `created_at`, which conflicts with
 * CONVENTIONS.md's rule everywhere else in this app — timestamps are
 * ISO-8601 UTC `TEXT`, written from JS via `nowTimestamp()`, never a
 * SQLite-computed value. This runner keeps its own `schema_migrations`
 * table instead, written the same way every other timestamp in the app is,
 * and shaped for what X-01 needs to display (a version number and a date).
 *
 * Each pending migration is applied in its **own** transaction
 * (`db.transaction`, which better-sqlite3 rolls back automatically on a
 * thrown error) rather than batching every pending migration for this boot
 * into one transaction. That means a migration that throws leaves the
 * database at the version immediately before it — not at whatever version
 * the boot started from — and every migration that already committed
 * earlier in the same boot stays committed. Only migration 0001 exists
 * today, so the difference between "per-migration" and "whole-batch"
 * transactions is inert until a second migration lands; `migrate.test.ts`
 * locks in the per-migration behaviour now, with a synthetic second
 * migration, so it cannot regress unnoticed later.
 *
 * `foreign_keys` is toggled off immediately before each migration's
 * `BEGIN` and back on immediately after — `PRAGMA foreign_keys` is a
 * no-op inside a transaction (T-260828-05's outcome, carried forward as
 * this task's own Risks note), so the toggle has to sit outside the
 * function passed to `db.transaction()`, never inside it. Migration 0001 is
 * pure `CREATE TABLE` and never needed foreign keys off, but a later
 * migration using SQLite's rebuild-the-table pattern to alter a column
 * will, and getting the toggle right once here means that migration does
 * not have to reinvent it.
 */

const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations'

/**
 * Bookkeeping only — not part of requirements §5's data model, so it is
 * deliberately outside `schema.ts` and outside `pragma_table_info`'s
 * UUID-plus-timestamps assertion in `schema.test.ts` (alongside `settings`
 * and `favicons`, but for a different reason: this table is infrastructure
 * the runner owns, not a domain table the requirements describe). Created
 * imperatively, before any migration file runs, because the runner has to
 * be able to answer "is migration 0001 already applied?" before migration
 * 0001 itself has had a chance to run.
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

function appliedVersions(db: Database.Database): Set<number> {
  const rows = db.prepare(`SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE}`).all() as { version: number }[]
  return new Set(rows.map((row) => row.version))
}

/**
 * Applies every migration in `migrations` (default: the real, checked-in
 * set from `./migrations`) not yet recorded in `schema_migrations`, in
 * ascending `version` order. Safe to call on every boot: with nothing
 * pending it does one `SELECT` and returns. A migration that throws stops
 * the run — later pending migrations are not attempted — and propagates the
 * error to the caller (`connection.ts`'s `openDatabase`), which treats it
 * like any other startup failure.
 *
 * `migrations` is overridable for tests only (mirroring
 * `OpenDatabaseOptions.userDataDir`'s existing pattern): production code
 * never passes it, so a test's synthetic migration set can never leak into
 * a real boot.
 */
export function runMigrations(db: Database.Database, migrations: readonly MigrationDefinition[] = MIGRATIONS): void {
  ensureMigrationsTable(db)
  const applied = appliedVersions(db)
  const pending = [...migrations]
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    db.pragma('foreign_keys = OFF')
    try {
      const applyMigration = db.transaction(() => {
        db.exec(migration.sql)
        db.prepare(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`).run(
          migration.version,
          migration.name,
          nowTimestamp()
        )
      })
      applyMigration()
    } finally {
      // Restored even on failure: a throwing migration must not leave the
      // connection with foreign-key enforcement silently off for whatever
      // runs next (T-260828-05's pragma is per-connection, so nothing else
      // will turn this back on).
      db.pragma('foreign_keys = ON')
    }
  }
}

export interface SchemaVersionInfo {
  /** The highest applied migration's version, or 0 if none has run. */
  readonly version: number
  /** ISO-8601 UTC timestamp the highest applied migration ran at, or null if none has run. */
  readonly lastMigrationAt: string | null
}

/**
 * Readable from main for X-01 ("schema version and last migration date").
 * Both fields come from the same row (`ORDER BY version DESC LIMIT 1`)
 * rather than independent `MAX(version)` / `MAX(applied_at)` aggregates, so
 * they can never describe two different migrations.
 */
export function getSchemaVersion(db: Database.Database): SchemaVersionInfo {
  ensureMigrationsTable(db)
  const row = db
    .prepare(`SELECT version, applied_at FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version DESC LIMIT 1`)
    .get() as { version: number; applied_at: string } | undefined
  return row ? { version: row.version, lastMigrationAt: row.applied_at } : { version: 0, lastMigrationAt: null }
}
