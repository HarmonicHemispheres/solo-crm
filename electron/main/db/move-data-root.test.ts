import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type DatabaseType from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDatabaseFileIntegrity, closeDatabase, getDatabase, isDatabaseOpen, openDatabase } from './connection'
import { DATA_ROOT_POINTER_FILENAME, resolveDataRoot, writeDataRootPointer } from './data-root'
import { moveDataRoot } from './move-data-root'
import { SYNC_FOLDER_GUARD_OVERRIDE_ENV } from './sync-folder-guard'

/**
 * T-260828-19. Every test passes an explicit `userDataDir` — the same
 * discipline `connection.test.ts` and `data-root.test.ts` follow, so no test
 * can reach the real `app.getPath('userData')` (which does not exist outside
 * a genuine Electron process anyway).
 *
 * `node:fs` is mocked wholesale with every export left real except
 * `copyFileSync` and `renameSync`, each wrapped in a `vi.fn` that calls
 * through by default — Node's built-in ESM modules are frozen, so replacing
 * the whole module is the only way to make one call fail on demand. Those
 * two are the steps the interruption tests need to break: the copy, and the
 * atomic rename that commits the pointer.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync), renameSync: vi.fn(actual.renameSync) }
})

const cleanupDirs: string[] = []

afterEach(() => {
  closeDatabase()
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
  delete process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV]
})

function trackedTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

/** A directory inside a tracked temp dir, so cleanup is by the parent. */
function subdir(parent: string, name: string): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function pointerPath(userDataDir: string): string {
  return join(userDataDir, DATA_ROOT_POINTER_FILENAME)
}

/**
 * Every user table's row count, keyed by table name — the acceptance
 * criterion is per-table equality, not "the file is about the right size".
 * A table whose count cannot be read records the reason instead: both sides
 * of the comparison record the same thing, so a genuine difference still
 * fails.
 */
function tableCounts(db: DatabaseType.Database): Record<string, string | number> {
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{
      name: string
    }>
  ).map((row) => row.name)

  const counts: Record<string, string | number> = {}
  for (const name of names) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }
      counts[name] = row.n
    } catch (error) {
      counts[name] = error instanceof Error ? error.message : String(error)
    }
  }
  return counts
}

function insertCompany(db: DatabaseType.Database, name: string): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(`id-${name}`, name, now, now)
}

function companyNames(db: DatabaseType.Database): string[] {
  return (db.prepare('SELECT name FROM companies ORDER BY name').all() as Array<{ name: string }>).map((row) => row.name)
}

/** An open app on a fresh default root with three companies in it. */
function bootWithData(): { userDataDir: string; parent: string } {
  const parent = trackedTmpDir('solo-crm-move-')
  const userDataDir = subdir(parent, 'userData')
  openDatabase({ userDataDir })
  const db = getDatabase()
  insertCompany(db, 'Alpha')
  insertCompany(db, 'Beta')
  insertCompany(db, 'Gamma')
  return { userDataDir, parent }
}

