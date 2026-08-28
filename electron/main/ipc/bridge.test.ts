import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Same gap as renderer-globals.test.ts's header comment: under plain Node
// (vitest) node_modules/electron/index.js exports the string path to the
// Electron binary rather than the real API — used below only to spawn it.
import electronPath from 'electron'
import { describe, expect, it } from 'vitest'
// security.ts's only 'electron' import is `import type { WebPreferences }`
// (type-only, erased) — safe to import directly here under plain vitest,
// unlike registry.ts/connection.ts below, which is why this doesn't need
// the compile-to-cjs treatment the way those do.
import { MIGRATIONS } from '../db/migrations'
import { SECURE_WEB_PREFERENCES } from '../security'
import { bundlePreloadForTest } from '../test-support/bundle-preload'
import { compileToCommonJs } from '../test-support/compile-to-cjs'

// Derived, not hardcoded: see registry.test.ts's identical guard. A fresh
// database opened by the harness below (no explicit migrations list) always
// lands on the latest registered version.
const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/**
 * The acceptance criterion this file exists to prove: "the bridge works
 * under sandbox: true as configured by T-260828-04." Same real-Electron
 * spawn technique as renderer-globals.test.ts and connection.test.ts's last
 * test (ELECTRON_RUN_AS_NODE unset for the child so `require('electron')`
 * resolves to the real app/BrowserWindow API instead of this sandboxed dev
 * environment's global Node stand-in) — extended to also load a *real*,
 * built preload script and drive `window.crm` from inside the renderer,
 * rather than only inspecting `webPreferences`.
 *
 * The main side and the preload side are built two different ways, on
 * purpose. `electron/main/ipc/index.ts` uses `compile-to-cjs.ts`'s per-file
 * transpile-and-require-graph (same technique as connection.test.ts, so
 * this doesn't depend on `npm run build` having run first) — main-process
 * `require()` is plain Node `require`, so a multi-file graph works fine.
 * `electron/preload/index.ts` uses `bundle-preload.ts`'s single-file esbuild
 * bundle instead: the sandboxed preload's `require()` cannot resolve a
 * sibling file by relative path *or* a `node_modules` package (T-260828-04's
 * outcome) — discovered directly here, the first version of this test used
 * `compile-to-cjs.ts` for both sides and failed with "module not found:
 * ../shared/ipc-types...cjs" inside the sandboxed preload. Only a real
 * single-file bundle proves T-260828-08's handoff ("verify the built
 * index.cjs is self-contained") rather than assuming it.
 *
 * That compiled main-side graph transitively produces a real, working
 * `connection.ts` — the harness below opens the database through that exact
 * compiled module (via `compiledPathFor`) so `registerIpcHandlers`'s
 * `getDatabase()` calls (inside the also-transitively-compiled registry.ts)
 * see the same open connection, not a second, independently-compiled copy
 * with its own unopened module state.
 */
const here = dirname(fileURLToPath(import.meta.url))
const mainDir = dirname(here)

