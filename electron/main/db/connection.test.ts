import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
// Same gap as renderer-globals.test.ts's header comment: this test file
// runs under plain Node (vitest), where node_modules/electron/index.js
// exports the string path to the Electron binary rather than the real API.
import electronPath from 'electron'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase, resolveDatabasePath } from './connection'

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

/**
 * Transpiles connection.ts to CommonJS and writes the result beside the
 * source file (not the OS tmpdir the other harness files below use) so that
 * a spawned child process's `require('better-sqlite3')` / `require('electron')`
 * resolve through the ordinary node_modules walk from this directory, and so
 * the spawned processes below run the real module under test rather than a
 * hand-reimplementation of its logic. `typescript` is already a project
 * devDependency and this same transpile API (`ts.transpileModule`) is
 * already used by toolchain.test.ts for a different purpose.
 */
function compileConnectionModule(): string {
  const source = readFileSync(join(here, 'connection.ts'), 'utf-8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: 'connection.ts'
  })
  const outPath = join(here, `.connection.compiled.${process.pid}.${Date.now()}.cjs`)
  writeFileSync(outPath, outputText, 'utf-8')
  return outPath
}

describe('a process killed mid-transaction', () => {
  it(
    'leaves a database that reopens cleanly, passes integrity_check, and has the uncommitted write rolled back',
    async () => {
      const tmpDir = makeTmpDir('solo-crm-connection-kill-')
      const compiledPath = compileConnectionModule()
      const writerScript = join(tmpDir, 'writer.cjs')

      // Inserts one committed sentinel row, then opens an explicit
      // transaction and writes inside it forever — it never reaches COMMIT,
      // by design, so however long the parent waits before killing it, the
      // transaction is still open and uncommitted at that point.
      writeFileSync(
        writerScript,
        [
          `const { openDatabase, getDatabase } = require(${JSON.stringify(compiledPath)})`,
          `openDatabase({ userDataDir: ${JSON.stringify(tmpDir)} })`,
          `const db = getDatabase()`,
          `db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')`,
          `db.prepare('INSERT INTO t (id) VALUES (0)').run()`,
          `const insert = db.prepare('INSERT INTO t (id) VALUES (?)')`,
          `db.exec('BEGIN')`,
          `let i = 1`,
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

        // Long enough for the writer to be well inside its open transaction
        // (thousands of inserts), short enough to keep the WAL file this
        // produces small.
        await new Promise((r) => setTimeout(r, 200))
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
        rmSync(compiledPath, { force: true })
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
      const compiledPath = compileConnectionModule()
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
          `  const { openDatabase, resolveDatabasePath, closeDatabase } = require(${JSON.stringify(compiledPath)})`,
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
        rmSync(compiledPath, { force: true })
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
