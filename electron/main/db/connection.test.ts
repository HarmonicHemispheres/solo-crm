import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// Same gap as renderer-globals.test.ts's header comment: this test file
// runs under plain Node (vitest), where node_modules/electron/index.js
// exports the string path to the Electron binary rather than the real API.
import electronPath from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase, resolveDatabasePath } from './connection'
import { DATA_ROOT_POINTER_FILENAME } from './data-root'
import { getSchemaVersion } from './migrate'
import { MIGRATIONS, type MigrationDefinition } from './migrations'
import { SYNC_FOLDER_GUARD_OVERRIDE_ENV, SyncFolderGuardError } from './sync-folder-guard'
import { compileToCommonJs } from '../test-support/compile-to-cjs'

/**
 * Runtime choice for this file (T-260828-05's Risks note: "decide which
 * runtime the test suite uses and make it explicit").
 *
 * `better-sqlite3` v13 ships prebuilt N-API (NAPI_VERSION=10) binaries,
 * which are ABI-stable across Node and Electron — verified by hand while
 * building this task: the module loads under both plain system Node and
 * `electron --require` (`ELECTRON_RUN_AS_NODE=1`) with no rebuild between
 * them, even though the two report different `process.versions.modules`
 * (137 vs 149 here). That means most of the tests below import `./connection`
 * directly and run as ordinary vitest/Node tests — no subprocess needed for
 * the native module itself.
 *
 * What plain Node *cannot* provide is the real Electron `app` object:
 * outside a genuine Electron process, `require('electron')` resolves to the
 * path string above, so `app.getPath('userData')` is unavailable. Every test
 * below therefore passes an explicit `userDataDir` override — connection.ts's
 * only sanctioned way to avoid touching the real default — except the last
 * one, which boots a real, throwaway Electron app (the same spawn technique
 * as renderer-globals.test.ts) specifically to prove the *default*,
 * no-override path genuinely resolves through `app.getPath('userData')`, the
 * way index.ts calls it. That test doubles as proof of the acceptance
 * criterion "a fresh npm install ... produces a working native module with
 * no manual rebuild step": it only passes if the postinstall-rebuilt module
 * loads inside the real Electron runtime the packaged app ships.
 *
 * The kill-mid-transaction test spawns a second, plain Node process (not
 * Electron) as the writer being killed — legitimate given the ABI finding
 * above, and it keeps that test from also depending on Electron boot time.
 */

const here = dirname(fileURLToPath(import.meta.url))
const electronRoot = resolve(here, '..', '..')

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

afterEach(() => {
  closeDatabase()
})

