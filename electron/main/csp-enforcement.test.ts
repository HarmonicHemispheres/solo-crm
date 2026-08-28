import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// See renderer-globals.test.ts for why this default import resolves to the
// Electron binary's path rather than its API under plain Node, and why
// ELECTRON_RUN_AS_NODE has to be cleared for the spawned child below.
import electronPath from 'electron'
import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from './security'

interface ConsoleMessage {
  level: string
  message: string
}

/**
 * Installs the real production CSP via a real `onHeadersReceived` handler
 * (the same mechanism `installContentSecurityPolicy` uses — see that
 * function's fake-session unit test in security.test.ts for proof it wires
 * the header correctly) on a real Electron session, loads a local page that
 * tries to load a remote script, and returns whatever the page's devtools
 * console logged.
 *
 * The target host is `.invalid` (RFC 2606: guaranteed never to resolve) so
 * this cannot pass by accident because the network happened to be
 * reachable — CSP refuses the request before any DNS lookup, so a
 * definitely-unresolvable host still proves the block, without this test
 * depending on internet access either way.
 */
function loadPageUnderCsp(csp: string): ConsoleMessage[] {
  const electronBinary = electronPath as unknown as string
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-csp-harness-'))
  const pagePath = join(dir, 'page.html')
  const harnessPath = join(dir, 'harness.cjs')
  const resultPath = join(dir, 'result.json')

  writeFileSync(
    pagePath,
    `<!doctype html>
<html>
  <head><title>csp-enforcement-harness</title></head>
  <body>
    <script src="https://csp-test.invalid/should-be-blocked.js"></script>
  </body>
</html>
`,
    'utf-8'
  )

  writeFileSync(
    harnessPath,
    `
const { app, BrowserWindow, session } = require('electron')
const { writeFileSync } = require('node:fs')

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [${JSON.stringify(csp)}]
      }
    })
  })

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })

  const consoleMessages = []
  win.webContents.on('console-message', (event) => {
    consoleMessages.push({ level: event.level, message: event.message })
  })

  await win.loadFile(${JSON.stringify(pagePath)})
  // The CSP violation is reported to the console asynchronously relative to
  // the navigation promise resolving; give it a beat to arrive.
  await new Promise((resolve) => setTimeout(resolve, 500))

  writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ consoleMessages }))
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
    // T-260828-47: raised alongside the outer testTimeout below — see that
    // comment for the measurement.
    timeout: 80_000
  })

  let parsed: { consoleMessages: ConsoleMessage[] } | { error: string }
  try {
    parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as { consoleMessages: ConsoleMessage[] } | { error: string }
  } catch {
    throw new Error(
      `csp-enforcement harness produced no readable result.\n` +
        `status=${String(run.status)} signal=${String(run.signal)} error=${String(run.error)}\n` +
        `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if ('error' in parsed) {
    throw new Error(`csp-enforcement harness failed inside Electron: ${parsed.error}`)
  }
  return parsed.consoleMessages
}

describe('the production CSP under a real Chromium instance', () => {
  it(
    'blocks a remote <script src> and logs the violation',
    () => {
      const messages = loadPageUnderCsp(buildContentSecurityPolicy(null))

      const violation = messages.find((m) => /content security policy/i.test(m.message))
      expect(violation, `no CSP violation was logged; console messages were: ${JSON.stringify(messages)}`).toBeDefined()
      expect(violation!.level).toBe('error')
      expect(violation!.message).toMatch(/blocked/i)
      expect(violation!.message).toContain('csp-test.invalid')
    },
    // T-260828-47: this spawns a real, throwaway Electron process (the
    // spawnSync `timeout` above bounds it at 80s). Measured wall time for
    // this test alone under load — all 8 cores kept busy by a separate
    // CPU-saturating process, alongside this machine's ordinary multi-agent
    // contention (the condition the task's Acceptance criterion asks for)
    // — ranged 17.2s-53.9s across repeated runs; 90_000ms leaves headroom
    // above the worst of those without just chasing the number up. This
    // test now also runs in the serial `runtime-boot-node` project
    // (vitest.config.ts), so it no longer competes with the rest of the
    // suite for that CPU either.
    90_000
  )
})