describe('moveDataRoot — the happy path', () => {
  it('copies the database to the new root, repoints, reopens, and leaves the original in place', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')

    // The acceptance criterion: a write committed *immediately* before the
    // move must be in the new database. Committed by better-sqlite3's
    // implicit transaction on this statement, and still only in the `-wal`
    // sidecar until the move's checkpoint folds it in.
    insertCompany(getDatabase(), 'Zulu')
    const before = tableCounts(getDatabase())

    const result = moveDataRoot(target, { userDataDir })

    expect(result.kind).toBe('moved')
    if (result.kind !== 'moved') return

    expect(result.newRoot).toBe(target)
    expect(result.previousRoot).toBe(userDataDir)

    // The pointer now names the target, so the next launch resolves there.
    expect(resolveDataRoot({ userDataDir })).toBe(target)
    expect(existsSync(join(target, 'solocrm.db'))).toBe(true)

    // Reopened in this session, on the new root, with the last write in it.
    expect(isDatabaseOpen()).toBe(true)
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma', 'Zulu'])

    // Per-table equality, every table, including the FTS index's own shadow
    // tables — a move that dropped the search index would still open, still
    // pass integrity_check, and still show every company.
    expect(tableCounts(getDatabase())).toEqual(before)
    expect(before.companies).toBe(4)

    expect(checkDatabaseFileIntegrity(join(target, 'solocrm.db'))).toBe('ok')

    // Nothing was deleted, and the user is told where the originals are.
    expect(existsSync(join(userDataDir, 'solocrm.db'))).toBe(true)
    expect(result.leftBehind).toContain(join(userDataDir, 'solocrm.db'))
  })

  it('moves a second time, from the root the first move landed on', () => {
    const { userDataDir, parent } = bootWithData()
    const first = subdir(parent, 'first')
    const second = subdir(parent, 'second')

    expect(moveDataRoot(first, { userDataDir }).kind).toBe('moved')

    const result = moveDataRoot(second, { userDataDir })
    expect(result.kind).toBe('moved')
    if (result.kind !== 'moved') return
    expect(result.previousRoot).toBe(first)
    expect(resolveDataRoot({ userDataDir })).toBe(second)
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('moves with no connection open — and does not open one', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')
    closeDatabase()

    expect(moveDataRoot(target, { userDataDir }).kind).toBe('moved')
    expect(isDatabaseOpen()).toBe(false)
    expect(resolveDataRoot({ userDataDir })).toBe(target)
  })
})

describe('moveDataRoot — targets it refuses, before anything is copied', () => {
  it('refuses a target inside a sync folder, having copied nothing', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(join(parent, 'Dropbox'), 'crm')

    const result = moveDataRoot(target, { userDataDir })

    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('sync-folder')
    expect(result.message).toContain('Dropbox')
    // Nothing copied, nothing repointed, and the app never even closed.
    expect(readdirSync(target)).toEqual([])
    expect(existsSync(pointerPath(userDataDir))).toBe(false)
    expect(isDatabaseOpen()).toBe(true)
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('refuses a target that already contains a solocrm.db', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'occupied')
    writeFileSync(join(target, 'solocrm.db'), 'someone else’s database', 'utf-8')

    const result = moveDataRoot(target, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('target-has-database')
    expect(existsSync(pointerPath(userDataDir))).toBe(false)
  })

  it('refuses a target that is not empty', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'busy')
    writeFileSync(join(target, 'notes.txt'), 'mine', 'utf-8')

    const result = moveDataRoot(target, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('not-empty')
  })

  it('refuses the folder the data is already in', () => {
    const { userDataDir } = bootWithData()
    const result = moveDataRoot(userDataDir, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('same-root')
  })

  it('refuses a folder that does not exist, and a relative path', () => {
    const { userDataDir, parent } = bootWithData()

    const missing = moveDataRoot(join(parent, 'nowhere'), { userDataDir })
    expect(missing.kind === 'refused' && missing.code).toBe('not-a-directory')

    const relative = moveDataRoot('somewhere-relative', { userDataDir })
    expect(relative.kind === 'refused' && relative.code).toBe('not-absolute')
  })

  it('allows a sync-folder target when the documented override is set — one guard, one answer', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(join(parent, 'Dropbox'), 'crm')
    process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV] = '1'

    // The point is not that this is a good idea — it is that this screen
    // reaches the same verdict `openDatabase()` would, rather than a
    // stricter one of its own (T-260828-57).
    expect(moveDataRoot(target, { userDataDir }).kind).toBe('moved')
  })
})

