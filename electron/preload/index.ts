import { contextBridge } from 'electron'

// Deliberately trivial. sandbox: true lands in T-260828-04 and constrains what
// this file may require; the typed window.crm.* surface is built out in
// T-260828-09 once that constraint is settled.
const api = {}

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
