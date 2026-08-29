import Database from 'better-sqlite3'
import { resolveDatabasePath } from './connection'

/**
 * The second connection to `solocrm.db` — opened **readonly**, held apart
 * from the write connection, and the only thing the `db:query` channel can
 * reach (T-260828-39, plan item X-02).
 *
 * ## Why this file is allowed to exist at all
 *
 * AGENTS.md: "the renderer never touches SQLite or the filesystem." This is
 * the closest the app comes to breaking that rule — `db:query` takes a SQL
 * string typed by a human in the renderer — and it holds only because the
 * statement is prepared and stepped **in main, against a connection that
 * cannot write**. That is the whole argument. The renderer still holds no
 * handle, no path, and no way to reach `getDatabase()`; it hands main a
 * string and gets rows back.
 *
 * ## Three independent mechanisms, not one
 *
 * §6.12/X-02 asks for belt and braces because a `^\s*SELECT` regex is not a
 * safeguard: `PRAGMA writable_schema = 1` and `ATTACH DATABASE` both slip
 * past everything a naive text check looks for, and both can destroy the
 * file. So nothing here is decided by looking at the statement *text*:
 *
 * 1. **The connection is opened `readonly: true`** (plus `query_only`), so
 *    SQLite itself refuses a write at step time with `SQLITE_READONLY` —
 *    measured, not assumed: `readonly-connection.test.ts` runs a `DELETE`
 *    straight at this connection, bypassing every check below, and asserts
 *    the error.
 * 2. **`stmt.readonly` must be true.** Checked on the *prepared statement*
 *    (`sqlite3_stmt_readonly`), never on the source string. This is what
 *    catches `DELETE`, `UPDATE`, `INSERT`, `VACUUM` and `ANALYZE`.
 * 3. **`stmt.reader` must be true** — the statement must return a result
 *    set (`sqlite3_column_count() != 0`). This is what catches the two
 *    statements a `readonly` check alone lets through: SQLite deliberately
 *    reports `ATTACH`, `DETACH`, `BEGIN` and a pragma *assignment* such as
 *    `PRAGMA writable_schema = 1` as read-only, because they change
 *    connection configuration rather than file content. They also return no
 *    columns, and that fact — like (2) — is read off the compiled statement
 *    rather than parsed out of the text, so a comment prefix or unusual
 *    whitespace cannot dodge it.
 *
 * Any one of the three failing refuses the statement, and the refusal says
 * which one and why (§6.12: nothing is silently ignored, and nothing is
 * accepted and quietly no-opped).
 *
 * ## The write connection is unreachable from here
 *
 * This module imports exactly one thing from `./connection` —
 * `resolveDatabasePath`, a pure path function that opens nothing — so the
 * write handle is out of reach by construction rather than by discipline.
 * `readonly-connection.test.ts` asserts that structurally, against this
 * file's own source, so a later edit that reaches for `getDatabase()` fails
 * a test rather than a code review.
 */

/** Same value, and the same reasoning, as `connection.ts`'s `BUSY_TIMEOUT_MS`: a read landing mid-write waits briefly instead of throwing `SQLITE_BUSY`. */
const BUSY_TIMEOUT_MS = 5_000

/**
 * How long one statement may run before it is abandoned. `better-sqlite3`
 * is synchronous, so a query that runs long blocks the whole main process —
 * the menu, the window, everything. This is not polish (this task's Risks
 * note); it is the only thing between a mistyped cartesian join and an app
 * that has to be killed.
 */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000

/** How many rows one query may return. A cartesian join over four tables produces millions; serialising them across IPC is its own freeze. */
export const DEFAULT_ROW_LIMIT = 1_000

export interface ReadOnlyConnectionOptions {
  /**
   * Overrides the directory the database is resolved under — tests only,
   * exactly the same discipline (and the same deliberate lack of an
   * env-var fallback) as `connection.ts`'s `OpenDatabaseOptions.userDataDir`.
   * Production always resolves through the real `app.getPath('userData')`,
   * and always through `resolveDatabasePath`, so this connection never
   * becomes the "second, unchecked way to open the database" the AGENTS.md
   * sync-folder gotcha warns about: it opens the exact path the guarded
   * write connection already opened, and it cannot create a file (see
   * `fileMustExist` below).
   */
  userDataDir?: string
}

let handle: Database.Database | null = null

/**
 * Opens the read-only connection. Throws if one is already open, mirroring
 * `openDatabase()` — nothing legitimately needs two of these either.
 *
 * `fileMustExist: true` is deliberate: this connection must never be the
 * thing that brings `solocrm.db` into existence. The write connection is
 * opened at boot, behind the sync-folder guard, and this one only ever
 * attaches to what that already created.
 */
