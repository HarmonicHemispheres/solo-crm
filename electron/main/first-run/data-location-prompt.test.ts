import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_ROOT_POINTER_FILENAME } from '../db/data-root'
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
): FirstRunDialog & { messageBoxCalls: Array<Parameters<FirstRunDialog['showMessageBox']>[0]> } {
  const messageBoxQueue = [...messageBoxResponses]
  const openDialogQueue = [...openDialogResponses]
  const messageBoxCalls: Array<Parameters<FirstRunDialog['showMessageBox']>[0]> = []

  return {
    messageBoxCalls,
    showMessageBox: vi.fn(async (options) => {
      messageBoxCalls.push(options)
      const response = messageBoxQueue.shift()
      if (response === undefined) {
        throw new Error('scriptedDialog: showMessageBox called more times than scripted')
      }
      return { response }
    }),
    showOpenDialog: vi.fn(async () => {
      const next = openDialogQueue.shift()
      if (next === undefined) {
        throw new Error('scriptedDialog: showOpenDialog called more times than scripted')
      }
      return next
    })
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

  it('"Use the default" writes data-location.json pointing at the default root', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const dialog = scriptedDialog([0])

    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog })

    expect(outcome).toEqual({ kind: 'default-chosen' })
    expect(pointerContents(userDataDir)).toEqual({ dataRoot: userDataDir })
  })

  it('a second call, after the pointer exists, shows no dialog at all', async () => {
    const userDataDir = trackedTmpDir('solo-crm-firstrun-userdata-')
    const firstDialog = scriptedDialog([0])
    await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog: firstDialog })

    const secondDialog = unusedDialog()
    const outcome = await runFirstRunDataLocationPrompt({ skip: false, userDataDir, dialog: secondDialog })

    expect(outcome).toEqual({ kind: 'existing-install' })
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
