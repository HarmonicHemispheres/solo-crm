import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { app } from 'electron'
import {
  checkDatabaseFileIntegrity,
  closeDatabase,
  databasePathIn,
  isDatabaseOpen,
  openDatabase,
  resolveDatabasePath
} from './connection'
import { resolveDataRoot, writeDataRootPointer, type DataRootOptions } from './data-root'
import { isPortableLaunch, observePortableLaunch } from './portable'
import { closeReadOnlyDatabase } from './readonly-connection'
import { findBlockingSyncFolderMatch } from './sync-folder-guard'

/**
 * T-260828-19: moving an existing data root to another folder without
 * losing a write. T-260828-18 asks once, on first run; someone who accepted
 * the default before thinking about it, or who later buys a bigger drive,
 * otherwise has only one way out — hand-editing `data-location.json`, which
 * moves the *pointer* without moving the database and presents as an empty
 * CRM.
 *
 * **The order is the whole design, and it is not negotiable:**
 * checkpoint → close → copy → verify the copy → rewrite the pointer →
 * reopen. The pointer is the last thing that changes, so every earlier
 * failure — and every process kill at any point before it — leaves an app
 * that still opens the original root on the next launch. After it, the copy
 * has already been proven sound, so the new root opens. There is no step at
 * which the pointer names a folder whose database has not been verified,
 * which is what "never neither" means in this task's acceptance criteria.
 *
 * **Nothing is ever deleted from the original root.** The old
 * `solocrm.db` (and any sidecars) stay exactly where they were and the
 * result names them, so a user who distrusts the move has the previous
 * state on disk. The only files this module removes are ones it created
 * itself, in the target, on a failed attempt — leaving a half-copied
 * database behind would make the target non-empty and so refuse the retry
 * that would fix it.
 *
 * The sync-folder guard is *not* reimplemented here (AGENTS.md's gotcha,
 * and this task's Risks): the target goes through the same
 * `findBlockingSyncFolderMatch` the boot path and the first-run chooser
 * use, against the exact path `solocrm.db` would occupy.
 *
 * No dialogs, no menus, no `app.exit` — deciding is here, side effects are
 * at the call site (`app-menu.ts`), the same layering `sync-folder-guard.ts`
 * and `data-location-prompt.ts` already use.
 */

/** The sidecars WAL keeps beside `solocrm.db`, in copy order. */
const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const

export type MoveDataRootRefusalCode =
  /**
   * This is a portable copy, which has no relocatable data root to move
   * (ADR-013 Decision 6).
   */
  | 'portable'
  /** The target is not an absolute path. */
  | 'not-absolute'
  /** The target does not exist, or exists and is not a directory. */
  | 'not-a-directory'
  /** The target is the folder the data already lives in. */
  | 'same-root'
  /** The target already holds a `solocrm.db` — merging two databases is out of scope, permanently. */
  | 'target-has-database'
  /** The target holds something else. An empty folder is the only safe destination. */
  | 'not-empty'
  /** The target runs through a file-sync folder and the documented override is not set. */
  | 'sync-folder'
  /** There is no database at the current root to move. */
  | 'no-database'
  /** A file could not be copied. Nothing was repointed; the copies made so far were removed. */
  | 'copy-failed'
  /** The copy exists but `PRAGMA integrity_check` did not return `ok`. */
  | 'integrity-failed'
  /** The copy verified, but the pointer could not be written. The app stays on the original root. */
  | 'pointer-failed'

export interface MoveDataRootRefusal {
  readonly kind: 'refused'
  readonly code: MoveDataRootRefusalCode
  /** Written to be shown to a user verbatim — it names the path and the reason. */
  readonly message: string
  /** The root the app is still on. Unchanged by a refusal, by construction. */
  readonly dataRoot: string
  /**
   * Set when a refusal happened *after* the connection was closed and
   * reopening it failed — the move did not happen and the app now has no
   * open database, so the caller must tell the user to restart rather than
   * carry on as if only the move had failed.
   */
  readonly reopenError?: string
}

export interface MoveDataRootSuccess {
  readonly kind: 'moved'
  /** The folder the data came from. Its files are still there. */
  readonly previousRoot: string
  /** The folder the pointer now names, holding the verified copy. */
  readonly newRoot: string
  /** The original files, still on disk, for the message that tells the user where they are. */
  readonly leftBehind: readonly string[]
  /**
   * Set when the move completed but reopening the connection at the new
   * root failed. The data is safe and the next launch will open the new
   * root; this session needs a restart.
   */
  readonly reopenError?: string
}

export type MoveDataRootResult = MoveDataRootSuccess | MoveDataRootRefusal

export type MoveDataRootOptions = DataRootOptions

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Puts the connection back the way the move found it. Returns the reason
 * reopening failed, or `null`. A move invoked before `openDatabase()` (the
 * seed script, a test) closed nothing, so it reopens nothing.
 */
