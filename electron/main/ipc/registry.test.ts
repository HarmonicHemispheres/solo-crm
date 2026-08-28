import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHANNEL_NAMES } from '../../shared/ipc-types'

// electron/main/db/connection.ts imports `app` from 'electron' at its own
// top level (for the no-override resolveDatabasePath path, unused below
// since every test here passes an explicit userDataDir). This module also
// calls app.getVersion() inside the 'app:version' handler. Mocking the
// whole 'electron' module keeps this file running as an ordinary
// vitest/Node test — the real Electron boot proof lives in bridge.test.ts.
// vi.mock is hoisted above every import in this file (vitest's static
// analysis, not execution order), so the imports below already see the
// mocked module.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test',
    getPath: () => {
      throw new Error('app.getPath should not be called — every test here overrides userDataDir')
    }
  }
}))

const { closeDatabase, openDatabase } = await import('../db/connection')
const { registry } = await import('./registry')


afterEach(() => {
  closeDatabase()
})

describe('registry keys match electron/shared/ipc-types.ts CHANNEL_NAMES', () => {
  it('has exactly the same channel names as the shared, preload-safe mirror', () => {
    // The runtime half of the drift guard (the compile-time half is the
    // mapped-type `satisfies` in registry.ts, which couples the channel set
    // AND each entry's schemas to CHANNEL_CONTRACTS). registry.ts is the
    // single source for what a channel validates and does; CHANNEL_NAMES is
    // the one thing named a second time, for preload — this proves the two
    // never diverge.
    expect(Object.keys(registry).sort()).toEqual([...CHANNEL_NAMES].sort())
  })
})

describe("'app:version'", () => {
  it('request schema accepts no payload and rejects a real value', () => {
    expect(registry['app:version'].request.safeParse(undefined).success).toBe(true)
    expect(registry['app:version'].request.safeParse({ extra: true }).success).toBe(false)
  })

  it('handler returns the app version, and it passes the response schema', async () => {
    const result = await registry['app:version'].handler(undefined)
    expect(result).toEqual({ version: '0.1.0-test' })
    expect(registry['app:version'].response.safeParse(result).success).toBe(true)
  })
})

describe("'db:schemaVersion'", () => {
  it('handler reads through getDatabase()/getSchemaVersion(), and the result passes the response schema', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-ipc-registry-'))
    try {
      openDatabase({ userDataDir: tmpDir })
      const result = await registry['db:schemaVersion'].handler(undefined)
      expect(result).toEqual({ version: 1, lastMigrationAt: expect.any(String) })
      expect(registry['db:schemaVersion'].response.safeParse(result).success).toBe(true)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
