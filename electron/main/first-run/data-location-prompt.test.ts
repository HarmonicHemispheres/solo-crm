import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_ROOT_POINTER_FILENAME } from '../db/data-root'
import { SYNC_FOLDER_GUARD_OVERRIDE_ENV } from '../db/sync-folder-guard'
import type { FirstRunDialog } from './data-location-prompt'
import { runFirstRunDataLocationPrompt } from './data-location-prompt'

/**
 * Every test below passes an explicit `userDataDir` and, except for the
 * `skip: true` cases, an explicit fake `dialog` — mirroring
 * `data-root.test.ts`'s discipline for `DataRootOptions.userDataDir`. The
 * real `electron` module cannot be imported as a value outside a genuine
 * Electron process (see `renderer-globals.test.ts`), so a fake `dialog` is
 * the only way to unit-test the choice/re-prompt loop without spawning a
 * real, unautomatable native dialog per test case.
 */

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const cleanupDirs: string[] = []

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function trackedTmpDir(prefix: string): string {
  const dir = makeTmpDir(prefix)
  cleanupDirs.push(dir)
  return dir
}

/** A dialog fake that throws on any call — proves a code path never opens a dialog at all. */
function unusedDialog(): FirstRunDialog {
  return {
    showMessageBox: vi.fn(() => {
      throw new Error('showMessageBox should not have been called')
    }),
    showOpenDialog: vi.fn(() => {
      throw new Error('showOpenDialog should not have been called')
    })
  }
}

/** A scripted dialog: each call to showMessageBox/showOpenDialog consumes the next queued response. */
function scriptedDialog(
  messageBoxResponses: number[],
  openDialogResponses: Array<{ canceled: boolean; filePaths: string[] }> = []
): FirstRunDialog & {
  messageBoxCalls: Array<Parameters<FirstRunDialog['showMessageBox']>[0]>
  openDialogCalls: Array<Parameters<FirstRunDialog['showOpenDialog']>[0]>
} {
  const messageBoxQueue = [...messageBoxResponses]
  const openDialogQueue = [...openDialogResponses]
  const messageBoxCalls: Array<Parameters<FirstRunDialog['showMessageBox']>[0]> = []
  const openDialogCalls: Array<Parameters<FirstRunDialog['showOpenDialog']>[0]> = []

  return {
    messageBoxCalls,
    openDialogCalls,
    showMessageBox: vi.fn(async (options) => {
      messageBoxCalls.push(options)
      const response = messageBoxQueue.shift()
      if (response === undefined) {
        throw new Error('scriptedDialog: showMessageBox called more times than scripted')
      }
      return { response }
    }),
    showOpenDialog: vi.fn(async (options) => {
      openDialogCalls.push(options)
      const next = openDialogQueue.shift()
      if (next === undefined) {
        throw new Error('scriptedDialog: showOpenDialog called more times than scripted')
      }
      return next
    })
  }
}

/**
 * Sets `SOLOCRM_ALLOW_SYNC_FOLDER_DB` for the duration of one test and puts
 * the previous value back — the same save/restore discipline
 * `connection.test.ts` uses for the same variable.
 */
async function withSyncFolderOverride<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV]
  process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV] = '1'
  try {
    // Awaited inside the try, so the restore below cannot run before the
    // flow that depends on the variable has finished.
    return await run()
  } finally {
    if (previous === undefined) {
      delete process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV]
    } else {
      process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV] = previous
    }
  }
}

function pointerContents(userDataDir: string): { dataRoot: string } {
  return JSON.parse(readFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), 'utf-8')) as { dataRoot: string }
}

describe('runFirstRunDataLocationPrompt with skip: true', () => {
  it('returns immediately, touching neither the filesystem nor the dialog', async () => {
    const dialog = unusedDialog()
    const outcome = await runFirstRunDataLocationPrompt({ skip: true, dialog })

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('never reads userDataDir even when one is supplied', async () => {
    // Regression guard for the exact hang this task's Risks section warns
    // about: skip must short-circuit before anything else runs.
    const dialog = unusedDialog()
    const outcome = await runFirstRunDataLocationPrompt({
      skip: true,
      userDataDir: '/does/not/exist',
      dialog
    })
    expect(outcome).toEqual({ kind: 'skipped' })
  })
})

describe('runFirstRunDataLocationPrompt on an existing install', () => {
  it('shows no dialog when data-location.json already exists', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot: userDataDir }), 'utf-8')
    const dialog = unusedDialog()

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'existing-install' })
  })

  it('shows no dialog when solocrm.db already exists under the default root, with no pointer file', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    writeFileSync(join(userDataDir, 'solocrm.db'), '', 'utf-8')
    const dialog = unusedDialog()

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'existing-install' })
  })
})

