import { Menu, dialog as electronDialog, type MenuItemConstructorOptions } from 'electron'
import { resolveDataRoot } from './db/data-root'
import { moveDataRoot, type MoveDataRootResult } from './db/move-data-root'

/**
 * T-260828-19's entry point. The task's Scope allows a menu item where
 * Workspace settings (§6.11, P2-01) has not landed, and it has not: there is
 * no settings surface to hang this off, and building one to host a single
 * action would be building P2-01 by the back door. **A menu item is what was
 * used** — `Data ▸ Move Data Folder…` — and it is deliberately the whole
 * user interface for this feature until P2-01 exists, at which point this
 * flow is the thing that view calls.
 *
 * The move itself is `db/move-data-root.ts`; nothing here decides anything
 * about the filesystem. This file owns only the conversation: warn, pick,
 * confirm, report — the same split (decision in one module, dialogs at the
 * call site) that `data-location-prompt.ts` uses for the first-run choice,
 * and the reason both are testable without an Electron process.
 *
 * Setting an application menu replaces Electron's default one, so the
 * standard roles are rebuilt below rather than dropped: losing Copy/Paste
 * and the developer tools to gain one item would be a bad trade nobody
 * asked for.
 */

/**
 * The narrow slice of `Electron.Dialog` this flow needs — a structural type
 * rather than the imported `dialog` value, mirroring
 * `data-location-prompt.ts`'s `FirstRunDialog` for the same reason:
 * `electron` cannot be imported as a real, callable value outside a genuine
 * Electron process, so a structural type is what lets the whole flow be
 * driven by a plain fake object in tests.
 */