describe('openDatabase with an explicit userDataDir override', () => {
  it('creates solocrm.db at the resolved path on first open', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-')
    try {
      const expectedPath = resolveDatabasePath({ userDataDir: tmpDir })
      expect(expectedPath.endsWith(`${sep}solocrm.db`)).toBe(true)
      expect(existsSync(expectedPath)).toBe(false)

      openDatabase({ userDataDir: tmpDir })

      expect(existsSync(expectedPath)).toBe(true)
    } finally {
      // Windows holds the directory open for as long as solocrm.db's file
      // handle is live — closeDatabase() (also run by afterEach, too late
      // for this rmSync) has to run first or the recursive delete below
      // throws EPERM.
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('sets journal_mode=WAL, foreign_keys=ON, the configured busy_timeout and synchronous=NORMAL', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()

      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
      // SQLite's synchronous pragma reports as an integer: 0=OFF, 1=NORMAL,
      // 2=FULL. See connection.ts's applyPragmas for why NORMAL is the
      // deliberate choice here, paired with WAL.
      expect(db.pragma('synchronous', { simple: true })).toBe(1)
    } finally {
      // Windows holds the directory open for as long as solocrm.db's file
      // handle is live — closeDatabase() (also run by afterEach, too late
      // for this rmSync) has to run first or the recursive delete below
      // throws EPERM.
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('re-applies every pragma on a second, independently-opened connection — not only the first', () => {
    // foreign_keys (and busy_timeout, synchronous) are per-connection in
    // SQLite, not stored in the database file. Opening, closing and
    // reopening the same file must set them again each time; asserting only
    // once, on the first connection, would pass even if applyPragmas ran
    // only on a fresh/empty file.
    const tmpDir = makeTmpDir('solo-crm-connection-')
    try {
      openDatabase({ userDataDir: tmpDir })
      expect(getDatabase().pragma('foreign_keys', { simple: true })).toBe(1)
      closeDatabase()

      openDatabase({ userDataDir: tmpDir })
      expect(getDatabase().pragma('foreign_keys', { simple: true })).toBe(1)
      expect(getDatabase().pragma('journal_mode', { simple: true })).toBe('wal')
    } finally {
      // Windows holds the directory open for as long as solocrm.db's file
      // handle is live — closeDatabase() (also run by afterEach, too late
      // for this rmSync) has to run first or the recursive delete below
      // throws EPERM.
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws if called while a connection is already open, rather than silently opening a second one', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-')
    try {
      openDatabase({ userDataDir: tmpDir })
      expect(() => openDatabase({ userDataDir: tmpDir })).toThrow(/already open/)
    } finally {
      // Windows holds the directory open for as long as solocrm.db's file
      // handle is live — closeDatabase() (also run by afterEach, too late
      // for this rmSync) has to run first or the recursive delete below
      // throws EPERM.
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('getDatabase throws before openDatabase has been called', () => {
    expect(() => getDatabase()).toThrow(/before openDatabase/)
  })

  it('creates the -wal and -shm sidecar files once there is data to write', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-')
    try {
      const dbPath = resolveDatabasePath({ userDataDir: tmpDir })
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
      db.prepare('INSERT INTO t (id) VALUES (1)').run()

      // The AGENTS.md/Risks note this documents: a backup that copies only
      // solocrm.db while these exist can miss committed data still sitting
      // in the WAL file.
      expect(existsSync(`${dbPath}-wal`)).toBe(true)
    } finally {
      // Windows holds the directory open for as long as solocrm.db's file
      // handle is live — closeDatabase() (also run by afterEach, too late
      // for this rmSync) has to run first or the recursive delete below
      // throws EPERM.
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('closeDatabase checkpoints WAL into the main file and removes the sidecars, leaving one self-contained file', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-')
    try {
      const dbPath = resolveDatabasePath({ userDataDir: tmpDir })
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
      db.prepare('INSERT INTO t (id) VALUES (1)').run()
      expect(existsSync(`${dbPath}-wal`)).toBe(true)

      closeDatabase()

      // TRUNCATE-mode checkpoint on the last connection's close folds every
      // WAL frame into solocrm.db and removes both sidecars outright
      // (verified by hand while building this task — not merely truncated
      // to zero length) — a backup taken right after quit needs only the one
      // file.
      expect(existsSync(`${dbPath}-wal`)).toBe(false)
      expect(existsSync(`${dbPath}-shm`)).toBe(false)
      expect(statSync(dbPath).size).toBeGreaterThan(0)

      // Safe to call again with nothing open.
      expect(() => closeDatabase()).not.toThrow()

      // The checkpointed data survives a fresh connection.
      openDatabase({ userDataDir: tmpDir })
      const row = getDatabase().prepare('SELECT id FROM t').get() as { id: number }
      expect(row.id).toBe(1)
    } finally {
      // Windows holds the directory open for as long as solocrm.db's file
      // handle is live — closeDatabase() (also run by afterEach, too late
      // for this rmSync) has to run first or the recursive delete below
      // throws EPERM.
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('openDatabase and the sync-folder guard (T-260828-06)', () => {
  // Proves the acceptance criterion "no solocrm.db, -wal or -shm file exists
  // after a refusal": better-sqlite3 creates the file at construction time,
  // so the only way to prove this is to call the real openDatabase() against
  // a path that trips the guard and then assert the filesystem, not to unit
  // test the guard module in isolation (sync-folder-guard.test.ts already
  // does that without needing openDatabase at all).
  it('refuses to open, creates no file, and names the path and reason in the thrown error', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-guard-')
    const syncedUserDataDir = join(tmpDir, 'Dropbox', 'userData')
    mkdirSync(syncedUserDataDir, { recursive: true })
    try {
      const dbPath = resolveDatabasePath({ userDataDir: syncedUserDataDir })

      let thrown: unknown
      try {
        openDatabase({ userDataDir: syncedUserDataDir })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(SyncFolderGuardError)
      expect((thrown as SyncFolderGuardError).message).toContain('Dropbox')
      expect((thrown as SyncFolderGuardError).message).toContain(dbPath)

      expect(existsSync(dbPath)).toBe(false)
      expect(existsSync(`${dbPath}-wal`)).toBe(false)
      expect(existsSync(`${dbPath}-shm`)).toBe(false)

      // The refusal must not leave a dangling module-level handle either —
      // a later, legitimate openDatabase() call has to still work.
      expect(() => getDatabase()).toThrow(/before openDatabase/)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it(`opens normally under a synced path when ${SYNC_FOLDER_GUARD_OVERRIDE_ENV}=1 is set`, () => {
    const tmpDir = makeTmpDir('solo-crm-connection-guard-override-')
    const syncedUserDataDir = join(tmpDir, 'OneDrive', 'userData')
    mkdirSync(syncedUserDataDir, { recursive: true })
    const previous = process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV]
    process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV] = '1'
    try {
      const dbPath = resolveDatabasePath({ userDataDir: syncedUserDataDir })

      expect(() => openDatabase({ userDataDir: syncedUserDataDir })).not.toThrow()

      expect(existsSync(dbPath)).toBe(true)
    } finally {
      if (previous === undefined) {
        delete process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV]
      } else {
        process.env[SYNC_FOLDER_GUARD_OVERRIDE_ENV] = previous
      }
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('does not refuse an ordinary, non-synced path', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-guard-clean-')
    try {
      expect(() => openDatabase({ userDataDir: tmpDir })).not.toThrow()
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('openDatabase and the data-root pointer file (T-260828-17)', () => {
  function writePointer(userDataDir: string, dataRoot: unknown): void {
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot }), 'utf-8')
  }

  it('with no pointer file, resolves solocrm.db under userDataDir — identical to today', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-dataroot-default-')
    try {
      const expectedPath = resolveDatabasePath({ userDataDir: tmpDir })
      expect(expectedPath).toBe(join(tmpDir, 'solocrm.db'))
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('a pointer at a temp directory creates solocrm.db there, and no solocrm.db/-wal/-shm appears under userDataDir', () => {
    const userDataDir = makeTmpDir('solo-crm-connection-dataroot-userdata-')
    const dataRoot = makeTmpDir('solo-crm-connection-dataroot-target-')
    try {
      writePointer(userDataDir, dataRoot)

      openDatabase({ userDataDir })
      const db = getDatabase()
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')

      const pointedDbPath = join(dataRoot, 'solocrm.db')
      expect(existsSync(pointedDbPath)).toBe(true)

      const userDataEntries = readdirSync(userDataDir)
      expect(userDataEntries).not.toContain('solocrm.db')
      expect(userDataEntries).not.toContain('solocrm.db-wal')
      expect(userDataEntries).not.toContain('solocrm.db-shm')
    } finally {
      closeDatabase()
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(dataRoot, { recursive: true, force: true })
    }
  })

  const corruptPointerCases: readonly [label: string, write: (userDataDir: string) => void][] = [
    ['malformed JSON', (userDataDir) => writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), '{ not json', 'utf-8')],
    ['a missing dataRoot key', (userDataDir) => writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({}), 'utf-8')],
    ['an empty-string dataRoot', (userDataDir) => writePointer(userDataDir, '')],
    ['a relative-path dataRoot', (userDataDir) => writePointer(userDataDir, `relative${sep}path`)]
  ]

  it.each(corruptPointerCases)(
    '%s fails startup naming data-location.json, with no database file created anywhere',
    (_label, writeCorruptPointer) => {
      const userDataDir = makeTmpDir('solo-crm-connection-dataroot-bad-')
      try {
        writeCorruptPointer(userDataDir)

        expect(() => openDatabase({ userDataDir })).toThrow(
          new RegExp(DATA_ROOT_POINTER_FILENAME.replace('.', '\\.'))
        )

        expect(existsSync(join(userDataDir, 'solocrm.db'))).toBe(false)
        expect(() => getDatabase()).toThrow(/before openDatabase/)
      } finally {
        closeDatabase()
        rmSync(userDataDir, { recursive: true, force: true })
      }
    }
  )

  it('a pointer into a synced folder is refused by the existing sync-folder guard, naming the pointed-at path, not userDataDir', () => {
    const userDataDir = makeTmpDir('solo-crm-connection-dataroot-userdata-')
    const parent = makeTmpDir('solo-crm-connection-dataroot-sync-parent-')
    const dataRoot = join(parent, 'Dropbox', 'crm-data')
    mkdirSync(dataRoot, { recursive: true })
    try {
      writePointer(userDataDir, dataRoot)

      let thrown: unknown
      try {
        openDatabase({ userDataDir })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(SyncFolderGuardError)
      const message = (thrown as SyncFolderGuardError).message
      expect(message).toContain(join(dataRoot, 'solocrm.db'))
      expect(message).not.toContain(userDataDir)

      expect(existsSync(join(dataRoot, 'solocrm.db'))).toBe(false)
      expect(existsSync(join(userDataDir, 'solocrm.db'))).toBe(false)
    } finally {
      closeDatabase()
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('a pointer at <existing parent>/newfolder creates newfolder and opens the database there', () => {
    const userDataDir = makeTmpDir('solo-crm-connection-dataroot-userdata-')
    const parent = makeTmpDir('solo-crm-connection-dataroot-parent-')
    const dataRoot = join(parent, 'newfolder')
    try {
      writePointer(userDataDir, dataRoot)

      expect(existsSync(dataRoot)).toBe(false)
      openDatabase({ userDataDir })
      expect(existsSync(join(dataRoot, 'solocrm.db'))).toBe(true)
    } finally {
      closeDatabase()
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('a pointer at <missing parent>/newfolder fails, distinguishing the missing-parent case, and creates nothing', () => {
    const userDataDir = makeTmpDir('solo-crm-connection-dataroot-userdata-')
    const parent = makeTmpDir('solo-crm-connection-dataroot-parent-')
    rmSync(parent, { recursive: true, force: true }) // parent itself now missing
    const dataRoot = join(parent, 'newfolder')
    try {
      writePointer(userDataDir, dataRoot)

      let thrown: unknown
      try {
        openDatabase({ userDataDir })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toContain(parent)
      expect(existsSync(dataRoot)).toBe(false)
      expect(existsSync(parent)).toBe(false)
    } finally {
      closeDatabase()
      rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})

describe('openDatabase and the migration runner (T-260828-07)', () => {
  it('applies migration 0001 as part of opening — the domain schema and schema_migrations both exist afterward', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-migrate-')
    try {
      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()

      const companiesTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'companies'")
        .get()
      expect(companiesTable).toBeDefined()
      expect(getSchemaVersion(db)).toEqual({ version: 1, lastMigrationAt: expect.any(String) })
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('a throwing migration leaves openDatabase() no better than never having been called — no dangling handle, no file left mid-migration for a plain retry to trip over', () => {
    const tmpDir = makeTmpDir('solo-crm-connection-migrate-broken-')
    const breakingMigrations: readonly MigrationDefinition[] = [
      ...MIGRATIONS,
      { version: 2, name: 'test_broken', sql: 'THIS IS NOT VALID SQL;' }
    ]
    try {
      expect(() => openDatabase({ userDataDir: tmpDir, migrations: breakingMigrations })).toThrow()

      // No dangling module-level handle: getDatabase() still reports "not
      // open", exactly as if openDatabase() had never been called.
      expect(() => getDatabase()).toThrow(/before openDatabase/)

      // A plain retry (the real migration set, no override) succeeds against
      // the same directory rather than hitting a stale "already open" guard
      // or a half-migrated file it cannot recover from.
      expect(() => openDatabase({ userDataDir: tmpDir })).not.toThrow()
      expect(getSchemaVersion(getDatabase()).version).toBe(1)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('single owner of the SQLite connection', () => {
  it('no module under electron/ other than db/connection.ts constructs a Database directly', () => {
    // Assembled from parts rather than written as one contiguous literal so
    // that this check does not match itself.
    const constructorCall = new RegExp(['new', String.raw`Database\s*\(`].join(String.raw`\s+`))
    const offenders: string[] = []

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue

        const rel = relative(electronRoot, full).split(sep).join('/')
        if (rel === 'main/db/connection.ts') continue

        const contents = readFileSync(full, 'utf-8')
        if (constructorCall.test(contents)) {
          offenders.push(rel)
        }
      }
    }

    walk(electronRoot)
    expect(offenders).toEqual([])
  })
})

describe('a process killed mid-transaction', () => {
  it(
    'leaves a database that reopens cleanly, passes integrity_check, and has the uncommitted write rolled back',
    async () => {
      const tmpDir = makeTmpDir('solo-crm-connection-kill-')
      const { entryPath: connectionPath, generatedPaths } = compileToCommonJs(join(here, 'connection.ts'))
      const writerScript = join(tmpDir, 'writer.cjs')

      // Inserts one committed sentinel row, then opens an explicit
      // transaction and writes inside it forever — it never reaches COMMIT,
      // by design, so however long the parent waits before killing it, the
      // transaction is still open and uncommitted at that point. The `ready`
      // file is the handshake: written only once the child is inside the
      // open transaction, so the parent kills at a known state instead of
      // after a fixed sleep that raced a cold start (the flake T-260828-06's
      // review pinned down).
      const readyPath = join(tmpDir, 'writer-ready')
      writeFileSync(
        writerScript,
        [
          `const { writeFileSync } = require('node:fs')`,
          `const { openDatabase, getDatabase } = require(${JSON.stringify(connectionPath)})`,
          `openDatabase({ userDataDir: ${JSON.stringify(tmpDir)} })`,
          `const db = getDatabase()`,
          `db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')`,
          `db.prepare('INSERT INTO t (id) VALUES (0)').run()`,
          `const insert = db.prepare('INSERT INTO t (id) VALUES (?)')`,
          `db.exec('BEGIN')`,
          `insert.run(1)`,
          `writeFileSync(${JSON.stringify(readyPath)}, 'ready')`,
          `let i = 2`,
          `while (true) {`,
          `  insert.run(i)`,
          `  i += 1`,
          `}`
        ].join('\n'),
        'utf-8'
      )

      try {
        const child = spawn(process.execPath, [writerScript], { stdio: 'ignore' })
        const exited = new Promise<void>((resolveExit) => {
          child.once('exit', () => resolveExit())
        })

        // Wait for the handshake file, not a fixed interval: the child
        // writes it only once it is inside the open transaction. The
        // deadline is a loud failure, never a false pass.
        const deadline = Date.now() + 15_000
        while (!existsSync(readyPath)) {
          if (Date.now() > deadline) {
            child.kill()
            throw new Error('writer child never signalled readiness — it likely crashed before BEGIN')
          }
          await new Promise((r) => setTimeout(r, 25))
        }
        child.kill()
        await exited

        openDatabase({ userDataDir: tmpDir })
        const db = getDatabase()

        expect(db.pragma('integrity_check', { simple: true })).toBe('ok')

        const rows = db.prepare('SELECT id FROM t ORDER BY id').all() as { id: number }[]
        // Only the sentinel, committed before the open transaction, survives
        // — the kill proves WAL+NORMAL's guarantee that an interrupted
        // transaction is all-or-nothing, not partially applied.
        expect(rows).toEqual([{ id: 0 }])
      } finally {
        // Same Windows-handle ordering as the describe block above: the
        // reopened connection has to close before the directory can be
        // removed.
        closeDatabase()
        for (const generatedPath of generatedPaths) {
          rmSync(generatedPath, { force: true })
        }
        rmSync(tmpDir, { recursive: true, force: true })
      }
    },
    20_000
  )
})

describe("the default path, resolved against Electron's real app.getPath('userData')", () => {
  it(
    "openDatabase() with no override creates solocrm.db under app.getPath('userData') in a real, booted Electron app",
    () => {
      const electronBinary = electronPath as unknown as string
      const tmpUserData = makeTmpDir('solo-crm-connection-userdata-')
      const { entryPath: connectionPath, generatedPaths } = compileToCommonJs(join(here, 'connection.ts'))
      const resultPath = join(tmpUserData, 'result.json')
      const harnessPath = join(tmpUserData, 'harness.cjs')

      writeFileSync(
        harnessPath,
        [
          `const { app } = require('electron')`,
          `const { existsSync, writeFileSync } = require('node:fs')`,
          `const { join } = require('node:path')`,
          // Redirects Electron's own idea of "userData" into a throwaway
          // directory — the standard Electron testing technique — so this
          // still exercises the real, no-argument production call
          // (openDatabase() / resolveDatabasePath(), exactly as index.ts
          // calls them) without touching a real user profile.
          `app.setPath('userData', ${JSON.stringify(tmpUserData)})`,
          `app.whenReady().then(() => {`,
          `  const { openDatabase, resolveDatabasePath, closeDatabase } = require(${JSON.stringify(connectionPath)})`,
          `  const expected = join(app.getPath('userData'), 'solocrm.db')`,
          `  const resolved = resolveDatabasePath()`,
          `  openDatabase()`,
          `  const result = { expected, resolved, fileExists: existsSync(expected) }`,
          `  closeDatabase()`,
          `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result))`,
          `  app.exit(0)`,
          `}).catch((error) => {`,
          `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String((error && error.stack) || error) }))`,
          `  app.exit(1)`,
          `})`
        ].join('\n'),
        'utf-8'
      )

      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE

      const run = spawnSync(electronBinary, [harnessPath], { encoding: 'utf-8', env, timeout: 30_000 })

      let parsed: { expected: string; resolved: string; fileExists: boolean } | { error: string }
      try {
        parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as
          | { expected: string; resolved: string; fileExists: boolean }
          | { error: string }
      } catch {
        throw new Error(
          `connection default-path harness produced no readable result.\n` +
            `status=${String(run.status)} signal=${String(run.signal)} error=${String(run.error)}\n` +
            `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`
        )
      } finally {
        for (const generatedPath of generatedPaths) {
          rmSync(generatedPath, { force: true })
        }
        rmSync(tmpUserData, { recursive: true, force: true })
      }

      if ('error' in parsed) {
        throw new Error(`connection default-path harness failed inside Electron: ${parsed.error}`)
      }

      expect(parsed.resolved).toBe(parsed.expected)
      expect(parsed.fileExists).toBe(true)
    },
    30_000
  )
})