describe('runFirstRunDataLocationPrompt on a clean profile', () => {
  it('names the exact default database path in the message shown', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const dialog = scriptedDialog([2]) // Quit, to end the test in one round trip

    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(dialog.messageBoxCalls).toHaveLength(1)
    const shown = dialog.messageBoxCalls[0]
    expect(shown.detail).toContain(join(userDataDir, 'solocrm.db'))
    expect(shown.buttons).toEqual(['Use the default', 'Choose a folder…', 'Quit'])
    // Escape maps to Quit (cancelId === the Quit button's index), never to
    // a silent default — this task's Scope is explicit about that.
    expect(shown.cancelId).toBe(2)
    expect(shown.defaultId).toBe(0)
  })

  it('"Use the default" writes no pointer file at all, and leaves the profile untouched', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const dialog = scriptedDialog([0])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'default-chosen' })
    // T-260828-57: "use the default" means *keep* the default, and ADR-006
    // states the default is the absence of a pointer. Writing one naming
    // the default root would bake an absolute path into every new profile.
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
    expect(readdirSync(userDataDir)).toEqual([])
  })

  it('a second call, once openDatabase has created solocrm.db, shows no dialog at all', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const firstDialog = scriptedDialog([0])
    expect(await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog: firstDialog })).toEqual({
      kind: 'default-chosen'
    })

    // What `index.ts` does next: `openDatabase()` creates the file under the
    // default root. From then on this is an existing install — which is the
    // property that must not regress, and which now rests on the database
    // itself rather than on a pointer file written to stand in for it.
    writeFileSync(join(userDataDir, 'solocrm.db'), '', 'utf-8')

    const secondDialog = unusedDialog()
    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog: secondDialog })

    expect(outcome).toEqual({ kind: 'existing-install' })
  })

  it('the folder picker is labelled, titled, and opens at the default root', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    // Choose a folder…, cancel, Quit.
    const dialog = scriptedDialog([1, 2], [{ canceled: true, filePaths: [] }])

    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(dialog.openDialogCalls).toHaveLength(1)
    const picker = dialog.openDialogCalls[0]
    expect(picker.properties).toEqual(['openDirectory', 'createDirectory'])
    expect(picker.title).toContain('Solo CRM')
    expect(picker.defaultPath).toBe(userDataDir)
    expect(picker.buttonLabel).toBeTruthy()
  })

  it('"Choose a folder…" with a valid empty directory writes the pointer at that folder', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const chosen = trackedTmpDir('solo-crm-firstrun-chosen-')
    const dialog = scriptedDialog([1], [{ canceled: false, filePaths: [chosen] }])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'folder-chosen', dataRoot: chosen })
    expect(pointerContents(userDataDir)).toEqual({ dataRoot: chosen })
  })

  it('cancelling the folder picker returns to the choice rather than defaulting', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    // Choose a folder…, cancel the picker, then Quit.
    const dialog = scriptedDialog([1, 2], [{ canceled: true, filePaths: [] }])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'quit' })
    expect(dialog.messageBoxCalls).toHaveLength(2) // shown again after the cancel
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
  })

  it('a sync-folder pick re-prompts naming the offending path and writes no pointer', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const parent = trackedTmpDir('solo-crm-firstrun-parent-')
    const dropboxFolder = join(parent, 'Dropbox')
    // The folder itself does not need to exist for findSyncFolderMatch — it
    // matches on path segments, not filesystem state.
    // Choose a folder… -> pick the Dropbox path -> refusal OK -> Quit.
    const dialog = scriptedDialog([1, 0, 2], [{ canceled: false, filePaths: [dropboxFolder] }])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'quit' })
    expect(dialog.messageBoxCalls).toHaveLength(3)
    const refusal = dialog.messageBoxCalls[1]
    expect(refusal.detail).toContain(dropboxFolder)
    expect(refusal.detail).toContain('Dropbox')
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
  })

  it('"Quit" exits with no pointer file written', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const dialog = scriptedDialog([2])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'quit' })
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
    expect(existsSync(join(userDataDir, 'solocrm.db'))).toBe(false)
  })

  it('the message distinguishes this folder from the installer\'s install directory', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const dialog = scriptedDialog([2])

    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    const shown = dialog.messageBoxCalls[0]
    expect(shown.detail?.toLowerCase()).toContain('install')
    expect(shown.detail).toContain('solocrm.db')
  })
})

