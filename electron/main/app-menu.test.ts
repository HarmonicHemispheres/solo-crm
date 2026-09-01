import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildApplicationMenuTemplate,
  promptAndMoveDataFolder,
  type MoveDataFolderDialog
} from './app-menu'
import type { MoveDataRootResult } from './db/move-data-root'

/**
 * T-260828-19's entry point, driven through the same structural
 * `showMessageBox`/`showOpenDialog` seam `data-location-prompt.test.ts` uses:
 * `electron` cannot be imported as a real, callable value outside a genuine
 * Electron process, so a plain fake object is what makes the whole
 * conversation testable without spawning one.
 *
 * The move itself is injected here too. What is under test in this file is
 * the conversation — which folder is offered, what the user is told, and
 * that cancelling at any point does nothing at all — not the filesystem
 * work, which `move-data-root.test.ts` covers against real databases.
 */

const cleanupDirs: string[] = []

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function trackedTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-menu-'))
  cleanupDirs.push(dir)
  return dir
}

type MessageBoxOptions = Parameters<MoveDataFolderDialog['showMessageBox']>[0]

interface FakeDialog extends MoveDataFolderDialog {
  readonly shown: MessageBoxOptions[]
  readonly openCalls: Array<Parameters<MoveDataFolderDialog['showOpenDialog']>[0]>
}

/** `responses` are consumed one per message box, defaulting to button 0. */
function fakeDialog(responses: number[], picked: { canceled: boolean; filePaths: string[] }): FakeDialog {
  const shown: MessageBoxOptions[] = []
  const openCalls: Array<Parameters<MoveDataFolderDialog['showOpenDialog']>[0]> = []
  const queue = [...responses]
  return {
    shown,
    openCalls,
    showMessageBox: (options) => {
      shown.push(options)
      return Promise.resolve({ response: queue.shift() ?? 0 })
    },
    showOpenDialog: (options) => {
      openCalls.push(options)
      return Promise.resolve(picked)
    }
  }
}

const MOVED: MoveDataRootResult = {
  kind: 'moved',
  previousRoot: 'C:\\old',
  newRoot: 'C:\\new',
  leftBehind: ['C:\\old\\solocrm.db']
}

