import { describe, expect, it } from 'vitest'

/**
 * Proves window.d.ts's global `Window.crm` typing reaches renderer code
 * (tsconfig.web.json includes electron/renderer/**\/* and electron/shared/**\/*,
 * where CrmApi is defined) and that calling both proof channels with the
 * calling convention T-260828-10 will use — `window.crm['app:version']()`,
 * no argument — typechecks. `window.crm` is only ever real inside a genuine
 * Electron renderer under sandbox: true; electron/main/ipc/bridge.test.ts
 * proves that end. This file proves the type surface: renaming or removing
 * a channel in electron/shared/ipc-types.ts's CHANNEL_CONTRACTS changes
 * CrmApi, and the calls below stop typechecking under `npm run typecheck`
 * — verified by hand while building this task (renamed 'app:version' to
 * 'app:versionX' in both CHANNEL_CONTRACTS and registry.ts's matching
 * entry, confirmed `tsc -p tsconfig.web.json` failed exactly at the
 * `window.crm['app:version']` call sites below with "Did you mean
 * 'app:versionX'?", and independently that `tsc -p tsconfig.node.json`
 * failed at registry.test.ts's own references — then reverted both).
 */
describe('window.crm', () => {
  it('exposes typed, named methods for both proof channels, matching contextBridge’s calling convention', async () => {
    const calls: Array<{ channel: string; payload: unknown }> = []
    window.crm = {
      'app:version': async (payload) => {
        calls.push({ channel: 'app:version', payload })
        return { ok: true, data: { version: '0.1.0' } }
      },
      'db:schemaVersion': async (payload) => {
        calls.push({ channel: 'db:schemaVersion', payload })
        return { ok: true, data: { version: 1, lastMigrationAt: '2026-08-28T00:00:00.000Z' } }
      }
    }

    const appVersion = await window.crm['app:version']()
    const schemaVersion = await window.crm['db:schemaVersion']()

    expect(appVersion).toEqual({ ok: true, data: { version: '0.1.0' } })
    expect(schemaVersion).toEqual({
      ok: true,
      data: { version: 1, lastMigrationAt: expect.any(String) }
    })
    // Both calls happened with no payload — CrmApi makes the parameter
    // optional exactly when a channel's request schema accepts `undefined`
    // (electron/shared/ipc-types.ts's ChannelMethod).
    expect(calls).toEqual([
      { channel: 'app:version', payload: undefined },
      { channel: 'db:schemaVersion', payload: undefined }
    ])
  })

  it('a { ok: false } envelope is a valid, typed resolution — not a rejection a caller must catch', async () => {
    window.crm = {
      'app:version': async () => ({ ok: false, error: { code: 'handler-error', message: 'something went wrong' } }),
      'db:schemaVersion': async () => ({ ok: true, data: { version: 1, lastMigrationAt: null } })
    }

    const result = await window.crm['app:version']()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('handler-error')
    }
  })
})
