import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `./connection` imports `app` from 'electron' at its own top level; every
// test here passes an explicit `userDataDir`, and `getPath` throws so a test
// that forgot one fails loudly instead of writing into a real user-data
// folder — `readonly-connection.test.ts`'s reasoning, verbatim.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test',
    getPath: () => {
      throw new Error('app.getPath should not be called — every test here overrides userDataDir')
    }
  }
}))

const { closeDatabase, getDatabase, openDatabase } = await import('./connection')
const { readDatabaseStats } = await import('./stats')

const tmpDirs: string[] = []

function openTempDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-stats-'))
  tmpDirs.push(dir)
  return openDatabase({ userDataDir: dir })
}

const NOW = '2026-08-28T12:00:00.000Z'

function insertCompanies(count: number): void {
  const db = getDatabase()
  const insert = db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  for (let index = 0; index < count; index += 1) {
    insert.run(`c${index}`, `Company ${index}`, NOW, NOW)
  }
}

afterEach(() => {
  closeDatabase()
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('readDatabaseStats', () => {
  it('reports the open file, its pragmas and its schema version', () => {
    const db = openTempDatabase()
    const stats = readDatabaseStats(db)

    expect(stats.path).toBe(db.name)
    expect(stats.journalMode).toBe('wal')
    expect(stats.pageSize).toBeGreaterThan(0)
    expect(stats.pageCount).toBeGreaterThan(0)
    expect(stats.fileBytes).toBeGreaterThan(0)
    // Every migration in `migrations/` has been applied by `openDatabase`.
    expect(stats.schemaVersion).toBeGreaterThan(0)
    expect(stats.lastMigrationAt).not.toBeNull()
  })

  it('counts every table, and counts them live rather than from a cached snapshot', () => {
    const db = openTempDatabase()
    const before = readDatabaseStats(db)
    expect(before.tables.find((table) => table.name === 'companies')?.rowCount).toBe(0)

    insertCompanies(3)

    // X-01's first acceptance criterion: the numbers move without a restart,
    // and without anything invalidating a cache — because there is no cache.
    // A memoised implementation passes the assertion above and fails this one.
    const after = readDatabaseStats(db)
    expect(after.tables.find((table) => table.name === 'companies')?.rowCount).toBe(3)
    expect(after.readAt >= before.readAt).toBe(true)
  })

  it('lists real tables but not SQLite internals or an FTS virtual table\'s shadow tables', () => {
    const db = openTempDatabase()
    const names = readDatabaseStats(db).tables.map((table) => table.name)

    expect(names).toContain('companies')
    expect(names).toContain('tasks')
    // `search_fts` is the FTS5 virtual table itself — a real thing with real
    // rows, and it stays.
    expect(names).toContain('search_fts')
    // Its four storage tables are not four more tables. Showing them would
    // both quadruple the apparent table count and invite a b-tree segment
    // count to be read as a record count (ADR-008).
    for (const shadow of ['search_fts_data', 'search_fts_idx', 'search_fts_docsize', 'search_fts_config']) {
      expect(names).not.toContain(shadow)
    }
    expect(names.filter((name) => name.startsWith('sqlite_'))).toEqual([])
  })

  it('orders tables largest first so the biggest thing in the file is the first thing read', () => {
    const db = openTempDatabase()
    insertCompanies(5)

    const counts = readDatabaseStats(db).tables.map((table) => table.rowCount)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
    expect(readDatabaseStats(db).tables[0]?.name).toBe('companies')
  })

  it('reports the WAL sidecar separately from the database file', () => {
    const db = openTempDatabase()
    insertCompanies(1)

    const stats = readDatabaseStats(db)
    // In WAL mode a just-written row lives in the sidecar until a
    // checkpoint moves it, which is exactly why the two sizes are reported
    // separately rather than summed into one "database size" that would not
    // move right after the write that prompted someone to look.
    expect(stats.walBytes).toBeGreaterThan(0)
    expect(stats.fileBytes).toBeGreaterThan(0)
  })

  it('reports the backup and integrity facts as unknown rather than inventing them', () => {
    const stats = readDatabaseStats(openTempDatabase())
    // X-04 and X-05 own these. `null` is what lets the view say "never"
    // plainly; a plausible-looking figure here would be the page's one
    // dishonest number.
    expect(stats.lastBackupAt).toBeNull()
    expect(stats.lastIntegrityCheckAt).toBeNull()
    expect(stats.lastIntegrityCheckOk).toBeNull()
  })
})