function reopenIfWasOpen(wasOpen: boolean, userDataDir: string): string | null {
  if (!wasOpen) return null
  try {
    openDatabase({ userDataDir })
    return null
  } catch (error) {
    return describe(error)
  }
}

/**
 * Removes the database and sidecars this module — or the integrity probe it
 * ran — created in the target during a failed attempt. Never anything it
 * found there, since the target was proven empty before the first byte was
 * copied, and never anything in the original root. All three names are
 * removed rather than only the ones the copy step wrote, because opening
 * the copy to verify it can itself create a `-wal`/`-shm` pair.
 */
function discardPartialCopies(targetDbPath: string): void {
  for (const path of [targetDbPath, ...SIDECAR_SUFFIXES.map((suffix) => `${targetDbPath}${suffix}`)]) {
    try {
      rmSync(path, { force: true })
    } catch {
      // A copy that cannot be removed is left behind; it makes the next
      // attempt refuse with `not-empty`, which is a message the user can
      // act on. Failing the cleanup is never worth losing the real reason
      // the move was refused.
    }
  }
}

/**
 * The pre-flight refusals — everything decidable before a single byte is
 * copied and, deliberately, before the connection is closed. This task's
 * acceptance is explicit that a sync-folder target is refused *before
 * anything is copied*; running every cheap check first also means the
 * common refusals never so much as interrupt the running app.
 */
function refuseTarget(target: string, currentRoot: string): MoveDataRootRefusal | null {
  const refusal = (code: MoveDataRootRefusalCode, message: string): MoveDataRootRefusal => ({
    kind: 'refused',
    code,
    message,
    dataRoot: currentRoot
  })

  if (!isAbsolute(target)) {
    return refusal('not-absolute', `"${target}" is not an absolute path.`)
  }

  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return refusal(
      'not-a-directory',
      `"${target}" is not an existing folder. Create the folder first, then choose it — Solo CRM does not ` +
        `create the destination itself.`
    )
  }

  if (resolve(target) === resolve(currentRoot)) {
    return refusal('same-root', `Solo CRM's data is already in "${target}".`)
  }

  let entries: string[]
  try {
    entries = readdirSync(target)
  } catch (error) {
    return refusal('not-a-directory', `"${target}" could not be read (${describe(error)}).`)
  }

  if (entries.length > 0) {
    // The distinction matters to the person reading it: a folder holding
    // another Solo CRM database is the case they are most likely to try,
    // and "merge these two" is out of scope permanently, not yet-to-come.
    if (existsSync(databasePathIn(target))) {
      return refusal(
        'target-has-database',
        `"${target}" already contains a solocrm.db. Solo CRM will not merge two databases or overwrite one. ` +
          `Choose an empty folder.`
      )
    }
    return refusal(
      'not-empty',
      `"${target}" is not empty. Choose an empty folder, so that nothing already there can be confused with ` +
        `Solo CRM's data.`
    )
  }

  // The same guard the boot path and the first-run chooser reach, against
  // the exact path the database would occupy — never a second copy of the
  // rule (AGENTS.md).
  const match = findBlockingSyncFolderMatch(databasePathIn(target))
  if (match) {
    return refusal(
      'sync-folder',
      `"${match.resolvedPath}" runs through a "${match.marker}" folder. File-sync services and SQLite write ` +
        `to the same file at the same time and corrupt each other. Choose a folder outside it.`
    )
  }

  return null
}

/**
 * Moves the data root to `target`, or refuses with a reason. Never throws
 * for a bad target: every outcome a user can cause is a `refused` result
 * carrying a message written to be shown as-is.
 *
 * Callers get a synchronous, blocking copy. That is honest — the file is
 * the app's entire state and nothing may write to it while it moves — but
 * it is why the call site shows the user what is happening first: a frozen
 * window during a multi-gigabyte copy reads as a crash and invites the
 * force-quit this order is designed to survive but which nobody should be
 * invited into (this task's Risks).
 *
 * Deliberately not exposed over IPC. It closes and reopens the connection
 * every repository in the app holds, and the renderer never gets a handle
 * on that; the entry point is main-process only.
 */
