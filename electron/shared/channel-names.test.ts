import { describe, expect, it } from 'vitest'
import { CHANNEL_NAMES } from './channel-names'
import { CHANNEL_CONTRACTS } from './ipc-types'

/**
 * The check that replaces `Object.keys(CHANNEL_CONTRACTS)`.
 *
 * `CHANNEL_NAMES` was derived from `CHANNEL_CONTRACTS` at runtime until the
 * cost of that derivation was measured: it made `channel-names`'s importers
 * importers of the whole schema layer, which mattered for exactly one of
 * them — the sandboxed preload, whose bundle it grew to 204 KB
 * (`channel-names.ts`'s header). Splitting the list out trades a runtime
 * derivation for a hand-written one, and this file is the other half of that
 * trade.
 *
 * `ipc-types.ts` already asserts the two agree as *sets* at compile time
 * (`_ChannelNameCrossCheck`, two `extends` in both directions), so a name
 * present in one and absent from the other does not build. What a type
 * cannot say is that they are in the same *order*, and order is not
 * cosmetic here: `channel-names.ts` is meant to be read side by side with
 * `CHANNEL_CONTRACTS` when adding a channel, and a list that has silently
 * drifted out of order stops being readable that way long before it stops
 * being correct. So this test asserts the stronger thing the type cannot.
 */
describe('CHANNEL_NAMES and CHANNEL_CONTRACTS describe the same channels', () => {
  it('lists exactly the contract keys, in exactly the contract order', () => {
    // Not `.sort()` on either side, and not a set comparison: this is the
    // assertion the compile-time cross-check cannot make.
    expect([...CHANNEL_NAMES]).toEqual(Object.keys(CHANNEL_CONTRACTS))
  })

  it('holds no duplicates', () => {
    // A duplicate would survive both the set-equality types and — since
    // `buildCrmApi` assigns by name — the preload's own loop, silently.
    expect(new Set(CHANNEL_NAMES).size).toBe(CHANNEL_NAMES.length)
  })

  // The third property this pair needs — that `channel-names.ts` imports
  // nothing, which is the whole reason it is a separate file — is asserted
  // in `electron/preload/preload-weight.test.ts` rather than here. It needs
  // `node:fs`, and `electron/shared/**` is compiled under tsconfig.web.json
  // as well as the node one (types.ts's header: no Node or DOM types in
  // this directory), so a `node:fs` import here fails typecheck. It belongs
  // beside the bundle measurement anyway — both are the same claim, one at
  // the source and one at the output.
})
