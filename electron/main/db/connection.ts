import { join } from 'node:path'
import Database from 'better-sqlite3'
import { resolveDataRoot } from './data-root'
import { runMigrations } from './migrate'
import type { MigrationDefinition } from './migrations'
import { assertPathOutsideSyncFolder } from './sync-folder-guard'

/**
 * The single owner of the SQLite connection. AGENTS.md: "the renderer never
 * touches SQLite or the filesystem"; the main-process half of that boundary
 * is that only this file imports `better-sqlite3` as a value and only this
 * file calls `new Database(...)`. Repositories (later tasks) reach the
 * connection through `getDatabase()`, never by opening the file themselves —
 * `connection.test.ts` asserts that structurally, not just by convention.
 */

/**
 * The one definition of the database's filename in the main process
 * (T-260828-57's first Acceptance line: grepping for it finds exactly one
 * definition). It was private until the first-run chooser needed the same
 * value and copied it instead — two constants, and the safety property
 * "an existing install is never prompted" resting on them staying equal.
 * It stays private, because the fix is not a shared constant every caller
 * joins for itself — it is that nobody builds this path by hand. Everything
 * asks `databasePathIn` or `resolveDatabasePath` below.
 */
const DB_FILENAME = 'solocrm.db'

/**
 * Milliseconds SQLite retries an internal lock before giving up with
 * SQLITE_BUSY, instead of failing immediately. This app is a single writer
 * almost all the time, but the read-only console connection (X-02) and
 * WAL's own checkpoint machinery each take a brief lock against the writer;
 * without a timeout, an unlucky read landing mid-write surfaces as a thrown
 * error instead of a short, invisible wait.
 */
const BUSY_TIMEOUT_MS = 5_000

export interface OpenDatabaseOptions {
  /**
   * Overrides the directory `app.getPath('userData')` would otherwise
   * resolve to — both the folder `solocrm.db` lives under directly (no
   * pointer file present) and the folder T-260828-17's `data-root.ts` reads
   * `data-location.json` from. Tests only — production always resolves
   * through the real `app.getPath('userData')`. There is deliberately no
   * environment-variable fallback: an override has to be passed explicitly
   * by the caller, so a test can never silently inherit a relaxed default
   * (T-260828-05's Risks note, and the AGENTS.md gotcha this exists to
   * protect: the database must never end up resolved into a Drive, Dropbox
   * or iCloud folder because a convenient default let a path go unchecked).
   * ADR-006 keeps this exact semantics rather than widening it into a
   * production data-root override.
   */
  userDataDir?: string
  /**
   * Overrides the migration set `openDatabase` applies. Tests only, same
   * discipline as `userDataDir` above: production never passes this, so a
   * test's synthetic (including deliberately broken) migrations can never
   * reach a real boot. Exists so the "a throwing migration leaves
   * `openDatabase` no worse than it started" behaviour below can be proven
   * through the real call path rather than only against `runMigrations` in
   * isolation.
   */
  migrations?: readonly MigrationDefinition[]
}

/**
 * Where `solocrm.db` sits inside a data root the caller already has. The
 * one expression in the main process that joins the database's filename
 * onto a folder (T-260828-57's first Acceptance line) — the first-run
 * chooser used to have its own, and the safety property "an existing
 * install is never prompted" rested on the two staying equal.
 *
 * Takes the root as given: it reads no pointer file, resolves nothing, and
 * runs no guard, so it is safe to ask about a folder the user is merely
 * considering — including on a profile whose own `userData` sits inside a
 * sync folder, where `resolveDatabasePath` below rightly throws and where
 * throwing would leave the one screen that exists to escape that folder
 * unreachable.
 *
 * **Never pass its result to `new Database(...)`** — that is
 * `resolveDatabasePath`'s job, and `connection.test.ts` pins who may import
 * this. Two callers are sanctioned, for the same reason: the first-run
 * chooser and T-260828-19's `move-data-root.ts`, both of which have to name
 * the database inside a folder the user is merely *considering* — to refuse
 * it, to check whether it already holds one, and (for the move) to say
 * where the copy will land. Neither opens what it names: the move opens the
 * new root only through `openDatabase()`, after the pointer is rewritten.
 */
export function databasePathIn(dataRoot: string): string {
  return join(dataRoot, DB_FILENAME)
}