describe('the typed IPC bridge under a real, sandboxed Electron renderer', () => {
  it(
    "window.crm['app:version']() and window.crm['db:schemaVersion']() round-trip through a real preload, ipcMain and database",
    () => {
      const electronBinary = electronPath as unknown as string
      const tmpUserData = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-bridge-'))
      const resultPath = join(tmpUserData, 'result.json')
      const harnessPath = join(tmpUserData, 'harness.cjs')

      const mainCompiled = compileToCommonJs(join(mainDir, 'ipc', 'index.ts'))
      const preloadBundled = bundlePreloadForTest(join(mainDir, '..', 'preload', 'index.ts'))
      const connectionCompiledPath = mainCompiled.compiledPathFor.get(join(mainDir, 'db', 'connection.ts'))
      if (!connectionCompiledPath) {
        throw new Error(
          'bridge.test.ts could not find connection.ts in the compiled dependency graph of ipc/index.ts — ' +
            'the import chain must have changed; update this test to match.'
        )
      }

      writeFileSync(
        harnessPath,
        [
          `const { app, BrowserWindow } = require('electron')`,
          `const { writeFileSync } = require('node:fs')`,
          `const consoleMessages = []`,
          `const preloadErrors = []`,
          `app.on('preload-error', (_event, preloadPath, error) => { preloadErrors.push(String((error && error.stack) || error)) })`,
          `app.setPath('userData', ${JSON.stringify(tmpUserData)})`,
          `app.whenReady().then(async () => {`,
          `  const { openDatabase, closeDatabase } = require(${JSON.stringify(connectionCompiledPath)})`,
          // No userDataDir override: exercises the same default path
          // index.ts's real startup sequence uses.
          `  openDatabase()`,
          `  const { registerIpcHandlers } = require(${JSON.stringify(mainCompiled.entryPath)})`,
          `  registerIpcHandlers()`,
          `  const win = new BrowserWindow({`,
          `    show: false,`,
          `    webPreferences: { ...${JSON.stringify(SECURE_WEB_PREFERENCES)}, preload: ${JSON.stringify(preloadBundled.bundledPath)} }`,
          `  })`,
          `  win.webContents.on('console-message', (event) => { consoleMessages.push(String(event.message)) })`,
          `  win.webContents.on('preload-error', (_event, preloadPath, error) => { preloadErrors.push(String((error && error.stack) || error)) })`,
          `  await win.loadURL('data:text/html,<!doctype html><title>bridge-harness</title>')`,
          `  const result = await win.webContents.executeJavaScript(\``,
          `    (async () => {`,
          `      const hasWindowCrm = typeof window.crm === 'object' && window.crm !== null`,
          `      const appVersion = await window.crm['app:version']()`,
          `      const schemaVersion = await window.crm['db:schemaVersion']()`,
          `      const invalidRequest = await window.crm['db:schemaVersion']({ unexpected: 'payload' })`,
          `      return { hasWindowCrm, appVersion, schemaVersion, invalidRequest }`,
          `    })()`,
          `  \`)`,
          `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ ...result, consoleMessages, preloadErrors }))`,
          `  closeDatabase()`,
          `  app.exit(0)`,
          `}).catch((error) => {`,
          `  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String((error && error.stack) || error), consoleMessages, preloadErrors }))`,
          `  app.exit(1)`,
          `})`
        ].join('\n'),
        'utf-8'
      )

      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE

      const run = spawnSync(electronBinary, [harnessPath], { encoding: 'utf-8', env, timeout: 30_000 })

      let parsed: {
        hasWindowCrm: boolean
        appVersion: unknown
        schemaVersion: unknown
        invalidRequest: unknown
        consoleMessages: string[]
        preloadErrors: string[]
      } | { error: string; consoleMessages: string[]; preloadErrors: string[] }
      try {
        parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as typeof parsed
      } catch {
        throw new Error(
          `bridge harness produced no readable result.\n` +
            `status=${String(run.status)} signal=${String(run.signal)} error=${String(run.error)}\n` +
            `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`
        )
      } finally {
        for (const generatedPath of mainCompiled.generatedPaths) {
          rmSync(generatedPath, { force: true })
        }
        rmSync(preloadBundled.bundledPath, { force: true })
        rmSync(tmpUserData, { recursive: true, force: true })
      }

      if ('error' in parsed) {
        throw new Error(
          `bridge harness failed inside Electron: ${parsed.error}\n` +
            `preloadErrors: ${JSON.stringify(parsed.preloadErrors)}\n` +
            `consoleMessages: ${JSON.stringify(parsed.consoleMessages)}`
        )
      }

      expect(parsed.preloadErrors).toEqual([])
      expect(parsed.hasWindowCrm).toBe(true)
      expect(parsed.appVersion).toEqual({ ok: true, data: { version: expect.any(String) } })
      expect(parsed.schemaVersion).toEqual({
        ok: true,
        data: { version: LATEST_SCHEMA_VERSION, lastMigrationAt: expect.any(String) }
      })
      // db:schemaVersion's request schema is z.undefined() — an unexpected
      // payload must fail validation in main and come back as a typed error
      // envelope, not a thrown exception the renderer's await would reject on.
      expect(parsed.invalidRequest).toEqual({
        ok: false,
        error: { code: 'invalid-request', message: expect.any(String) }
      })
    },
    30_000
  )
})