export function openReadOnlyDatabase(options: ReadOnlyConnectionOptions = {}): Database.Database {
  if (handle) {
    throw new Error(
      'openReadOnlyDatabase() called while a read-only connection is already open — call closeReadOnlyDatabase() first'
    )
  }

  const db = new Database(resolveDatabasePath(options), {
    readonly: true,
    fileMustExist: true,
    timeout: BUSY_TIMEOUT_MS
  })

  // Mechanism (1), belt and its own braces. `readonly: true` already opens
  // the file with SQLITE_OPEN_READONLY; `query_only` additionally makes the
  // *connection* refuse anything that would change a database, including a
  // temp or attached one that the readonly file flag would not cover.
  db.pragma('query_only = ON')

  handle = db
  return db
}

/** The read-only connection, opening it on first use. Never returns the write handle — see this file's header. */
export function getReadOnlyDatabase(options: ReadOnlyConnectionOptions = {}): Database.Database {
  return handle ?? openReadOnlyDatabase(options)
}

/**
 * Closes the read-only connection. Safe to call when nothing is open, and
 * called from `electron/main/index.ts`'s `before-quit` *before*
 * `closeDatabase()`: `closeDatabase` checkpoints WAL with `TRUNCATE`, and a
 * second open connection makes that checkpoint fail quietly, leaving
 * committed data in the `-wal` sidecar — the exact outcome `closeDatabase`'s
 * own comment exists to prevent.
 */
export function closeReadOnlyDatabase(): void {
  if (!handle) return
  const db = handle
  handle = null
  db.close()
}

/** One code per way a statement can be refused. A fixed union so a caller branches on `code`, never on the prose in `message` — `db/repositories/errors.ts`'s discipline. */
export const QUERY_REFUSAL_CODES = [
  'empty-statement',
  'invalid-statement',
  'writes-data',
  'no-result-set',
  'bad-parameters',
  'timeout'
] as const

export type QueryRefusalCode = (typeof QUERY_REFUSAL_CODES)[number]

/** A cell as SQLite hands it back with `safeIntegers` off: text, a JS number, `NULL`, or a BLOB. */
export type QueryCell = string | number | bigint | boolean | null | Uint8Array

export interface ReadOnlyQueryResult {
  /**
   * Column names in result order. Rows below are positional arrays keyed by
   * this, not objects: a four-table join names `id` four times, and an
   * object row would silently keep one of them — losing data in exactly the
   * kind of query this channel exists to make possible.
   */
  readonly columns: readonly string[]
  readonly rows: readonly (readonly QueryCell[])[]
  /** How many rows are in `rows` — after truncation, not before. There is no honest "how many were there really" number without running the query to completion, which is the thing the cap exists to avoid. */
  readonly rowCount: number
  /** True when the query had more rows than `rowLimit`. Stated, never silent (this task's Acceptance). */
  readonly truncated: boolean
  readonly rowLimit: number
  readonly durationMs: number
}

export type ReadOnlyQueryOutcome =
  | { readonly ok: true; readonly data: ReadOnlyQueryResult }
  | { readonly ok: false; readonly error: { readonly code: QueryRefusalCode; readonly message: string } }

export type QueryParameters = readonly QueryCell[] | Readonly<Record<string, QueryCell>>

export interface RunReadOnlyQueryOptions extends ReadOnlyConnectionOptions {
  /** Main-side only, and deliberately not part of the IPC request schema — the renderer must not be able to raise its own ceiling. */
  timeoutMs?: number
  /** Same. */
  rowLimit?: number
}