export function moveDataRoot(target: string, options: MoveDataRootOptions = {}): MoveDataRootResult {
  const probe = options.portableLaunch ?? observePortableLaunch()
  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const currentRoot = resolveDataRoot({ userDataDir, portableLaunch: probe })

  // ADR-013 Decision 6: a portable copy has no relocatable root, and the
  // refusal belongs *here* — before the connection is closed and before a
  // byte is copied — rather than as the `pointer-failed` this would otherwise
  // become several gigabytes later, when `writeDataRootPointer` refuses on
  // its own account. The mechanism a move relies on is the pointer file, and
  // in portable mode that file is not read and is never written: it lives in
  // the host machine's `%APPDATA%`, shared with any installed Solo CRM, so a
  // successful move here would have relocated the *installed* copy's data on
  // its next launch rather than this one's.
  if (isPortableLaunch(probe)) {
    return {
      kind: 'refused',
      code: 'portable',
      message:
        `This is the portable Solo CRM, which always keeps its data in the same folder as its .exe — ` +
        `"${currentRoot}". There is no other location to move it to, and recording one would change where ` +
        `a Solo CRM installed on this machine keeps its data, not this copy. To move a portable Solo CRM's ` +
        `data, quit the app and move the .exe and its solocrm.db files together.`,
      dataRoot: currentRoot
    }
  }

  const refusal = refuseTarget(target, currentRoot)
  if (refusal) return refusal

  const targetRoot = resolve(target)
  // The guarded resolver, not a hand-built path: the source is the database
  // this app is actually running on, and asking the resolver keeps that
  // true even if the pointer says something surprising.
  const sourceDbPath = resolveDatabasePath({ userDataDir })
  if (!existsSync(sourceDbPath)) {
    return {
      kind: 'refused',
      code: 'no-database',
      message: `There is no solocrm.db in "${currentRoot}" to move.`,
      dataRoot: currentRoot
    }
  }

  const targetDbPath = databasePathIn(targetRoot)
  const wasOpen = isDatabaseOpen()

  // The read-only connection closes first, and the order is load-bearing
  // rather than tidy: `closeDatabase()` checkpoints with TRUNCATE, and a
  // truncating checkpoint cannot complete while a second connection is
  // attached — it fails quietly and leaves committed frames in the `-wal`,
  // which is the exact write this task exists not to lose. Same reasoning,
  // same order, as `index.ts`'s `before-quit`.
  closeReadOnlyDatabase()

  // A failed checkpoint is not a failed move. `closeDatabase()` closes the
  // handle either way, and the sidecars are copied alongside the database
  // below, so frames the checkpoint could not fold in travel with it and
  // are recovered by the verification step. Swallowing the error here is
  // therefore safe *because* of that copy, not instead of it.
  try {
    closeDatabase()
  } catch (error) {
    console.warn(`[db] checkpoint before the data-root move failed, copying WAL sidecars instead: ${describe(error)}`)
  }

  try {
    copyFileSync(sourceDbPath, targetDbPath)
    for (const suffix of SIDECAR_SUFFIXES) {
      const from = `${sourceDbPath}${suffix}`
      if (!existsSync(from)) continue
      copyFileSync(from, `${targetDbPath}${suffix}`)
    }
  } catch (error) {
    discardPartialCopies(targetDbPath)
    const reopenError = reopenIfWasOpen(wasOpen, userDataDir)
    return {
      kind: 'refused',
      code: 'copy-failed',
      message:
        `Solo CRM could not copy its data into "${targetRoot}" — ${describe(error)} Nothing was changed: the ` +
        `app is still using "${currentRoot}".`,
      dataRoot: currentRoot,
      ...(reopenError ? { reopenError } : {})
    }
  }

  // Verified before the pointer moves, and verified on the *copy* — the
  // question is whether the file in the new folder is a sound database,
  // which no amount of checking the original can answer.
  let integrity: string
  try {
    integrity = checkDatabaseFileIntegrity(targetDbPath)
  } catch (error) {
    integrity = describe(error)
  }

  if (integrity !== 'ok') {
    discardPartialCopies(targetDbPath)
    const reopenError = reopenIfWasOpen(wasOpen, userDataDir)
    return {
      kind: 'refused',
      code: 'integrity-failed',
      message:
        `The copy of Solo CRM's database in "${targetRoot}" did not pass its integrity check (${integrity}), ` +
        `so it was removed. Nothing was changed: the app is still using "${currentRoot}".`,
      dataRoot: currentRoot,
      ...(reopenError ? { reopenError } : {})
    }
  }

  // The last mutation, and atomic on its own terms (`writeDataRootPointer`
  // writes a temp file and renames it). Before this line the app is on the
  // old root; after it, on the new one; there is no in-between state a kill
  // can land in.
  try {
    writeDataRootPointer(targetRoot, { userDataDir })
  } catch (error) {
    discardPartialCopies(targetDbPath)
    const reopenError = reopenIfWasOpen(wasOpen, userDataDir)
    return {
      kind: 'refused',
      code: 'pointer-failed',
      message:
        `Solo CRM copied its data to "${targetRoot}" but could not record the new location — ` +
        `${describe(error)} The copy was removed and the app is still using "${currentRoot}".`,
      dataRoot: currentRoot,
      ...(reopenError ? { reopenError } : {})
    }
  }

  const reopenError = reopenIfWasOpen(wasOpen, userDataDir)

  const leftBehind = [sourceDbPath, ...SIDECAR_SUFFIXES.map((suffix) => `${sourceDbPath}${suffix}`)].filter((path) =>
    existsSync(path)
  )

  return {
    kind: 'moved',
    previousRoot: currentRoot,
    newRoot: targetRoot,
    leftBehind,
    ...(reopenError ? { reopenError } : {})
  }
}
