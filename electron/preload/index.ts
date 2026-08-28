import { contextBridge } from 'electron'

// Deliberately trivial. sandbox: true lands in T-260828-04 and constrains what
// this file may require; the typed window.crm.* surface is built out in
// T-260828-09 once that constraint is settled.
const api = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('crm', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error — contextIsolation is always on; this branch is
  // unreachable but keeps the preload from throwing if it's ever disabled.
  window.crm = api
}
