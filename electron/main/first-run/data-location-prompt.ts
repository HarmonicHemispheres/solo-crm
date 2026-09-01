import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog as electronDialog } from 'electron'
import { databasePathIn } from '../db/connection'
import { DATA_ROOT_POINTER_FILENAME, writeDataRootPointer } from '../db/data-root'
import { isPortableLaunch, observePortableLaunch, type PortableLaunchProbe } from '../db/portable'
import {
  findBlockingSyncFolderMatch,
  SYNC_FOLDER_GUARD_OVERRIDE_ENV,
  type SyncFolderMatch
} from '../db/sync-folder-guard'

/**
 * T-260828-18: the one place a human is asked, once, where Solo CRM should
 * keep its data — before `openDatabase()` has ever run, and before any
 * `BrowserWindow` exists to ask through a styled screen (that renderer would
 * itself need a database location to load, which is exactly the
 * chicken-and-egg ADR-006 exists to avoid). Everything here is native
 * `dialog` calls plus T-260828-17's already-built pieces
 * (`resolveDataRoot`'s pointer filename, `writeDataRootPointer`,
 * `findBlockingSyncFolderMatch`) — this task does the *choosing*, not the
 * resolving or the writing mechanics.
 *
 * T-260828-57 closed the three ways this file had drifted away from that
 * rule: it had its own copy of the database filename, its own half of the
 * sync-folder guard (which ignored the documented override), and it
 * committed a pointer file before anything had proven the chosen folder was
 * writable. Each is now the shared thing instead of a local copy — see
 * `resolveUnguardedDatabasePath`, `findBlockingSyncFolderMatch` and
 * `probeWritable` below.
 */

const BUTTON_USE_DEFAULT = 0
const BUTTON_CHOOSE_FOLDER = 1
const BUTTON_QUIT = 2

/**
 * The narrow slice of `Electron.Dialog` this flow needs, mirroring
 * `security.ts`'s `CspSession`/`NavigableWebContents` — a structural type
 * rather than importing `dialog` as a value, so the whole choice/re-prompt
 * loop below is unit-testable with a plain fake object. `electron` cannot be
 * imported as a real, callable value outside a genuine Electron process
 * (`renderer-globals.test.ts` explains why), so testing this any other way
 * would mean spawning a real Electron process per test case just to drive a
 * dialog no automated test can actually click through.
 */
export interface FirstRunDialog {
  showMessageBox(options: {
    type?: 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
    noLink?: boolean
  }): Promise<{ response: number }>
  showOpenDialog(options: {
    properties: Array<'openDirectory' | 'createDirectory'>
    /**
     * All three are carried because the picker opens immediately after a
     * message box that carefully explained which folder is being asked for,
     * and a generic OS title ("Open") throws that context away at the
     * moment the user has to act on it.
     */
    title?: string
    defaultPath?: string
    buttonLabel?: string
  }): Promise<{
    canceled: boolean
    filePaths: string[]
  }>
}

export interface FirstRunDataLocationOptions {
  /**
   * Required, explicit — no default, no environment-variable escape hatch.
   * Same discipline as `OpenDatabaseOptions`/`DataRootOptions.userDataDir`:
   * every caller has to say what it means. `true` skips this flow entirely —
   * no filesystem check, no dialog call of any kind — which is what lets
   * `npm test` and `npm run seed` pass this and never risk a blocked
   * process (this task's Risks section: a dialog before any window exists
   * blocks the whole process, and a missed opt-out hangs the test suite with
   * no output rather than failing loudly).
   */
  skip: boolean
  /**
   * Overrides `app.getPath('userData')` — where the pointer file and
   * `solocrm.db` are looked for, and the root the pointer is written
   * against. Tests only, mirroring `OpenDatabaseOptions`/`DataRootOptions`:
   * production never passes this.
   */
  userDataDir?: string
  /**
   * Overrides the dialog implementation. Tests only — production leaves
   * this unset and gets the real `electron` `dialog` singleton. Never read
   * when `skip` is true, so `npm run seed` never needs to supply one.
   */
  dialog?: FirstRunDialog
  /**
   * Overrides what this process reports about its own launch. Tests only,
   * on exactly the terms `DataRootOptions.portableLaunch` already sets:
   * production leaves it unset and gets `observePortableLaunch()`, which is
   * the one place the app reads Electron and the environment for this.
   * Widening it into a production escape hatch would be a way to name a
   * data root from outside — the mechanism ADR-006 refused.
   */
  portableLaunch?: PortableLaunchProbe
}