describe('moveDataRoot — a failure at any step leaves the app on the original root', () => {
  it('a failed copy: pointer untouched, target cleaned, app reopened where it was', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')

    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw new Error('simulated disk full')
    })

    const result = moveDataRoot(target, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('copy-failed')
    expect(result.reopenError).toBeUndefined()

    expect(existsSync(pointerPath(userDataDir))).toBe(false)
    expect(readdirSync(target)).toEqual([])
    expect(isDatabaseOpen()).toBe(true)
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('a copy that produces an unsound database: refused on the integrity check, copy removed', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')

    // The failure mode the verify step exists for: the copy "succeeds" and
    // what lands is not a database. Truncated, half-flushed, or written by
    // a filesystem that lied about the write — the app cannot tell which,
    // and does not have to.
    vi.mocked(copyFileSync).mockImplementationOnce((_from, to) => {
      writeFileSync(to as string, 'not a database', 'utf-8')
    })

    const result = moveDataRoot(target, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('integrity-failed')

    expect(existsSync(pointerPath(userDataDir))).toBe(false)
    expect(readdirSync(target)).toEqual([])
    expect(isDatabaseOpen()).toBe(true)
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('a failed pointer write: the verified copy is removed and the app stays where it was', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')

    // `writeDataRootPointer` writes a temp file and renames it onto the
    // pointer path; breaking the rename is a crash in the one instant the
    // pointer could have been half-written, and proves it never is.
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('simulated crash between write and rename')
    })

    const result = moveDataRoot(target, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('pointer-failed')

    expect(existsSync(pointerPath(userDataDir))).toBe(false)
    expect(readdirSync(target)).toEqual([])
    expect(resolveDataRoot({ userDataDir })).toBe(userDataDir)
    expect(isDatabaseOpen()).toBe(true)
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('refuses when there is no database at the current root to move', () => {
    const parent = trackedTmpDir('solo-crm-move-empty-')
    const userDataDir = subdir(parent, 'userData')
    const target = subdir(parent, 'newdrive')

    const result = moveDataRoot(target, { userDataDir })
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') return
    expect(result.code).toBe('no-database')
  })
})

/**
 * The acceptance criterion in its own words: "Killing the process at each
 * step — after copy, after verify, before the pointer write, after it —
 * leaves the app opening a valid database on the next launch, on one root
 * or the other, never neither."
 *
 * A kill is modelled by the on-disk state it leaves behind, then the next
 * launch is run for real against that state. That is what the criterion is
 * actually about — no assertion here depends on how the state was reached,
 * and modelling it directly covers the mid-copy case a `kill` could never
 * be timed to hit reliably.
 */
describe('a process killed mid-move', () => {
  it('killed after the copy and after the verify, before the pointer write: next launch opens the original', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')
    const source = join(userDataDir, 'solocrm.db')

    closeDatabase()
    // Everything the move does before its last step, and then nothing —
    // the copy is on disk, and for the "after verify" case it has been
    // checked too. The pointer was never written.
    copyFileSync(source, join(target, 'solocrm.db'))
    expect(checkDatabaseFileIntegrity(join(target, 'solocrm.db'))).toBe('ok')

    // Next launch.
    expect(resolveDataRoot({ userDataDir })).toBe(userDataDir)
    openDatabase({ userDataDir })
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(checkDatabaseFileIntegrity(join(target, 'solocrm.db'))).toBe('ok')
  })

  it('killed immediately after the pointer write, before the reopen: next launch opens the new root', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')

    expect(moveDataRoot(target, { userDataDir }).kind).toBe('moved')
    // The kill: the process ends here, with the pointer already committed.
    closeDatabase()

    // Next launch.
    expect(resolveDataRoot({ userDataDir })).toBe(target)
    openDatabase({ userDataDir })
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('a pointer naming a root whose copy never completed still leaves one openable database', () => {
    const { userDataDir, parent } = bootWithData()
    const target = subdir(parent, 'newdrive')
    closeDatabase()

    // The state this ordering makes impossible, asserted from the other
    // side: a pointer committed before a verified copy. Written by hand
    // here — `moveDataRoot` cannot produce it — to show what the order is
    // buying. The original is untouched and remains openable, which is why
    // the recovery is "delete the pointer", not "restore a backup".
    writeDataRootPointer(target, { userDataDir })
    expect(readdirSync(target)).toEqual([])

    rmSync(pointerPath(userDataDir))
    openDatabase({ userDataDir })
    expect(companyNames(getDatabase())).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})
