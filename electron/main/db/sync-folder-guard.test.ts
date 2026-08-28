import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SYNC_FOLDER_GUARD_OVERRIDE_ENV,
  SYNC_FOLDER_MARKERS,
  SyncFolderGuardError,
  findSyncFolderMatch,
  isSyncFolderGuardOverridden,
  realpathWithFallback
} from './sync-folder-guard'

// This suite proves the acceptance criterion "unit tests cover the match
// logic without needing those folders present": every case below builds its
// own plain temp directory tree rather than touching a real Google
// Drive/Dropbox/iCloud/OneDrive install.

const cleanupDirs: string[] = []

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('findSyncFolderMatch: matching', () => {
  it.each(SYNC_FOLDER_MARKERS)('refuses a path with a "%s" segment', (marker) => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const syncDir = join(tmpDir, marker)
    mkdirSync(syncDir, { recursive: true })
    const dbPath = join(syncDir, 'userData', 'solocrm.db')

    const match = findSyncFolderMatch(dbPath)

    expect(match).not.toBeNull()
    expect(match?.marker).toBe(marker)
  })

  it('matches regardless of segment case', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const syncDir = join(tmpDir, 'DROPBOX')
    mkdirSync(syncDir, { recursive: true })
    const dbPath = join(syncDir, 'userData', 'solocrm.db')

    const match = findSyncFolderMatch(dbPath)

    expect(match?.marker).toBe('Dropbox')
  })

  it('matches a path built with the opposite separator convention', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const syncDir = join(tmpDir, 'OneDrive')
    mkdirSync(syncDir, { recursive: true })
    // Deliberately mixes both separators in one string — the on-disk path
    // above uses whatever `join` produced for this OS, this string then
    // rewrites it with the other separator, so both `/` and `\` are proven,
    // not just whichever `path.sep` happens to be on the machine running
    // the suite.
    const mixedSeparatorPath = `${syncDir.split(sep).join('/')}/userData/solocrm.db`
    const backslashPath = mixedSeparatorPath.split('/').join('\\')

    expect(findSyncFolderMatch(mixedSeparatorPath)?.marker).toBe('OneDrive')
    expect(findSyncFolderMatch(backslashPath)?.marker).toBe('OneDrive')
  })

  it('resolves a symlinked ancestor into a sync folder before matching', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-symlink-')
    const realSyncDir = join(tmpDir, 'Dropbox', 'real-user-data')
    mkdirSync(realSyncDir, { recursive: true })

    const linkPath = join(tmpDir, 'userData-link')
    try {
      // 'junction' works on Windows without elevated privileges, unlike a
      // plain directory symlink; it is functionally a directory symlink for
      // the purposes of fs.realpathSync, which is all this test needs.
      symlinkSync(realSyncDir, linkPath, 'junction')
    } catch (error) {
      // Environments that can create neither a junction nor a symlink
      // (unusual, but not this test's concern) skip rather than fail —
      // there would be nothing left to assert.
      console.warn('skipping symlink test: could not create a symlink/junction', error)
      return
    }

    // solocrm.db itself never exists — the guard must run before it does —
    // so this proves the fallback in realpathWithFallback, not just a plain
    // realpathSync on an existing file.
    const dbPath = join(linkPath, 'solocrm.db')

    const match = findSyncFolderMatch(dbPath)

    expect(match).not.toBeNull()
    expect(match?.marker).toBe('Dropbox')
  })
})

describe('findSyncFolderMatch: non-matching', () => {
  it('does not refuse a segment that merely contains a marker as a substring', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const lookalikeDir = join(tmpDir, 'projects', 'dropbox-clone')
    mkdirSync(lookalikeDir, { recursive: true })
    const dbPath = join(lookalikeDir, 'userData', 'solocrm.db')

    expect(findSyncFolderMatch(dbPath)).toBeNull()
  })

  it('does not refuse an ordinary path with no sync-folder segment at all', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const dbPath = join(tmpDir, 'Solo CRM', 'solocrm.db')

    expect(findSyncFolderMatch(dbPath)).toBeNull()
  })

  it('does not refuse a segment that is a marker plus extra characters', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const lookalikeDir = join(tmpDir, 'OneDriveSync')
    mkdirSync(lookalikeDir, { recursive: true })
    const dbPath = join(lookalikeDir, 'solocrm.db')

    expect(findSyncFolderMatch(dbPath)).toBeNull()
  })
})

describe('realpathWithFallback', () => {
  it('resolves an existing path exactly like fs.realpathSync', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    expect(realpathWithFallback(tmpDir).toLowerCase()).toContain('solo-crm-guard-')
  })

  it('resolves the nearest existing ancestor and re-appends the missing tail for a path that does not exist', () => {
    const tmpDir = makeTmpDir('solo-crm-guard-')
    const missingPath = join(tmpDir, 'does-not-exist', 'also-missing', 'solocrm.db')

    const resolved = realpathWithFallback(missingPath)

    expect(resolved.endsWith(join('does-not-exist', 'also-missing', 'solocrm.db'))).toBe(true)
  })
})

describe('isSyncFolderGuardOverridden', () => {
  it(`is off by default (${SYNC_FOLDER_GUARD_OVERRIDE_ENV} unset)`, () => {
    expect(isSyncFolderGuardOverridden({})).toBe(false)
  })

  it('is off for any value other than exactly "1"', () => {
    expect(isSyncFolderGuardOverridden({ [SYNC_FOLDER_GUARD_OVERRIDE_ENV]: 'true' })).toBe(false)
    expect(isSyncFolderGuardOverridden({ [SYNC_FOLDER_GUARD_OVERRIDE_ENV]: 'yes' })).toBe(false)
    expect(isSyncFolderGuardOverridden({ [SYNC_FOLDER_GUARD_OVERRIDE_ENV]: '' })).toBe(false)
  })

  it('is on only when set to exactly "1"', () => {
    expect(isSyncFolderGuardOverridden({ [SYNC_FOLDER_GUARD_OVERRIDE_ENV]: '1' })).toBe(true)
  })
})

describe('SyncFolderGuardError', () => {
  it('names the resolved path, the reason and the override in its message', () => {
    const error = new SyncFolderGuardError({ marker: 'Dropbox', resolvedPath: 'C:\\Users\\kim\\Dropbox\\solocrm.db' })

    expect(error.message).toContain('C:\\Users\\kim\\Dropbox\\solocrm.db')
    expect(error.message).toContain('Dropbox')
    expect(error.message).toMatch(/corrupt/i)
    expect(error.message).toContain(SYNC_FOLDER_GUARD_OVERRIDE_ENV)
    expect(error.name).toBe('SyncFolderGuardError')
  })
})
