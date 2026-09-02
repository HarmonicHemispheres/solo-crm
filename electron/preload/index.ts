import { contextBridge, ipcRenderer } from 'electron'
import { CHANNEL_NAMES } from '../shared/channel-names'
import type { CrmApi } from '../shared/ipc-types'

/**
 * Builds one named method per channel, generically, from `CHANNEL_NAMES` —
 * adding a channel never requires editing this file (see registry.ts and
 * ipc-types.ts). Every method does exactly one thing —
 * `ipcRenderer.invoke(channel, payload)` — so no `fs`, `path`,
 * `child_process` or database symbol is reachable from here; this loop is
 * the entire boundary between the renderer and `ipcMain`, and it exposes
 * named methods for exactly the fixed set `CHANNEL_NAMES` lists, never a
 * generic `invoke(channel, payload)` a caller could point at an arbitrary
 * string — see T-260828-09's Risks note on why that would undo the
 * boundary this file exists to hold.
 *
 * `CHANNEL_NAMES` comes from `electron/shared/channel-names.ts` — a module
 * that imports nothing, so this preload's bundle is this preload. The
 * `CrmApi` import beside it is `import type`, erased at compile time, and
 * so costs the bundle nothing either.
 *
 * **Import nothing else from `electron/shared/`, and `../shared/ipc-types`
 * least of all.** Two separate reasons, and only the first is obvious:
 *
 * - `registry.ts` (the real channel definitions) reaches `getDatabase()`,
 *   which eagerly loads the `better-sqlite3` native addon the moment it is
 *   imported — something `sandbox: true` means this file can never do
 *   (T-260828-04's outcome).
 * - `ipc-types.ts` is harmless to *security* here but not to weight: it
 *   builds `CHANNEL_CONTRACTS` out of every entity schema in
 *   `electron/shared/`, so a value import of it drags zod and all of them
 *   into this bundle. It did, for a while — 204 KB, constructed in the
 *   sandboxed preload before every window load, to produce a list of
 *   strings. `preload-weight.test.ts` now fails if that comes back.
 */
function buildCrmApi(): CrmApi {
  const api: Record<string, (payload?: unknown) => Promise<unknown>> = {}
  for (const channel of CHANNEL_NAMES) {
    api[channel] = (payload?: unknown) => ipcRenderer.invoke(channel, payload)
  }
  return api as unknown as CrmApi
}

const api = buildCrmApi()

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('crm', api)
  } catch (error) {
    // console.error, not process.stderr.write: a sandboxed preload
    // (sandbox: true, T-260828-04) has no Node process object — `process`
    // here is Electron's own trimmed stand-in, and `process.stderr` on it is
    // undefined, so writing to it would throw and mask the original error
    // instead of reporting it. console.error reaches the renderer devtools
    // console, and rethrowing is what Electron itself logs where the app was
    // launched (and fires app's 'preload-error'), so both together make the
    // failure visible instead of surfacing later as an unexplained
    // "window.crm is undefined" in the renderer.
    console.error('[preload] failed to expose window.crm:', error)
    throw error
  }
} else {
  // Unreachable by construction — SECURE_WEB_PREFERENCES hardcodes
  // contextIsolation: true — and deliberately NOT a fallback assignment: a
  // bare `window.crm = api` here would silently hand the bridge to a
  // non-isolated world if the flag were ever flipped, exactly the failure
  // T-260828-04's source-binding test exists to prevent. Fail loudly
  // instead.
  throw new Error('[preload] contextIsolation is off — refusing to expose window.crm outside an isolated world')
}