export type FirstRunOutcome =
  /** `skip: true` was passed — nothing was checked or shown. */
  | { readonly kind: 'skipped' }
  /**
   * T-260831-06: this is a portable launch, so there was no question to ask
   * and nothing was shown. ADR-013 Decision 6 settles that a portable copy
   * keeps its data beside its own `.exe`, ignores `data-location.json` and
   * never writes one — so every branch below is either misleading or a dead
   * end here. "Use the default" would name a `%APPDATA%` path on the *host*
   * that the data will not go to, and "Choose a folder…" ends at
   * `writeDataRootPointer`, which raises `PortableDataRootPointerError`
   * rather than repointing the host's installed copy.
   *
   * Distinct from `skipped` deliberately: `skipped` means a caller opted
   * out, this means the app answered the question itself. Nothing here
   * resolves the root — `resolveDataRoot()` does that, through the same
   * probe, when `openDatabase()` runs a moment later.
   */
  | { readonly kind: 'portable' }
  /**
   * A pointer file or a `solocrm.db` already exists under the default root
   * — this is an existing install, not a first run, so nothing was shown.
   * This is the safety property this task's Risks section calls "the whole
   * safety property here, not a convenience": prompting an existing install
   * risks a user picking a new, empty folder and concluding the app ate
   * their data.
   */
  | { readonly kind: 'existing-install' }
  /**
   * "Use the default" — and, deliberately, **no pointer file was written**.
   * See `runChoiceLoop` for why that is the choice that matches ADR-006.
   */
  | { readonly kind: 'default-chosen' }
  /** "Choose a folder…" with a valid pick — the pointer names `dataRoot`. */
  | { readonly kind: 'folder-chosen'; readonly dataRoot: string }
  /**
   * "Quit", or Escape (which `cancelId` maps to the same button, never to a
   * silent default). No pointer file was written. The caller is responsible
   * for actually exiting the process — this module only decides, side
   * effects belong at the call site, the same layering `sync-folder-guard.ts`
   * uses for its own error rather than calling `app.exit` itself.
   */
  | { readonly kind: 'quit' }

function buildChoiceMessageBox(defaultDbPath: string): Parameters<FirstRunDialog['showMessageBox']>[0] {
  return {
    type: 'question',
    title: 'Solo CRM',
    message: 'Where should Solo CRM keep your data?',
    detail:
      `This is different from the folder you just installed Solo CRM into — it is where Solo CRM will store ` +
      `solocrm.db, the single file holding every company, person and engagement you add. It never changes ` +
      `on its own.\n\nBy default:\n${defaultDbPath}\n\nYou can choose a different folder instead — for ` +
      `example, a second drive.`,
    buttons: ['Use the default', 'Choose a folder…', 'Quit'],
    defaultId: BUTTON_USE_DEFAULT,
    cancelId: BUTTON_QUIT,
    noLink: true
  }
}

function buildOpenDialogOptions(defaultDataRoot: string): Parameters<FirstRunDialog['showOpenDialog']>[0] {
  return {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose the folder for Solo CRM’s data',
    // Opens the picker where the message box just said the data would go by
    // default, so "somewhere else" is a move from a known starting point
    // rather than from wherever the OS last happened to leave the picker.
    defaultPath: defaultDataRoot,
    buttonLabel: 'Use this folder'
  }
}

