import { statSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { getSchemaVersion } from './migrate'
import { isPortableLaunch, observePortableLaunch, type PortableLaunchProbe } from './portable'

/**
 * The live facts about `solocrm.db` the Data view shows (T-260828-40, plan
 * item X-01) — size, page size, WAL size, path, journal mode, schema
 * version, and one row count per table.
 *
 * **Everything here is read at call time, from the file.** Nothing is
 * memoised, nothing is captured at boot. X-01's first acceptance criterion
 * exists for a reason this module has to keep honouring: a stale size figure
 * is worse than no figure at all, because it is the number a person checks
 * *because* they suspect something changed. `statSync` runs on every call and
 * so does every `count(*)`; the cost is a handful of milliseconds against a
 * local file, and the alternative is a page that quietly lies.
 *
 * It reads through the write connection (`getDatabase()`), not the read-only
 * console connection: these are the app's own facts about its own file, not
 * a statement a human typed, so none of `readonly-connection.ts`'s three
 * mechanisms apply. Every statement below is a literal in this file — the
 * only interpolated identifiers are table names this module itself read out
 * of `sqlite_master`, quoted through `quoteIdentifier`.
 */

/** One table's name and its current row count. */
export interface TableRowCount {
  readonly name: string
  readonly rowCount: number
}

export interface DatabaseStats {
  /**
   * The absolute path of the open database file, taken from the connection
   * itself rather than re-resolved. Displayed deliberately (X-01: the whole
   * point of the page is that the data is a file you own, and a path you
   * cannot copy is not a file you own) — which is not the same thing as a
   * path leaking through an error envelope, the boundary T-260828-09 draws
   * and `readonly-connection.ts`'s `scrubPaths` keeps.
   */
  readonly path: string
  /**
   * T-260831-06 / ADR-013 Decision 6: whether `path` above is a portable
   * copy's data root — the folder holding the `.exe` the operator launched —
   * rather than this machine's user-data folder.
   *
   * It rides here because `path` already does, and for the same reason: the
   * Data view's whole subject is which file on which machine holds the data,
   * and on a portable launch the honest answer to "where does this live" is
   * not the same sentence. The renderer cannot work this out — it has no
   * filesystem and no business acquiring one (AGENTS.md) — and a path alone
   * does not say it: `D:\SoloCRM\solocrm.db` looks like an ordinary moved
   * data root, and `data-root.ts` reaches the two by entirely different
   * routes.
   *
   * A boolean, not a reason or a probe: this is the answer
   * `isPortableLaunch` already gives, carried, never re-derived. Nothing
   * about the launch beyond that verdict crosses the boundary.
   */
  readonly portable: boolean
  /** `solocrm.db` itself, in bytes. Excludes the `-wal` sidecar — that is `walBytes`. */
  readonly fileBytes: number
  /**
   * The `-wal` sidecar, in bytes, or 0 when there is none. Reported
   * separately rather than folded into `fileBytes`: in WAL mode a
   * just-written row lives in the sidecar until a checkpoint moves it, so a
   * single "database size" that ignored it would fail to move right after
   * the write that prompted someone to look.
   */
  readonly walBytes: number
  readonly pageSize: number
  readonly pageCount: number
  /** `PRAGMA journal_mode` — `wal` for every connection `connection.ts` opens. */
  readonly journalMode: string
  readonly schemaVersion: number
  /** When the newest applied migration ran, or `null` on a database with none. */
  readonly lastMigrationAt: string | null
  /**
   * When the nightly JSON export last ran. Always `null` today: X-04 owns
   * the backup and nothing writes this yet. Present so the view can say
   * "never" plainly rather than omit the fact — this task's Scope: "this
   * page shows when the last one ran".
   */
  readonly lastBackupAt: string | null
  /**
   * The last `PRAGMA integrity_check` X-05 ran, and its verdict. Both
   * `null` today for the same reason as `lastBackupAt`: this page may
   * *display* an integrity result but never runs one — `integrity_check` is
   * a maintenance action, and X-05 owns it.
   */
  readonly lastIntegrityCheckAt: string | null
  readonly lastIntegrityCheckOk: boolean | null
  /** One entry per table, largest first. */
  readonly tables: readonly TableRowCount[]
  /** When this snapshot was taken — the view shows it so "live" is visible rather than claimed. */
  readonly readAt: string
}

/**
 * Quotes a SQLite identifier for interpolation. Every name that reaches this
 * came out of `sqlite_master` on this same connection one statement earlier,
 * so it is not user input — but a `count(*)` per table cannot be a bind
 * parameter (SQLite binds values, never identifiers), so the quoting is
 * written out rather than assumed: doubling an embedded `"` is what makes a
 * table someone created with an odd name a correct query instead of a
 * syntax error.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Bytes of `path`, or 0 when it does not exist — a `-wal` sidecar is absent between checkpoints, which is a size of zero, not a failure. */
function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function pragmaValue(db: Database.Database, pragma: string): unknown {
  return db.pragma(pragma, { simple: true })
}

function pragmaNumber(db: Database.Database, pragma: string): number {
  const value = pragmaValue(db, pragma)
  return typeof value === 'number' ? value : Number(value ?? 0)
}

/**
 * Every table worth counting: the real tables in `main`, minus SQLite's own
 * internal ones and minus each virtual table's shadow tables.
 *
 * The shadow-table exclusion is not cosmetic. `search_fts` (ADR-008) is an
 * FTS5 virtual table, and FTS5 keeps its index in four ordinary tables named
 * `search_fts_data`, `search_fts_idx`, `search_fts_docsize` and
 * `search_fts_config`. They are storage for one table already listed, so
 * showing them as five separate "tables" would both quadruple the apparent
 * table count and invite someone to read a b-tree segment count as a record
 * count. They are found by prefix against the virtual tables actually
 * declared in this database rather than by a hardcoded name list, so a later
 * virtual table's shadows are excluded the day it is added.
 */
function listCountableTables(db: Database.Database): readonly string[] {
  const rows = db
    .prepare(
      `SELECT name, sql, type FROM sqlite_master
        WHERE type IN ('table')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name`
    )
    .all() as { name: string; sql: string | null; type: string }[]

  const virtualTables = rows.filter((row) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql ?? '')).map((row) => row.name)

  return rows
    .map((row) => row.name)
    .filter((name) => !virtualTables.some((virtualName) => name !== virtualName && name.startsWith(`${virtualName}_`)))
}

