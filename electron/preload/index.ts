import { contextBridge, ipcRenderer } from 'electron'
import { CHANNEL_NAMES } from '../shared/ipc-types'
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
 * `CHANNEL_NAMES` (electron/shared/ipc-types.ts) is a plain array of string
 * literals with no runtime dependency beyond itself — it is the one file
 * this preload may safely import besides `electron` itself, since
 * registry.ts (the real channel definitions) reaches `getDatabase()`, which
 * eagerly loads the `better-sqlite3` native addon the moment it is
 * imported, something sandbox: true means this file can never do (T-260828-04's
 * outcome).
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
  // @ts-expect-error — contextIsolation is always on; this branch is
  // unreachable but keeps the preload from throwing if it's ever disabled.
  window.crm = api
}