export interface MoveDataFolderDialog {
  showMessageBox(options: {
    type?: 'question' | 'warning' | 'info'
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
    title?: string
    defaultPath?: string
    buttonLabel?: string
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}

export interface MoveDataFolderPromptOptions {
  /** Tests only — production gets the real `electron` `dialog` singleton. */
  dialog?: MoveDataFolderDialog
  /** Tests only, same discipline as `OpenDatabaseOptions.userDataDir`. */
  userDataDir?: string
  /**
   * Tests only: the move operation itself. Production uses `moveDataRoot`.
   * Injected so this file's conversation — which folder was offered, what
   * the user is told afterwards — can be tested without copying a real
   * database for every branch.
   */
  move?: (target: string, options: { userDataDir?: string }) => MoveDataRootResult
}

const BUTTON_CHOOSE = 0
const BUTTON_CANCEL = 1

export type MoveDataFolderOutcome = MoveDataRootResult | { readonly kind: 'cancelled' }

function buildIntroMessageBox(currentRoot: string): Parameters<MoveDataFolderDialog['showMessageBox']>[0] {
  return {
    type: 'question',
    title: 'Move Solo CRM’s data folder',
    message: 'Move Solo CRM’s data folder?',
    detail:
      `Solo CRM currently keeps its data in:\n${currentRoot}\n\nChoose an empty folder to move it to. Solo CRM ` +
      `copies the database, checks the copy, and only then starts using the new folder. The files in the ` +
      `current folder are left exactly where they are — nothing is deleted.`,
    buttons: ['Choose a new folder…', 'Cancel'],
    defaultId: BUTTON_CHOOSE,
    cancelId: BUTTON_CANCEL,
    noLink: true
  }
}

/**
 * Shown after the folder is picked and before the copy starts. The copy is
 * synchronous — the database is the app's entire state and nothing may
 * write to it while it moves — so the window is unresponsive for as long as
 * it takes, and a frozen window that was never explained reads as a crash
 * and invites the force-quit this operation is ordered to survive but which
 * nobody should be invited into (this task's Risks). A real progress
 * indicator needs a window that keeps painting during the copy; that
 * belongs with P2-01's settings surface, not with a menu item.
 */
function buildConfirmMessageBox(target: string): Parameters<MoveDataFolderDialog['showMessageBox']>[0] {
  return {
    type: 'question',
    title: 'Move Solo CRM’s data folder',
    message: `Move Solo CRM’s data to “${target}”?`,
    detail:
      `Solo CRM will be unresponsive while it copies — for a large database this can take a while. Please do ` +
      `not quit until it finishes.`,
    buttons: ['Move', 'Cancel'],
    defaultId: BUTTON_CHOOSE,
    cancelId: BUTTON_CANCEL,
    noLink: true
  }
}

function buildResultMessageBox(result: MoveDataRootResult): Parameters<MoveDataFolderDialog['showMessageBox']>[0] {
  const restart = result.reopenError
    ? `\n\nSolo CRM could not reopen its database in this session (${result.reopenError}). Quit and start ` +
      `Solo CRM again.`
    : ''

  if (result.kind === 'moved') {
    return {
      type: 'info',
      title: 'Solo CRM’s data has moved',
      message: 'Solo CRM’s data has moved',
      detail:
        `Solo CRM is now using:\n${result.newRoot}\n\nThe original files have been left where they were, and ` +
        `nothing was deleted:\n${result.leftBehind.join('\n')}\n\nOnce you are satisfied the move worked, you ` +
        `can remove them yourself.${restart}`,
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0
    }
  }

  return {
    type: 'warning',
    title: 'The data folder was not moved',
    message: 'The data folder was not moved',
    detail: `${result.message}${restart}`,
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0
  }
}

/**
 * Warn → pick → confirm → move → report. Cancelling at any point returns
 * `cancelled` with nothing touched; every other outcome is
 * `moveDataRoot`'s own result, reported to the user and returned to the
 * caller (which is the menu item, and — later — a test or P2-01's view).
 */
export async function promptAndMoveDataFolder(
  options: MoveDataFolderPromptOptions = {}
): Promise<MoveDataFolderOutcome> {
  const dialog = options.dialog ?? electronDialog
  const userDataDir = options.userDataDir
  const move = options.move ?? moveDataRoot
  const currentRoot = resolveDataRoot({ userDataDir })

  const intro = await dialog.showMessageBox(buildIntroMessageBox(currentRoot))
  if (intro.response !== BUTTON_CHOOSE) return { kind: 'cancelled' }

  const picked = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose the folder for Solo CRM’s data',
    defaultPath: currentRoot,
    buttonLabel: 'Use this folder'
  })
  if (picked.canceled || picked.filePaths.length === 0) return { kind: 'cancelled' }

  const target = picked.filePaths[0]

  const confirm = await dialog.showMessageBox(buildConfirmMessageBox(target))
  if (confirm.response !== BUTTON_CHOOSE) return { kind: 'cancelled' }

  const result = move(target, { userDataDir })
  await dialog.showMessageBox(buildResultMessageBox(result))
  return result
}

/**
 * The application menu: Electron's standard roles, plus the one item this
 * task adds. Built as a template (rather than installed directly) so a test
 * can assert the item exists, is labelled, and is wired to the flow above
 * without an Electron process to hang a real menu on.
 */
export function buildApplicationMenuTemplate(onMoveDataFolder: () => void): MenuItemConstructorOptions[] {
  return [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Data',
      submenu: [
        {
          label: 'Move Data Folder…',
          click: onMoveDataFolder
        }
      ]
    },
    { role: 'windowMenu' }
  ]
}

/**
 * Installs the menu. Called once from `index.ts` after the database is
 * open — the flow reads the current data root to show it, and the move
 * closes and reopens the connection, neither of which is meaningful before
 * `openDatabase()`.
 */
export function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate(() => {
        promptAndMoveDataFolder().catch((error: unknown) => {
          // A dialog that fails is not a reason to take the app down: the
          // move either happened or did not, and both states are safe by
          // construction. Reported rather than swallowed silently.
          console.error('[main] the data-folder move flow failed:', error)
        })
      })
    )
  )
}
