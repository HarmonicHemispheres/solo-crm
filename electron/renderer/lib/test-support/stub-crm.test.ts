import { describe, expect, it } from 'vitest'
import { CHANNEL_NAMES } from '../../../shared/ipc-types'
import { SETTINGS_KEYS } from '../../../shared/settings'
import { stubCrm } from './stub-crm'

/**
 * `stub-crm.ts`'s header claims its `settings:getAll` default is "kept in
 * sync... by this file's coverage check against that registry, not by
 * hand" — this is that check. `SETTINGS_KEYS` (electron/shared/settings.ts)
 * is the live registry; a key added there with no matching entry in
 * `STUB_SETTINGS_SNAPSHOT` would otherwise only surface as a `tsc` object-
 * literal error deep inside `stub-crm.ts`, not as a readable failure naming
 * the missing key.
 */
describe('stubCrm', () => {
  it('every CHANNEL_NAMES entry has a default — the stub satisfies the full type with no overrides', () => {
    // Review fix (item 5): `typeof crm['companies:list'] === 'function'`
    // cannot fail — `stubCrm()` is typed to return `CrmApi`, so a missing
    // default is already a tsc error, and this assertion was proving
    // nothing at runtime. Iterating CHANNEL_NAMES instead asserts what this
    // file's own header promises: EVERY channel, not two hand-picked ones,
    // has a default — and it grows automatically as CHANNEL_NAMES does.
    const crm = stubCrm()
    for (const name of CHANNEL_NAMES) {
      expect(typeof crm[name]).toBe('function')
    }
  })

  it('"settings:getAll"’s default covers exactly SETTINGS_KEYS — no missing key, no stale one', async () => {
    const result = await stubCrm()['settings:getAll']()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.data).sort()).toEqual([...SETTINGS_KEYS].sort())
  })
})