function buildSyncFolderRefusalMessageBox(match: SyncFolderMatch): Parameters<FirstRunDialog['showMessageBox']>[0] {
  return {
    type: 'warning',
    title: 'That folder cannot be used',
    message: 'That folder cannot be used',
    detail:
      `"${match.resolvedPath}" runs through a "${match.marker}" folder. File-sync services (Google Drive, ` +
      `Dropbox, iCloud, OneDrive) and SQLite write to the same file at the same time and corrupt each other — ` +
      `this is not a database bug, it only shows up later as one. Choose a different folder.\n\n` +
      // The override is what would allow this exact pick, so the refusal
      // names it rather than leaving the user to find it in a source file
      // (T-260828-57: the same sentence `SyncFolderGuardError` already
      // carries at boot, said at the moment the choice is being made).
      `If you understand the risk and want this folder anyway, quit, set the environment variable ` +
      `${SYNC_FOLDER_GUARD_OVERRIDE_ENV}=1, and start Solo CRM again.`,
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0
  }
}

function buildNotWritableMessageBox(chosen: string, reason: string): Parameters<FirstRunDialog['showMessageBox']>[0] {
  return {
    type: 'warning',
    title: 'That folder cannot be used',
    message: 'That folder cannot be used',
    detail:
      `Solo CRM could not create a file in "${chosen}", so it would not be able to create its database ` +
      `there either — ${reason}\n\nThis can happen with a read-only folder, a disconnected drive, or a ` +
      `network share that is not available. Choose a different folder.`,
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0
  }
}

/**
 * Proves the chosen folder can actually be written to, *before* the pointer
 * naming it is committed. Without this, a read-only or disconnected pick
 * fails later inside `openDatabase()` — by which time the pointer is on
 * disk, so every subsequent launch reports `existing-install`, never
 * re-prompts, and dies on a raw better-sqlite3 "unable to open database
 * file": an unbootable install with no way back through the interface
 * (T-260828-57's Why).
 *
 * A uniquely-named zero-byte file, removed in a `finally`, so nothing is
 * left behind in a folder the user is only considering (this task's Risks).
 * It deliberately does not write `solocrm.db` itself: creating the real
 * database as a side effect of *looking* at a folder is the same mistake in
 * a different direction.
 *
 * Returns `null` when the folder is writable, or the reason it is not.
 */
function probeWritable(folder: string): string | null {
  const probePath = join(folder, `.solocrm-write-test-${randomUUID()}`)
  try {
    writeFileSync(probePath, '', 'utf-8')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    // `force: true` so a probe that never got created is not itself an
    // error, and so a cleanup failure can never turn a *successful* probe
    // into a refusal.
    try {
      rmSync(probePath, { force: true })
    } catch {
      // A folder we could write to but not delete from is still writable
      // enough to hold a database; the stray zero-byte file is the lesser
      // problem and is not worth refusing the user's choice over.
    }
  }
}

/**
 * Drives the choice → (optional) folder pick → (optional) refusal loop until
 * the user reaches a terminal outcome. Cancelling the folder picker, a
 * sync-folder refusal, and an unwritable folder all loop back to the
 * top-level choice rather than falling through to any default — this task's
 * Scope is explicit that a cancelled pick is not the same as choosing the
 * default, and Risks is explicit that a rejected pick must never be allowed
 * to commit.
 */
async function runChoiceLoop(
  dialog: FirstRunDialog,
  userDataDir: string,
  defaultDbPath: string
): Promise<FirstRunOutcome> {
  for (;;) {
    const choice = await dialog.showMessageBox(buildChoiceMessageBox(defaultDbPath))

    if (choice.response === BUTTON_QUIT) {
      return { kind: 'quit' }
    }

    if (choice.response === BUTTON_USE_DEFAULT) {
      // Deliberately writes **no** pointer file (T-260828-57). ADR-006
      // Decision item 1 states that no pointer present *is* the default and
      // is byte-for-byte the behaviour every install already had; writing
      // one that names the default root would bake an absolute path into
      // the profile, so a profile that later moves — a new machine, a
      // renamed user, a roaming profile — would resolve to a folder that no
      // longer exists rather than to wherever `app.getPath('userData')` now
      // points. "Use the default" means *keep* the default, and the honest
      // representation of that is the absence of a pointer, not a pointer
      // that happens to agree today. `data-location-prompt.test.ts` checks
      // this against ADR-006's own text so the two cannot drift apart
      // silently.
      return { kind: 'default-chosen' }
    }

    // Only BUTTON_CHOOSE_FOLDER remains (asserted rather than left implicit,
    // since a native dialog is trusted to return one of the button indices
    // it was given, not any other value).
    if (choice.response !== BUTTON_CHOOSE_FOLDER) {
      throw new Error(`unexpected dialog response from the first-run choice: ${String(choice.response)}`)
    }

    const picked = await dialog.showOpenDialog(buildOpenDialogOptions(userDataDir))
    if (picked.canceled || picked.filePaths.length === 0) {
      continue
    }

    const chosen = picked.filePaths[0]

    // Checked at pick time with the *whole* existing guard — the match and
    // the documented override together (`findBlockingSyncFolderMatch`), so
    // this screen reaches the same verdict `openDatabase()` will reach a
    // moment later rather than a stricter one of its own. Checked against
    // the exact path `solocrm.db` would end up at, so the resolved path a
    // refusal names here matches what the boot-time guard would name.
    const match = findBlockingSyncFolderMatch(databasePathIn(chosen))
    if (match) {
      await dialog.showMessageBox(buildSyncFolderRefusalMessageBox(match))
      continue
    }

    const notWritable = probeWritable(chosen)
    if (notWritable !== null) {
      await dialog.showMessageBox(buildNotWritableMessageBox(chosen, notWritable))
      continue
    }

    writeDataRootPointer(chosen, { userDataDir })
    return { kind: 'folder-chosen', dataRoot: chosen }
  }
}

