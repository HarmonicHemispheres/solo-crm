import { vi } from 'vitest'
import type { CrmApi } from '../../../shared/ipc-types'

/**
 * A minimal but fully-typed `CrmApi` stub for `lib/*.test.ts(x)` — every
 * test overrides just the channel(s) it cares about via `overrides`, so a
 * channel added later that a given test doesn't know about still leaves it
 * compiling and passing. Shared by `ipc.test.ts` and
 * `query-integration.test.tsx` rather than each keeping its own
 * byte-identical copy.
 */
export function stubCrm(overrides: Partial<CrmApi> = {}): CrmApi {
  return {
    'app:version': vi.fn(async () => ({ ok: true as const, data: { version: '0.1.0' } })),
    'db:schemaVersion': vi.fn(async () => ({ ok: true as const, data: { version: 1, lastMigrationAt: null } })),
    ...overrides
  }
}
