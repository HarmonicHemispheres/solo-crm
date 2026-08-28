import type { CrmApi } from '../shared/ipc-types'

/**
 * The renderer's only view of `window.crm` — typed from the same
 * `CrmApi` the preload builds `contextBridge.exposeInMainWorld('crm', ...)`
 * from (T-260828-09). Renaming, removing or reshaping a channel in
 * `electron/main/ipc/registry.ts` changes `CrmApi`, and any renderer call
 * site that no longer matches fails `npm run typecheck` — the acceptance
 * criterion this file exists to make true.
 */
declare global {
  interface Window {
    // Not `readonly`: contextBridge exposes it as a frozen value at runtime,
    // but a plain (non-readonly) member lets renderer tests assign a stub
    // window.crm directly (window-crm.test.ts) rather than fighting
    // TypeScript's readonly checks for what is, in a jsdom test, an
    // ordinary mutable global.
    crm: CrmApi
  }
}

export {}