export interface DatabaseStatsOptions {
  /**
   * Overrides what this process reports about its own launch. Tests only,
   * on exactly the terms `DataRootOptions.portableLaunch` sets: production
   * calls this with no argument and gets `observePortableLaunch()`.
   */
  readonly portableLaunch?: PortableLaunchProbe
}

/** Reads every live fact about the open database. See this module's header on why nothing here is cached. */
export function readDatabaseStats(db: Database.Database, options: DatabaseStatsOptions = {}): DatabaseStats {
  const path = db.name
  const { version, lastMigrationAt } = getSchemaVersion(db)

  const tables = listCountableTables(db)
    .map((name) => ({
      name,
      rowCount: (db.prepare(`SELECT count(*) AS n FROM ${quoteIdentifier(name)}`).get() as { n: number }).n
    }))
    .sort((a, b) => b.rowCount - a.rowCount || a.name.localeCompare(b.name))

  return {
    path,
    // Read live, like everything else here, and through the one predicate
    // (ADR-013 Decision 2) rather than by inspecting `path` — a portable
    // root and a pointed-at data root are indistinguishable as strings, and
    // a second answer to this question is exactly what that decision exists
    // to make unnecessary.
    portable: isPortableLaunch(options.portableLaunch ?? observePortableLaunch()),
    fileBytes: fileSize(path),
    walBytes: fileSize(`${path}-wal`),
    pageSize: pragmaNumber(db, 'page_size'),
    pageCount: pragmaNumber(db, 'page_count'),
    journalMode: String(pragmaValue(db, 'journal_mode') ?? ''),
    schemaVersion: version,
    lastMigrationAt,
    // X-04 and X-05 own these; nothing writes them yet, and inventing a
    // value here would be the page's one dishonest number.
    lastBackupAt: null,
    lastIntegrityCheckAt: null,
    lastIntegrityCheckOk: null,
    tables,
    readAt: new Date().toISOString()
  }
}
