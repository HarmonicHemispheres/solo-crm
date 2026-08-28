import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import {
  findSyncFolderMatch,
  isSyncFolderGuardOverridden,
  SYNC_FOLDER_GUARD_OVERRIDE_ENV,
  SyncFolderGuardError
} from './sync-folder-guard'

/**
 * The single owner of the SQLite connection. AGENTS.md: "the renderer never
 * touches SQLite or the filesystem"; the main-process half of that boundary
 * is that only this file imports `better-sqlite3` as a value and only this
 * file calls `new Database(...)`. Repositories (later tasks) reach the
 * connection through `getDatabase()`, never by opening the file themselves —
 * `connection.test.ts` asserts that structurally, not just by convention.
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
   * Overrides the directory `solocrm.db` is resolved under. Tests only —
   * production always resolves through `app.getPath('userData')`. There is
   * deliberately no environment-variable fallback: an override has to be
   * passed explicitly by the caller, so a test can never silently inherit a
   * relaxed default (T-260828-05's Risks note, and the AGENTS.md gotcha this
   * exists to protect: the database must never end up resolved into a Drive,
   * Dropbox or iCloud folder because a convenient default let a path go
   * unchecked).
   */
  userDataDir?: string
}

/**
 * Resolves the on-disk path `solocrm.db` lives at, without opening it. Kept
 * separate from `openDatabase` below so T-260828-06's sync-folder guard can
 * run against this exact path *before* the file is created — see the call
 * site inside `openDatabase`.
 */
export function resolveDatabasePath(options: OpenDatabaseOptions = {}): string {
  const userDataDir = options.userDataDir ?? app.getPath('userData')
  return join(userDataDir, DB_FILENAME)
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

  const dbPath = resolveDatabasePath(options)

  // T-260828-06's sync-folder guard: runs here, between resolving the path
  // above and opening the file below, so a refusal happens before
  // better-sqlite3 has any chance to create solocrm.db/-wal/-shm.
  // `isSyncFolderGuardOverridden` reads the one documented env-var escape
  // hatch (off by default); the match check itself
  // (`findSyncFolderMatch`) stays a pure function of the path alone — no
  // settings, no database — matching this module's own discipline for
  // `resolveDatabasePath` above. A match throws rather than returning, so a
  // caller cannot accidentally proceed to `new Database(dbPath)` on the next
  // line by forgetting to check a return value; electron/main/index.ts's
  // existing startup-failure handler (dialog.showErrorBox + app.exit(1))
  // catches it and shows this error's own message, which names the refused
  // path, the reason, and the override.
  if (isSyncFolderGuardOverridden()) {
    // The breadcrumb that explains a corruption report weeks later — an
    // overridden guard leaving no trace would make the eventual failure
    // look like a SQLite bug.
    console.warn(
      `[db] ${SYNC_FOLDER_GUARD_OVERRIDE_ENV}=1 — sync-folder guard skipped for ${dbPath}`
    )
  } else {
    const match = findSyncFolderMatch(dbPath)
    if (match) {
      throw new SyncFolderGuardError(match)
    }
  }

  const db = new Database(dbPath)

  applyPragmas(db)
  handle = db
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

/** The open connection. Throws if nothing has called `openDatabase()` yet. */
export function getDatabase(): Database.Database {
  if (!handle) {
    throw new Error('getDatabase() called before openDatabase()')
  }
  return handle
}
