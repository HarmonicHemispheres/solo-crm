import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// `electron`'s type declares its real runtime API (`app`, `BrowserWindow`,
// ...) because that's what this module resolves to *inside* an Electron
// process. This test file runs under plain Node (vitest), where
// node_modules/electron/index.js instead exports the string path to the
// Electron binary — the mechanism the `electron` CLI itself relies on. The
// type and the runtime value disagree here on purpose; the cast below is
// that gap made explicit rather than silently relied on.
import electronPath from 'electron'
import { describe, expect, it } from 'vitest'
import { SECURE_WEB_PREFERENCES } from './security'

interface RendererGlobals {
  require: string
  process: string
  module: string
}

/**
 * Boots a real, throwaway Electron app and reads back what the renderer's
 * own global scope looks like from inside it — not a jsdom stand-in, which
 * has no concept of contextIsolation/sandbox/nodeIntegration at all and so
 * could never fail this assertion no matter how the app's webPreferences
 * changed (see the outcome note on this task for the one exception: setting
 * `contextIsolation: false` alone does *not* move this assertion, because
 * `sandbox: true` already guarantees no Node.js engine loads in the renderer
 * process regardless of contextIsolation — `sandbox` and `nodeIntegration`
 * are what actually gate it once `sandbox` is stated explicitly).
 *
 * This sandboxed dev environment sets `ELECTRON_RUN_AS_NODE=1` globally,
 * which makes the Electron binary behave as a plain Node runtime with no
 * `app`/`BrowserWindow` at all — `require('electron')` only resolves to the
 * real API when that variable is unset for the process. It has to be
 * cleared for the child below for this to boot a real app instead of
 * immediately failing with `app` and `BrowserWindow` both undefined.
 */
function readRendererGlobals(webPreferences: Record<string, unknown>): RendererGlobals {
  const electronBinary = electronPath as unknown as string
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-renderer-globals-'))
  const harnessPath = join(dir, 'harness.cjs')
  const resultPath = join(dir, 'result.json')

  writeFileSync(
    harnessPath,
    `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: ${JSON.stringify(webPreferences)} })
  await win.loadURL('data:text/html,<!doctype html><title>renderer-globals-harness</title>')
  const result = await win.webContents.executeJavaScript(
    '({ require: typeof window.require, process: typeof window.process, module: typeof window.module })'
  )
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result))
  app.exit(0)
}).catch((error) => {
  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String((error && error.stack) || error) }))
  app.exit(1)
})
`,
    'utf-8'
  )

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const run = spawnSync(electronBinary, [harnessPath], {
    encoding: 'utf-8',
    env,
    timeout: 30_000
  })

  let parsed: RendererGlobals | { error: string }
  try {
    parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as RendererGlobals | { error: string }
  } catch {
    throw new Error(
      `renderer-globals harness produced no readable result.\n` +
        `status=${String(run.status)} signal=${String(run.signal)} error=${String(run.error)}\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if ('error' in parsed) {
    throw new Error(`renderer-globals harness failed inside Electron: ${parsed.error}`)
  }
  return parsed
}

describe("renderer global scope under the app's real webPreferences", () => {
  it(
    'has no window.require, window.process or window.module',
    () => {
      expect(readRendererGlobals(SECURE_WEB_PREFERENCES)).toEqual({
        require: 'undefined',
        process: 'undefined',
        module: 'undefined'
      })
    },
    30_000
  )
})
