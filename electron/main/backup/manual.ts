import { stat as statOnDisk } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog as electronDialog } from 'electron'
import type Database from 'better-sqlite3'
import type { ManualBackupResult } from '../../shared/backup'
import { formatTimestamp } from '../../shared/format'
import { getSetting, setSetting } from '../db/repositories/settings'
import { ValidationError } from '../db/repositories/errors'

/**
 * A manual backup (`backup:run`) — the operator presses a button on the
 * Backup settings card, picks where the copy goes in a native save dialog,
 * and the live database is copied there.
 *
 * ## An online copy, not a file copy
 *
 * The connection is in WAL mode (`electron/db/connection.ts`'s
 * `applyPragmas`), which means a row committed a moment ago may sit in the
 * `-wal` sidecar rather than in `solocrm.db`. Copying the main file alone
 * would silently miss it — the exact failure that file's comment warns X-04
 * about. So this uses SQLite's own backup API (`db.backup(...)`), which
 * reads through the open connection and writes a self-contained database:
 * every committed row, one file, no sidecars, and no need to close or
 * checkpoint the live connection to do it.
 *
 * ## What the dialog is for
 *
 * The `backup.folder` setting has no picker yet (the Backup card says so),
 * so a manual backup cannot assume a destination. A save dialog asks every
 * time, defaulting to that folder when it is set and to the Documents folder
 * otherwise, with a filename that names the day and minute so two backups
 * an hour apart do not overwrite each other. The operator can put it
 * anywhere — including a synced folder, which is fine for a *copy*: the
 * sync-folder guard exists for the live database that SQLite holds open,
 * not for a static file nobody will open in place.
 *
 * ## What is refused
 *
 * - No focused window: the dialog needs a parent, and opening it parentless
 *   is how it ends up behind the app. Same rule as the image picker.
 * - The live database itself as the destination: `db.backup` onto its own
 *   source would clobber the file it is reading.
 * - A write that fails: the message is path-free, like every refusal the
 *   image picker writes, because Node's own `fs` errors embed the absolute
 *   path in `.message` and `registry.ts` relays a `RepositoryError`'s message
 *   verbatim. The *success* branch carries the path, deliberately
 *   (`electron/shared/backup.ts`).
 *
 * `deps` exists for tests, which pass a fake dialog and window source
 * rather than a native dialog no automated test can click — the same
 * structural-type arrangement `images/picker.ts` uses.
 */

/** The narrow slice of `Electron.Dialog` a save dialog needs. Structural, so tests can pass a plain object. */
export interface BackupDialog {
  showSaveDialog(
    window: object,
    options: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }
  ): Promise<{ canceled: boolean; filePath?: string }>
}

export interface BackupWindowSource {
  getFocusedWindow(): object | null
}

export interface ManualBackupDeps {
  /** Tests only — production gets the real `electron` `dialog` singleton. */
  readonly dialog?: BackupDialog
  /** Tests only — production gets `BrowserWindow`. */
  readonly windows?: BackupWindowSource
  /** Tests only — production gets `app.getPath('documents')`. Where the dialog opens when `backup.folder` is unset. */
  readonly documentsDir?: string
  /** Tests only — a fixed clock for the filename and the recorded timestamp. */
  readonly now?: () => Date
}

/** `solocrm-backup-2026-09-04-1432.db` — the day and minute, in local time, since that is the clock the operator reads when looking for the file. */
export function backupFileName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
  return `solocrm-backup-${stamp}.db`
}

/** Case-insensitive on Windows, where `C:\Data\solocrm.db` and `c:\data\SOLOCRM.DB` are one file. */
function samePath(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

export async function runManualBackup(db: Database.Database, deps: ManualBackupDeps = {}): Promise<ManualBackupResult> {
  const windows = deps.windows ?? BrowserWindow
  const dialog = deps.dialog ?? electronDialog
  const now = deps.now ?? (() => new Date())

  const parent = windows.getFocusedWindow()
  if (parent == null) {
    throw new ValidationError('No window is focused to open the save dialog over. Click into the app and try again.')
  }

  const folder = getSetting(db, 'backup.folder')
  const directory = folder !== '' ? folder : (deps.documentsDir ?? app.getPath('documents'))
  const picked = await dialog.showSaveDialog(parent, {
    title: 'Save a backup of Solo CRM’s data',
    defaultPath: join(directory, backupFileName(now())),
    buttonLabel: 'Save backup',
    filters: [{ name: 'SQLite database', extensions: ['db'] }]
  })
  if (picked.canceled || picked.filePath == null || picked.filePath === '') return { outcome: 'cancelled' }

  const target = picked.filePath
  // `db.name` is the path the connection was opened on — the live file.
  if (samePath(target, db.name)) {
    throw new ValidationError('That is the live database itself. Choose a different file for the backup.')
  }
  // Its sidecars too: overwriting `solocrm.db-wal` with a database is not a
  // backup, it is a corruption of the live one on next open.
  if (samePath(dirname(target), dirname(db.name)) && basename(target).startsWith(`${basename(db.name)}-`)) {
    throw new ValidationError('That name would overwrite one of the live database’s own files. Choose a different one.')
  }

  try {
    await db.backup(target)
  } catch {
    throw new ValidationError('The backup could not be written there. Check the folder exists, is writable and has space, then try again.')
  }

  let bytes = 0
  try {
    bytes = (await statOnDisk(target)).size
  } catch {
    // The copy succeeded; its size is a courtesy. A stat that fails on a
    // file we just wrote is odd but not a reason to report the backup as
    // failed.
  }

  const completedAt = formatTimestamp(now())
  setSetting(db, 'backup.lastRunAt', completedAt)
  return { outcome: 'written', path: target, bytes, completedAt }
}