/**
 * Resolves the on-disk path `solocrm.db` lives at — and refuses to return
 * one this app must not open. Kept separate from `openDatabase` below so
 * T-260828-06's sync-folder guard runs against this exact path *before* any
 * file is created.
 *
 * **The guard lives here, not at the `new Database(...)` call sites.**
 * T-260828-57: it used to live inside `openDatabase`, which made
 * `resolveDatabasePath` a way to obtain a path the guard had never seen —
 * and `readonly-connection.ts` (T-260828-39) duly obtained one, opening a
 * second connection unchecked until a review caught it and added a second
 * copy of the guard. Two copies of a safety check is the shape AGENTS.md
 * warns about: they drift, and the drift is silent. Putting the guard in
 * the resolver means a refused path cannot be obtained at all, so no future
 * opener can forget to check it — there is nothing to remember. AGENTS.md
 * already describes the system this way ("every path a pointer names still
 * resolves through `resolveDatabasePath()` and still runs through this same
 * sync-folder guard"); this makes that sentence true rather than aspirational.
 *
 * The cost is that this function throws, so it is not the one to call when
 * you only want to know where the file would be — see `databasePathIn`
 * above.
 *
 * Composes with `resolveDataRoot` (T-260828-17's `data-root.ts`) rather than
 * resolving `app.getPath('userData')` itself: with no `data-location.json`
 * pointer present, `resolveDataRoot` returns `userDataDir` unchanged, so this
 * function's result is byte-for-byte what it was before that task existed.
 * The pointer read (and the directory-creation it can trigger) deliberately
 * stays inside `data-root.ts` rather than inlined here — this function
 * doing the read itself would be exactly the "hidden filesystem access"
 * ADR-006 and this task's Risks note call out as the thing to avoid, since
 * the guard below depends on being able to reason about this function as one
 * explicit, visible composition rather than an opaque call.
 */
export function resolveDatabasePath(options: OpenDatabaseOptions = {}): string {
  const candidate = databasePathIn(resolveDataRoot({ userDataDir: options.userDataDir }))
  assertPathOutsideSyncFolder(candidate)
  return candidate
}

let handle: Database.Database | null = null

/**
 * Opens the one connection this app keeps to `solocrm.db` and sets every
 * pragma the schema depends on. Throws if a connection is already open —
 * callers are expected to `closeDatabase()` before reopening rather than
 * leaking a handle; nothing in this app legitimately needs two writers.
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Database.Database {
  if (handle) {
    throw new Error('openDatabase() called while a connection is already open — call closeDatabase() first')
  }

  // T-260828-06's sync-folder guard runs *inside* `resolveDatabasePath`
  // (see its comment), so a refused path throws here — before
  // better-sqlite3 has any chance to create solocrm.db/-wal/-shm on the
  // next line. `electron/main/index.ts`'s existing startup-failure handler
  // (dialog.showErrorBox + app.exit(1)) catches the `SyncFolderGuardError`
  // and shows its message, which names the refused path, the reason and the
  // override.
  const dbPath = resolveDatabasePath(options)

  const db = new Database(dbPath)

  applyPragmas(db)
  handle = db

  // T-260828-07: runs after the handle is set, reached through
  // getDatabase() rather than the local `db` — the seam T-260828-05's
  // outcome calls out for this task. A migration failure is treated like
  // any other failure to open: the handle is put back to null and the raw
  // connection is closed before rethrowing, so a caller sees exactly the
  // same "not open" state as if openDatabase() had never been called
  // (getDatabase() throws, a retried openDatabase() does not hit the
  // "already open" guard above) rather than a half-open connection nothing
  // ever closes. The migration itself is already safe on its own terms —
  // runMigrations applies each migration in its own transaction, so a
  // throwing migration leaves the schema at the previous version with no
  // partial application — this is the connection-level half of the same
  // guarantee.
  try {
    runMigrations(getDatabase(), options.migrations)
  } catch (error) {
    handle = null
    db.close()
    throw error
  }

  return db
}

/**
 * The pragmas every connection to `solocrm.db` needs. Applied inside
 * `openDatabase` so they run on *every* connection this module opens, not
 * just the first — `foreign_keys` in particular is per-connection and off by
 * default in SQLite (this task's Why), so a schema full of references
 * enforces nothing unless this runs each time, which `connection.test.ts`
 * checks on a second, independently-opened connection rather than trusting
 * the first.
 */
