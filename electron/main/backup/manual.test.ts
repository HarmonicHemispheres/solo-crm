import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../db/connection'
import { createCompany, listCompanies } from '../db/repositories/companies'
import { ValidationError } from '../db/repositories/errors'
import { getSetting } from '../db/repositories/settings'
import { backupFileName, runManualBackup, type BackupDialog, type ManualBackupDeps } from './manual'

/**
 * The manual backup, driven end to end against a real database with a fake
 * dialog — the same arrangement `images/picker.test.ts` uses, for the same
 * reason: no automated test can click a native dialog, and `electron` is not
 * a callable value outside a real Electron process.
 *
 * `electron` is mocked only so the module loads; every test passes its own
 * `dialog` and `windows`, and `documentsDir`, so nothing here reaches the
 * mock's members.
 */
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('app.getPath should not be called — every test here passes documentsDir')
    }
  },
  BrowserWindow: {
    getFocusedWindow: () => {
      throw new Error('BrowserWindow should not be reached — every test here passes windows')
    }
  },
  dialog: {}
}))

const dirs: string[] = []

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  closeDatabase()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A dialog that answers a fixed path (or a cancel), recording what it was asked. */
function fakeDialog(answer: { canceled: boolean; filePath?: string }) {
  const calls: Array<Record<string, unknown>> = []
  const dialog: BackupDialog = {
    showSaveDialog: async (_window, options) => {
      calls.push(options)
      return answer
    }
  }
  return { dialog, calls }
}

const FIXED_NOW = new Date('2026-09-04T14:32:00')

function deps(dialog: BackupDialog, extra: Partial<ManualBackupDeps> = {}): ManualBackupDeps {
  return { dialog, windows: { getFocusedWindow: () => ({}) }, documentsDir: tmp('solo-crm-backup-docs-'), now: () => FIXED_NOW, ...extra }
}

describe('backupFileName', () => {
  it('names the day and minute in local time, so two backups an hour apart do not collide', () => {
    expect(backupFileName(FIXED_NOW)).toBe('solocrm-backup-2026-09-04-1432.db')
  })
})

describe('runManualBackup', () => {
  it('copies every committed row — including ones still in the WAL — into a self-contained file, and records when', async () => {
    const dataDir = tmp('solo-crm-backup-live-')
    openDatabase({ userDataDir: dataDir })
    const db = getDatabase()
    // A row committed and never checkpointed: in WAL mode it lives in the
    // `-wal` sidecar, which a plain file copy of `solocrm.db` would miss.
    createCompany(db, { name: 'In The WAL Co' })

    // The copy is written where a *second* data root would look for its
    // database, so the assertion can open it through the one sanctioned
    // opener rather than constructing a connection by hand.
    const copyDir = tmp('solo-crm-backup-copy-')
    const target = join(copyDir, 'solocrm.db')
    const { dialog, calls } = fakeDialog({ canceled: false, filePath: target })

    const result = await runManualBackup(db, deps(dialog))

    expect(result.outcome).toBe('written')
    if (result.outcome !== 'written') return
    expect(result.path).toBe(target)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.completedAt).toBe(FIXED_NOW.toISOString())
    expect(getSetting(db, 'backup.lastRunAt')).toBe(result.completedAt)
    // The dialog was offered the Documents folder (no `backup.folder` set)
    // and the dated filename.
    expect(String(calls[0]?.defaultPath).endsWith('solocrm-backup-2026-09-04-1432.db')).toBe(true)
    // A real SQLite file, not a stream copy that stopped early.
    expect(readFileSync(target).subarray(0, 15).toString('utf-8')).toBe('SQLite format 3')

    closeDatabase()
    openDatabase({ userDataDir: copyDir })
    expect(listCompanies(getDatabase()).map((company) => company.name)).toEqual(['In The WAL Co'])
  })

  it('opens the dialog on the configured backup folder when there is one', async () => {
    openDatabase({ userDataDir: tmp('solo-crm-backup-live-') })
    const db = getDatabase()
    const folder = tmp('solo-crm-backup-folder-')
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('backup.folder', ?, ?)").run(JSON.stringify(folder), FIXED_NOW.toISOString())
    const { dialog, calls } = fakeDialog({ canceled: true })

    expect(await runManualBackup(db, deps(dialog))).toEqual({ outcome: 'cancelled' })
    expect(String(calls[0]?.defaultPath).startsWith(folder)).toBe(true)
  })

  it('a cancelled dialog writes nothing and records nothing', async () => {
    openDatabase({ userDataDir: tmp('solo-crm-backup-live-') })
    const db = getDatabase()
    const { dialog } = fakeDialog({ canceled: true })

    expect(await runManualBackup(db, deps(dialog))).toEqual({ outcome: 'cancelled' })
    expect(getSetting(db, 'backup.lastRunAt')).toBeNull()
  })

  it('refuses the live database and its sidecars as a destination, before touching anything', async () => {
    const dataDir = tmp('solo-crm-backup-live-')
    openDatabase({ userDataDir: dataDir })
    const db = getDatabase()

    for (const name of ['solocrm.db', 'SOLOCRM.DB', 'solocrm.db-wal', 'solocrm.db-shm']) {
      // Case-insensitive only where the filesystem is; on other platforms the
      // upper-cased spelling names a different file, which is allowed.
      if (name === 'SOLOCRM.DB' && process.platform !== 'win32') continue
      const { dialog } = fakeDialog({ canceled: false, filePath: join(dataDir, name) })
      await expect(runManualBackup(db, deps(dialog))).rejects.toBeInstanceOf(ValidationError)
    }
    expect(getSetting(db, 'backup.lastRunAt')).toBeNull()
  })

  it('refuses with no focused window, without opening the dialog', async () => {
    openDatabase({ userDataDir: tmp('solo-crm-backup-live-') })
    const { dialog, calls } = fakeDialog({ canceled: false, filePath: join(tmp('x-'), 'copy.db') })

    await expect(runManualBackup(getDatabase(), deps(dialog, { windows: { getFocusedWindow: () => null } }))).rejects.toBeInstanceOf(
      ValidationError
    )
    expect(calls).toEqual([])
  })

  it('reports an unwritable destination as a path-free refusal', async () => {
    openDatabase({ userDataDir: tmp('solo-crm-backup-live-') })
    const missingDir = join(tmp('solo-crm-backup-gone-'), 'no', 'such', 'folder')
    const target = join(missingDir, 'copy.db')
    const { dialog } = fakeDialog({ canceled: false, filePath: target })

    let thrown: unknown
    try {
      await runManualBackup(getDatabase(), deps(dialog))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ValidationError)
    expect((thrown as Error).message).not.toContain(missingDir)
    expect(existsSync(target)).toBe(false)
  })
})
