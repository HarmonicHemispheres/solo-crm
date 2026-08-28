import { describe, expect, it } from 'vitest'
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
  it('every channel a fresh CrmApi declares has a default — the stub satisfies the full type with no overrides', () => {
    const crm = stubCrm()
    expect(typeof crm['companies:list']).toBe('function')
    expect(typeof crm['settings:reset']).toBe('function')
  })

  it('"settings:getAll"’s default covers exactly SETTINGS_KEYS — no missing key, no stale one', async () => {
    const result = await stubCrm()['settings:getAll']()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.data).sort()).toEqual([...SETTINGS_KEYS].sort())
  })
})