function applyPragmas(db: Database.Database): void {
  // WAL: readers never block the writer and the writer never blocks readers,
  // and — the property connection.test.ts's kill-mid-write case exercises —
  // a process killed mid-transaction still leaves a database that opens
  // cleanly, because recovery replays only frames from a *committed*
  // transaction out of the `-wal` file. The cost: WAL keeps two sidecar
  // files, `-wal` and `-shm`, next to `solocrm.db` for as long as the
  // database is open (and, without a checkpoint, after too — see
  // `closeDatabase` below). A backup or manual copy that takes `solocrm.db`
  // alone without them can be missing committed data that is still sitting
  // in the WAL file rather than folded into the main one; X-04's backup task
  // has to copy (or checkpoint before copying) all three.
  db.pragma('journal_mode = WAL')

  // Off by default in SQLite, and per-connection, not per-database — see
  // this task's Why. Every schema reference (companies -> people,
  // engagements -> companies, ...) enforces nothing without this pragma
  // having run on the specific connection doing the writing.
  db.pragma('foreign_keys = ON')

  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)

  // NORMAL, not FULL — a deliberate choice, not the path of least
  // resistance. Paired with WAL (as opposed to the legacy rollback journal,
  // where NORMAL can lose the whole database on power loss), SQLite's own
  // guidance is that NORMAL cannot corrupt the database file itself on an
  // OS crash or power loss: the file stays structurally valid either way,
  // and integrity_check keeps passing. What NORMAL trades away is that a
  // commit is only fsync'd to disk at the next WAL checkpoint rather than
  // immediately, so the last handful of commits since the previous
  // checkpoint can be lost — never torn, never corrupted, just absent — in
  // the narrow window of an actual power loss or OS-level crash (not an
  // ordinary application crash or `kill`, which this task's test proves
  // recovers cleanly regardless of this setting). FULL fsyncs on every
  // commit and would close even that window, but at a real latency cost on
  // every write in an app whose UI saves a form field's edit as one commit;
  // for a single-user local desktop CRM, trading a few seconds of the most
  // recent edits against an actual power cut — a rare event this app cannot
  // do anything about anyway — for not stalling every save is the right
  // side of that trade. Money and revenue integrity depend on
  // `SUM(amount_cents) ... GROUP BY` reading consistent committed rows, not
  // on every commit being synchronously durable to the platter.
  db.pragma('synchronous = NORMAL')
}

/**
 * Closes the open connection, checkpointing WAL back into the main file
 * first (`TRUNCATE` mode: fold every frame into `solocrm.db` and truncate
 * the `-wal` file to zero) so the next launch — or a backup taken right
 * after quit — sees a self-contained `solocrm.db` rather than committed data
 * still sitting in the WAL sidecar. Safe to call when nothing is open.
 */
export function closeDatabase(): void {
  if (!handle) return
  const db = handle
  handle = null
  // The close must happen even if the checkpoint throws — otherwise the
  // handle stays open with no owner and a later openDatabase() would run
  // two connections against the file.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

/**
 * Whether a write connection is currently open. Exists for T-260828-19's
 * data-root move, which has to close the connection, copy the files, and
 * then put the process back the way it found it: a move invoked from a
 * running app must reopen, a move run before `openDatabase()` (or after a
 * failed one) must not, and guessing wrong either leaks a second handle or
 * leaves the app with none. Deliberately a boolean rather than exposing the
 * handle — `getDatabase()` stays the only way to reach it.
 */
export function isDatabaseOpen(): boolean {
  return handle !== null
}

/**
 * Runs `PRAGMA integrity_check` against a SQLite file that is **not** this
 * app's live database, and — when it passes — folds any `-wal` frames back
 * into it with a truncating checkpoint. Returns SQLite's own answer: the
 * string `ok`, or the first line of its complaint.
 *
 * This is the verification half of T-260828-19's copy-then-verify-then-
 * repoint order: the freshly copied database in the target folder is proven
 * readable and structurally sound *before* the pointer is rewritten, so a
 * bad copy is a refusal that leaves the app on its original root rather
 * than a repointed app that cannot open anything.
 *
 * It lives here, in the module that owns opening SQLite, for the reason
 * `connection.test.ts` pins structurally: a second module constructing its
 * own handle is a second, unconstrained way into a database file, which is
 * the shape AGENTS.md's sync-folder gotcha warns about. The handle opened
 * here is transient, owned entirely by this call, and closed in a `finally`
 * — it never becomes `handle`, and `getDatabase()` never returns it.
 *
 * Read-write, not read-only, and that is load-bearing: a copy carrying a
 * `-wal` sidecar with committed frames needs recovery on first access, and
 * a read-only handle cannot recover one — it would fail on exactly the
 * databases whose recent writes most need confirming. The checkpoint
 * afterwards is what makes the new root self-contained.
 */
export function checkDatabaseFileIntegrity(filePath: string): string {
  const probe = new Database(filePath, { fileMustExist: true })
  try {
    probe.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
    const rows = probe.pragma('integrity_check') as Array<{ integrity_check?: unknown }>
    const first = rows[0]?.integrity_check
    const result = typeof first === 'string' ? first : 'integrity_check returned no result'
    if (result === 'ok') {
      probe.pragma('wal_checkpoint(TRUNCATE)')
    }
    return result
  } finally {
    probe.close()
  }
}

/** The open connection. Throws if nothing has called `openDatabase()` yet. */
export function getDatabase(): Database.Database {
  if (!handle) {
    throw new Error('getDatabase() called before openDatabase()')
  }
  return handle
}
