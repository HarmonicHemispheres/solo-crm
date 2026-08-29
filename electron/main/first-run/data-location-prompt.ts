import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog as electronDialog } from 'electron'
import { DATA_ROOT_POINTER_FILENAME, writeDataRootPointer } from '../db/data-root'
import { findSyncFolderMatch, type SyncFolderMatch } from '../db/sync-folder-guard'

/**
 * T-260828-18: the one place a human is asked, once, where Solo CRM should
 * keep its data — before `openDatabase()` has ever run, and before any
 * `BrowserWindow` exists to ask through a styled screen (that renderer would
 * itself need a database location to load, which is exactly the
 * chicken-and-egg ADR-006 exists to avoid). Everything here is native
 * `dialog` calls plus T-260828-17's already-built pieces
 * (`resolveDataRoot`'s pointer filename, `writeDataRootPointer`,
 * `findSyncFolderMatch`) — this task does the *choosing*, not the resolving
 * or the writing mechanics.
 */

/** Mirrors `resolveDatabasePath`'s private `DB_FILENAME` in connection.ts — duplicated rather than exported/imported because that constant is deliberately kept private to `connection.ts` (T-260828-05), and the literal already appears in several other modules' comments/tests. */
const DB_FILENAME = 'solocrm.db'

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
  showOpenDialog(options: { properties: Array<'openDirectory' | 'createDirectory'> }): Promise<{
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
   * Overrides `app.getPath('userData')` — both where the pointer file and
   * `solocrm.db` are looked for, and the root `writeDataRootPointer` writes
   * against when the user picks "Use the default". Tests only, mirroring
   * `OpenDatabaseOptions`/`DataRootOptions`: production never passes this.
   */
  userDataDir?: string
  /**
   * Overrides the dialog implementation. Tests only — production leaves
   * this unset and gets the real `electron` `dialog` singleton. Never read
   * when `skip` is true, so `npm run seed` never needs to supply one.
   */
  dialog?: FirstRunDialog
}

export type FirstRunOutcome =
  /** `skip: true` was passed — nothing was checked or shown. */
  | { readonly kind: 'skipped' }
  /**
   * A pointer file or a `solocrm.db` already exists under the default root
   * — this is an existing install, not a first run, so nothing was shown.
   * This is the safety property this task's Risks section calls "the whole
   * safety property here, not a convenience": prompting an existing install
   * risks a user picking a new, empty folder and concluding the app ate
   * their data.
   */
  | { readonly kind: 'existing-install' }
  /** "Use the default" — the pointer now names the default root explicitly. */
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

function defaultDatabasePathUnder(userDataDir: string): string {
  return join(userDataDir, DB_FILENAME)
}

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

function buildSyncFolderRefusalMessageBox(match: SyncFolderMatch): Parameters<FirstRunDialog['showMessageBox']>[0] {
  return {
    type: 'warning',
    title: 'That folder cannot be used',
    message: 'That folder cannot be used',
    detail:
      `"${match.resolvedPath}" runs through a "${match.marker}" folder. File-sync services (Google Drive, ` +
      `Dropbox, iCloud, OneDrive) and SQLite write to the same file at the same time and corrupt each other — ` +
      `this is not a database bug, it only shows up later as one. Choose a different folder.`,
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0
  }
}

/**
 * Drives the choice → (optional) folder pick → (optional) refusal loop until
 * the user reaches a terminal outcome. Cancelling the folder picker, and a
 * sync-folder refusal, both loop back to the top-level choice rather than
 * falling through to any default — this task's Scope is explicit that a
 * cancelled pick is not the same as choosing the default, and Risks is
 * explicit that a rejected sync-folder pick must never be allowed to commit.
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
      writeDataRootPointer(userDataDir, { userDataDir })
      return { kind: 'default-chosen' }
    }

    // Only BUTTON_CHOOSE_FOLDER remains (asserted rather than left implicit,
    // since a native dialog is trusted to return one of the button indices
    // it was given, not any other value).
    if (choice.response !== BUTTON_CHOOSE_FOLDER) {
      throw new Error(`unexpected dialog response from the first-run choice: ${String(choice.response)}`)
    }

    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (picked.canceled || picked.filePaths.length === 0) {
      continue
    }

    const chosen = picked.filePaths[0]

    // Checked at pick time with the *existing* guard — never a second,
    // unchecked way to decide whether a path is safe to open a database in
    // (AGENTS.md). Checked against the exact path `solocrm.db` would end up
    // at, so the resolved path a refusal names here matches what
    // `openDatabase()`'s own boot-time guard would have named later.
    const match = findSyncFolderMatch(defaultDatabasePathUnder(chosen))
    if (match) {
      await dialog.showMessageBox(buildSyncFolderRefusalMessageBox(match))
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
 */
export async function runFirstRunDataLocationPrompt(options: FirstRunDataLocationOptions): Promise<FirstRunOutcome> {
  if (options.skip) {
    return { kind: 'skipped' }
  }

  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const pointerPath = join(userDataDir, DATA_ROOT_POINTER_FILENAME)
  const defaultDbPath = defaultDatabasePathUnder(userDataDir)

  if (existsSync(pointerPath) || existsSync(defaultDbPath)) {
    return { kind: 'existing-install' }
  }

  const dialog = options.dialog ?? electronDialog
  return runChoiceLoop(dialog, userDataDir, defaultDbPath)
}