/**
 * T-260828-57: the chooser had its own half of the sync-folder guard — the
 * match check without the override — so a user who had deliberately set
 * `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` could not pick the folder they had just
 * enabled, and the refusal never mentioned the override at all. Both halves
 * now come from `findBlockingSyncFolderMatch`, so this screen reaches the
 * same verdict `openDatabase()` will reach a moment later.
 */
describe('the sync-folder guard at pick time honours the documented override', () => {
  it(`accepts a synced folder when ${SYNC_FOLDER_GUARD_OVERRIDE_ENV}=1 is set`, async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const parent = trackedTmpDir('solo-crm-firstrun-parent-')
    const dropboxFolder = join(parent, 'Dropbox')
    // Created for real, because a pick that gets past the guard still has
    // to get past the writability probe — the override lets the user
    // through the guard, not through every other check.
    mkdirSync(dropboxFolder, { recursive: true })
    const dialog = scriptedDialog([1], [{ canceled: false, filePaths: [dropboxFolder] }])

    const outcome = await withSyncFolderOverride(() =>
      runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })
    )

    expect(outcome).toEqual({ kind: 'folder-chosen', dataRoot: dropboxFolder })
    expect(pointerContents(userDataDir)).toEqual({ dataRoot: dropboxFolder })
  })

  it('names the override in the refusal when it is what would allow the pick', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const parent = trackedTmpDir('solo-crm-firstrun-parent-')
    const dropboxFolder = join(parent, 'Dropbox')
    const dialog = scriptedDialog([1, 0, 2], [{ canceled: false, filePaths: [dropboxFolder] }])

    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(dialog.messageBoxCalls[1].detail).toContain(SYNC_FOLDER_GUARD_OVERRIDE_ENV)
  })
})

describe('a chosen folder is proven writable before the pointer is committed', () => {
  it('returns to the choice and leaves no pointer file when the folder cannot be written to', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const parent = trackedTmpDir('solo-crm-firstrun-parent-')
    // A path under an existing parent that does not itself exist — the
    // deterministic, cross-platform stand-in for the read-only folder,
    // disconnected drive and unavailable network share this probe exists to
    // catch (a POSIX chmod would not reproduce any of them on Windows).
    const unwritable = join(parent, 'not-there')
    // Choose a folder… -> pick it -> "cannot be used" -> Quit.
    const dialog = scriptedDialog([1, 0, 2], [{ canceled: false, filePaths: [unwritable] }])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'quit' })
    expect(dialog.messageBoxCalls).toHaveLength(3) // choice, refusal, choice again
    expect(dialog.messageBoxCalls[1].detail).toContain(unwritable)
    // The failure this exists to prevent: a pointer committed for a folder
    // that cannot hold a database, after which every launch reports
    // existing-install and dies on "unable to open database file".
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
  })

  it('leaves nothing behind in a folder it accepted', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const chosen = trackedTmpDir('solo-crm-firstrun-chosen-')
    const dialog = scriptedDialog([1], [{ canceled: false, filePaths: [chosen] }])

    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    // The probe cleans up after itself: a folder the user was only
    // considering must not end up with a stray file in it (this task's
    // Risks).
    expect(readdirSync(chosen)).toEqual([])
  })
})

describe('the "use the default" behaviour and ADR-006 agree', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const adrPath = join(repoRoot, '.dev', 'decisions', 'ADR-006-data-root-pointer-file.md')

  it('ADR-006 still states that no pointer file present is the default', () => {
    // The code below writes no pointer for "use the default" *because* the
    // ADR says this. If the ADR is ever amended to pin the default instead,
    // this fails and the two are reconciled deliberately rather than
    // drifting apart in silence (T-260828-57's Acceptance).
    const adr = readFileSync(adrPath, 'utf-8')
    expect(adr).toContain('No pointer file present is the default')
  })

  it('and the chooser writes no pointer for that choice', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const dialog = scriptedDialog([0])

    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
  })
})