describe('the Move Data Folder… menu item', () => {
  it('is in the template, labelled, and wired to the flow — alongside the standard roles', () => {
    const clicked = vi.fn()
    const template = buildApplicationMenuTemplate(clicked)

    // Setting an application menu replaces Electron's default one, so the
    // standard roles have to be rebuilt rather than dropped.
    expect(template.map((item) => item.role)).toContain('editMenu')
    expect(template.map((item) => item.role)).toContain('viewMenu')

    const data = template.find((item) => item.label === 'Data')
    expect(data).toBeDefined()
    const submenu = data?.submenu as Array<{ label?: string; click?: () => void }>
    const move = submenu.find((item) => item.label === 'Move Data Folder…')
    expect(move).toBeDefined()

    move?.click?.()
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  /**
   * T-260831-06 / ADR-013 Decision 6: a portable copy keeps its data beside
   * its own `.exe`, so there is nothing for this item to do. T-260831-03 made
   * the attempt fail loudly (`PortableDataRootPointerError`); this is what
   * stops an operator having to hit that wall to learn it.
   */
  it('is disabled, and says why in its own label, on a portable launch', () => {
    const clicked = vi.fn()
    const template = buildApplicationMenuTemplate(clicked, { portable: true })

    const submenu = template.find((item) => item.label === 'Data')?.submenu as Array<{
      label?: string
      enabled?: boolean
      click?: () => void
    }>

    // Still there, still first in the Data menu — an operator who knows the
    // feature exists is told why it is unavailable rather than left hunting
    // a menu that no longer admits it.
    expect(submenu).toHaveLength(1)
    const move = submenu[0]
    expect(move?.enabled).toBe(false)

    // A menu has no tooltip and no help text, so anything not in the label
    // is not said at all. The label carries the reason *and* the real
    // alternative — move the .exe.
    expect(move?.label).toContain('Move Data Folder…')
    expect(move?.label).toContain('Solo CRM.exe')

    // No handler at all, rather than a no-op: the disabled flag is the
    // enforcement, and a second one waiting behind it could only disagree.
    expect(move?.click).toBeUndefined()
    expect(clicked).not.toHaveBeenCalled()
  })

  it('is untouched when the launch is not portable', () => {
    // The default and the explicit `false` are the same menu, and it is the
    // same menu T-260828-19 shipped — the third acceptance criterion's
    // "unchanged otherwise".
    const labelsFor = (portable: boolean | undefined) => {
      const template =
        portable === undefined
          ? buildApplicationMenuTemplate(vi.fn())
          : buildApplicationMenuTemplate(vi.fn(), { portable })
      const submenu = template.find((item) => item.label === 'Data')?.submenu as Array<{
        label?: string
        enabled?: boolean
      }>
      return submenu.map((item) => [item.label, item.enabled])
    }

    expect(labelsFor(undefined)).toEqual([['Move Data Folder…', undefined]])
    expect(labelsFor(false)).toEqual([['Move Data Folder…', undefined]])
  })
})

describe('promptAndMoveDataFolder', () => {
  it('offers the current data root, confirms, moves, and reports where the originals are', async () => {
    const userDataDir = trackedTmpDir()
    const dialog = fakeDialog([0, 0], { canceled: false, filePaths: ['C:\\new'] })
    const move = vi.fn(() => MOVED)

    const outcome = await promptAndMoveDataFolder({ dialog, userDataDir, move })

    expect(outcome).toEqual(MOVED)
    expect(move).toHaveBeenCalledWith('C:\\new', { userDataDir })

    // The picker opens at the folder the data is in now, so "somewhere
    // else" is a move from a known starting point.
    expect(dialog.openCalls[0]?.defaultPath).toBe(userDataDir)
    expect(dialog.openCalls[0]?.properties).toContain('createDirectory')

    // Warned before the copy that the app will be unresponsive — a frozen
    // window that was never explained reads as a crash.
    expect(dialog.shown[1]?.detail).toContain('unresponsive')

    // Told where the originals are, and that nothing was deleted.
    const report = dialog.shown[2]
    expect(report?.detail).toContain('C:\\new')
    expect(report?.detail).toContain('C:\\old\\solocrm.db')
    expect(report?.detail).toContain('nothing was deleted')
  })

  it('cancelling at the first prompt, at the picker, or at the confirmation moves nothing', async () => {
    const userDataDir = trackedTmpDir()
    const move = vi.fn(() => MOVED)

    const atIntro = fakeDialog([1], { canceled: false, filePaths: ['C:\\new'] })
    expect(await promptAndMoveDataFolder({ dialog: atIntro, userDataDir, move })).toEqual({ kind: 'cancelled' })

    const atPicker = fakeDialog([0], { canceled: true, filePaths: [] })
    expect(await promptAndMoveDataFolder({ dialog: atPicker, userDataDir, move })).toEqual({ kind: 'cancelled' })

    const atConfirm = fakeDialog([0, 1], { canceled: false, filePaths: ['C:\\new'] })
    expect(await promptAndMoveDataFolder({ dialog: atConfirm, userDataDir, move })).toEqual({ kind: 'cancelled' })

    expect(move).not.toHaveBeenCalled()
  })

  it('shows a refusal verbatim — the operation writes the message, this file does not restate it', async () => {
    const userDataDir = trackedTmpDir()
    const refusal: MoveDataRootResult = {
      kind: 'refused',
      code: 'not-empty',
      message: '"C:\\new" is not empty.',
      dataRoot: 'C:\\old'
    }
    const dialog = fakeDialog([0, 0], { canceled: false, filePaths: ['C:\\new'] })

    const outcome = await promptAndMoveDataFolder({ dialog, userDataDir, move: () => refusal })

    expect(outcome).toEqual(refusal)
    expect(dialog.shown[2]?.detail).toContain('"C:\\new" is not empty.')
  })

  it('tells the user to restart when the move succeeded but the connection could not be reopened', async () => {
    const userDataDir = trackedTmpDir()
    const dialog = fakeDialog([0, 0], { canceled: false, filePaths: ['C:\\new'] })

    await promptAndMoveDataFolder({
      dialog,
      userDataDir,
      move: () => ({ ...MOVED, reopenError: 'disk went away' })
    })

    expect(dialog.shown[2]?.detail).toContain('Quit and start Solo CRM again')
  })
})
