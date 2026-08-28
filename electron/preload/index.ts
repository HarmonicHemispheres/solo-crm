import { contextBridge } from 'electron'

// Deliberately trivial. sandbox: true lands in T-260828-04 and constrains what
// this file may require; the typed window.crm.* surface is built out in
// T-260828-09 once that constraint is settled.
const api = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('crm', api)
  } catch (error) {
    // Write to stderr directly (console.error here only reaches the
    // preload's own console, not the main-process terminal) and rethrow:
    // window.crm never exists if this fails, and an uncaught preload error
    // is what Electron itself logs where the app was launched (and fires
    // app's 'preload-error'), so both together make the failure visible
    // instead of surfacing later as an unexplained "window.crm is
    // undefined" in the renderer.
    process.stderr.write(`[preload] failed to expose window.crm: ${String(error)}\n`)
    throw error
  }
} else {
  // @ts-expect-error — contextIsolation is always on; this branch is
  // unreachable but keeps the preload from throwing if it's ever disabled.
  window.crm = api
}