/**
 * The entry point `index.ts` calls, once, inside `app.whenReady()` — after
 * `installContentSecurityPolicy` and before `openDatabase()`. With
 * `skip: false` and neither a pointer file nor a `solocrm.db` present under
 * the default root, this blocks on native dialogs until the user reaches a
 * terminal choice; the caller is expected to `await` it before opening the
 * database. An existing install (either file present) returns immediately
 * with no dialog shown at all — see `FirstRunOutcome`'s `existing-install`
 * case for why that check comes first and unconditionally.
 *
 * A portable launch also returns immediately, before either of those checks
 * — see the `portable` case. That is the only behaviour T-260831-06 changed
 * here; every non-portable path below is byte-for-byte T-260828-18's.
 */
export async function runFirstRunDataLocationPrompt(options: FirstRunDataLocationOptions): Promise<FirstRunOutcome> {
  if (options.skip) {
    return { kind: 'skipped' }
  }

  // T-260831-06 / ADR-013 Decision 6. Second only to the explicit opt-out,
  // and — like the portable branch at the top of `resolveDataRoot()` —
  // before `app.getPath('userData')` is so much as read: on a portable
  // launch that folder is the *host's*, shared with any Solo CRM installed
  // here, and both the pointer file and the `solocrm.db` this flow looks for
  // there belong to that other copy. Answering "have you been set up
  // before?" from another install's files is the wrong question asked of the
  // wrong machine.
  //
  // The predicate is `isPortableLaunch(observePortableLaunch())` and nothing
  // else — the same call `resolveDataRoot()` makes, so this screen and the
  // resolver can never reach opposite verdicts about one launch.
  const probe = options.portableLaunch ?? observePortableLaunch()
  if (isPortableLaunch(probe)) {
    return { kind: 'portable' }
  }

  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const pointerPath = join(userDataDir, DATA_ROOT_POINTER_FILENAME)

  // The pointer check comes first and returns before the path below is
  // resolved — not just for speed. A pointer present means this is an
  // existing install whatever it names, and resolving through it would
  // start applying the pointer's own validation (and its directory
  // creation) on a code path whose entire job is to answer "has this
  // profile been set up before".
  if (existsSync(pointerPath)) {
    return { kind: 'existing-install' }
  }

  // The default root, not the resolved one — with no pointer file (ruled
  // out immediately above) they are the same folder, and asking the
  // resolver would be circular: this check is what decides whether this
  // profile has ever been configured. `databasePathIn` is `connection.ts`'s
  // own expression for the database's location, so this can no longer drift
  // from where `openDatabase()` will actually look (T-260828-57's Why).
  const defaultDbPath = databasePathIn(userDataDir)
  if (existsSync(defaultDbPath)) {
    return { kind: 'existing-install' }
  }

  const dialog = options.dialog ?? electronDialog
  return runChoiceLoop(dialog, userDataDir, defaultDbPath)
}