function refuse(code: QueryRefusalCode, message: string): ReadOnlyQueryOutcome {
  return { ok: false, error: { code, message } }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Removes the database's own path from a message before it can reach the
 * renderer. T-260828-09's boundary: the error envelope carries no
 * filesystem path and no stack trace. SQLite's own messages ("no such
 * table: foo", `near "FROM": syntax error`) do not normally contain one,
 * which is exactly why this is here — the day one does must not be the day
 * a user's home directory ships to the renderer.
 */
function scrubPaths(message: string, dbPath: string): string {
  let out = message
  for (const candidate of [dbPath, dbPath.replace(/\\/g, '/')]) {
    if (candidate === '') continue
    out = out.replace(new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<database>')
  }
  return out
}

/** `iterate(...)` takes bind parameters positionally, or a single object for named ones. */
function bindArguments(params: QueryParameters | undefined): unknown[] {
  if (params === undefined) return []
  return Array.isArray(params) ? [...(params as readonly QueryCell[])] : [params]
}

/**
 * Runs one statement against the read-only connection, or refuses it and
 * says why.
 *
 * Refusals come back as *data*, never as a throw: `electron/main/ipc/index.ts`
 * replaces a thrown error's message with a fixed generic sentence, which
 * would turn "refused: this statement modifies the database" into "something
 * went wrong" — the opposite of §6.12's "explicit, and names why". Same
 * reasoning `registry.ts`'s `runMutation` documents for repository refusals.
 *
 * **The timeout's honest limit.** `better-sqlite3` exposes neither
 * `sqlite3_interrupt` nor `sqlite3_progress_handler` (checked against
 * v13.0.3's `lib/` and its typings while building this), so the only place
 * this code regains control mid-query is between rows. The loop below
 * therefore steps the statement one row at a time and abandons it the
 * moment the deadline has passed — which covers the case that actually
 * happens, a join that streams far more rows than anyone meant, and the row
 * cap covers that same case from the other side. What it cannot interrupt
 * is a single `sqlite3_step` that runs long *before* producing its first
 * row (`SELECT count(*)` over a cartesian product). That gap is named here
 * rather than papered over; closing it needs an interrupt binding this
 * dependency does not have.
 */
export function runReadOnlyQuery(
  statementText: string,
  params?: QueryParameters,
  options: RunReadOnlyQueryOptions = {}
): ReadOnlyQueryOutcome {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS
  const rowLimit = options.rowLimit ?? DEFAULT_ROW_LIMIT

  if (statementText.trim() === '') {
    return refuse('empty-statement', 'Refused: no statement was given.')
  }

  const db = getReadOnlyDatabase(options)
  const dbPath = db.name

  let statement: Database.Statement
  try {
    // `prepare` compiles without stepping, so nothing here can take effect
    // before the checks below run. It also refuses a string holding more
    // than one statement, which is what stops `SELECT 1; DELETE FROM x`
    // reaching those checks behind a harmless-looking first half.
    statement = db.prepare(statementText)
  } catch (error) {
    return refuse(
      'invalid-statement',
      `Refused: SQLite could not compile this statement — ${scrubPaths(describe(error), dbPath)}`
    )
  }

  // Mechanism (2). Read off the compiled statement, not the text.
  if (!statement.readonly) {
    return refuse(
      'writes-data',
      'Refused: this statement modifies the database. The query console runs on a read-only connection and accepts only statements that read data, so a DELETE, UPDATE, INSERT, VACUUM or ANALYZE is rejected before it runs — and would be rejected by SQLite itself even if it were not.'
    )
  }

  // Mechanism (3). SQLite reports ATTACH, DETACH, BEGIN and a pragma
  // assignment as read-only because they change connection configuration
  // rather than file content — see this file's header. They also return no
  // columns, and that is what this catches.
  if (!statement.reader) {
    return refuse(
      'no-result-set',
      'Refused: this statement returns no rows, so it is not a query. Statements that change the connection rather than the data — ATTACH, DETACH, BEGIN, or a pragma assignment such as PRAGMA writable_schema = 1 — are rejected here even though SQLite classifies them as read-only.'
    )
  }

  const bind = bindArguments(params)
  const rows: QueryCell[][] = []
  let truncated = false
  const started = performance.now()
  const deadline = started + timeoutMs

  let iterator: IterableIterator<unknown>
  try {
    // `raw(true)`: positional arrays, so a join's repeated column names all
    // survive — see `ReadOnlyQueryResult.columns`.
    iterator = statement.raw(true).iterate(...bind)
  } catch (error) {
    return refuse(
      'bad-parameters',
      `Refused: the statement's bound parameters were not accepted — ${scrubPaths(describe(error), dbPath)}`
    )
  }

  try {
    for (;;) {
      const next = iterator.next()
      if (next.done === true) break
      // Stepped one past the cap on purpose: that is the only way to know
      // whether there *were* more rows, which is what `truncated` reports.
      if (rows.length >= rowLimit) {
        truncated = true
        break
      }
      rows.push(next.value as QueryCell[])
      if (performance.now() > deadline) {
        return refuse(
          'timeout',
          `Refused: the statement was still returning rows after ${timeoutMs}ms and was abandoned. It was cancelled rather than left to freeze the app; narrow it with a WHERE clause or a LIMIT.`
        )
      }
    }
  } catch (error) {
    return refuse('invalid-statement', `Refused: the statement failed while running — ${scrubPaths(describe(error), dbPath)}`)
  } finally {
    // Releases the compiled statement whether the loop finished, hit the
    // cap, timed out or threw; a half-consumed iterator left open keeps the
    // statement busy and its read transaction alive.
    iterator.return?.(undefined)
  }

  return {
    ok: true,
    data: {
      columns: statement.columns().map((column) => column.name),
      rows,
      rowCount: rows.length,
      truncated,
      rowLimit,
      durationMs: performance.now() - started
    }
  }
}
