---
id: T-260902-07
title: Stop the sandboxed preload bundling zod and every entity schema to read a list of channel names
status: done
category: build
created: 2026-09-02
closed: 2026-09-02
---

## Why

Found in a whole-app scan on 2026-09-02, not reported: `npm run build`
emits `out/preload/index.cjs` at **204.74 kB**, 337 of whose identifiers are
zod's. The preload does one thing — a generic `ipcRenderer.invoke` loop over
`CHANNEL_NAMES` — and needs one value: a list of sixty-eight strings.

`CHANNEL_NAMES` was `Object.keys(CHANNEL_CONTRACTS)`, declared in
`electron/shared/ipc-types.ts`. That is a plain array of string literals as
a *value*, and the preload's header said exactly that — "a plain array of
string literals with no runtime dependency beyond itself". It was false of
the *module*: importing the name pulls in the object it is derived from, and
`CHANNEL_CONTRACTS` is built out of every entity schema in
`electron/shared/`, which is built out of zod. So the whole schema layer was
constructed — `z.object(...)` called, refinements attached — inside the
sandboxed preload context, before the window could load, on every window
creation, to produce a list of strings.

Nothing was insecure about it: the preload still exposed only the fixed
generic loop, `sandbox: true` still held, and no `fs`/`path`/database symbol
was ever reachable. Nothing was visibly broken either, which is the point —
`bridge.test.ts` proves the bridge works end to end in a real Electron
window, and a working bridge is exactly what a 204 KB preload looks like.
No check measured the property at all.

## Story

As the operator, the app's window opens without first building thirty zod
schemas in a process that has no use for them.

## Constraints

- T-260828-04: the preload may import `electron` and nothing that reaches
  `getDatabase()`. That constraint is unchanged and is not what this is
  about.
- Whatever replaces `Object.keys` must keep what `Object.keys` bought —
  a channel added to `CHANNEL_CONTRACTS` and forgotten cannot ship.
- `bundle-preload.ts`'s single-file requirement is unrelated to size and
  stays exactly as it is.

## Acceptance

- [x] `out/preload/index.cjs` contains no zod and no entity schema.
- [x] A check fails if a value import of `ipc-types` returns.
- [x] `CHANNEL_NAMES` and `CHANNEL_CONTRACTS` cannot name different sets.
- [x] `bridge.test.ts` still round-trips `window.crm` through a real
      Electron window and a real preload.

## Related

`electron/preload/index.ts`, `electron/shared/ipc-types.ts`
(`CHANNEL_NAMES`), `electron/main/test-support/bundle-preload.ts`,
`electron.vite.config.ts`.

---

## Outcome

**Changed:** new `electron/shared/channel-names.ts` — the list, and no
imports at all. `ipc-types.ts` re-exports `CHANNEL_NAMES` from it, so no
consumer's import path changes; `electron/preload/index.ts` reads it
directly. New checks: `electron/preload/preload-weight.test.ts` and
`electron/shared/channel-names.test.ts`.

**Result:** 204.74 kB → **3.05 kB**.

**What replaces `Object.keys`.** Three things, because the runtime
derivation was worth something and a hand-written list on its own is not:

- `ChannelName` is still `keyof typeof CHANNEL_CONTRACTS`, so every existing
  call site is still typed off the contracts object.
- `ipc-types.ts` asserts set equality between the two at compile time, in
  both directions (`_ChannelNameCrossCheck`) — a contract without a name and
  a name without a contract each fail to build.
- `channel-names.test.ts` asserts the stronger thing a type cannot: the same
  set *in the same order*, plus no duplicates. Order is not cosmetic — the
  file is meant to be read side by side with `CHANNEL_CONTRACTS` when adding
  a channel.

This is the arrangement `registry.ts` already lives under: two hand-written
descriptions of one set, with a check that they agree. Adding a channel is
now three edits rather than two, and the tests name the third if it is
missed.

**Departed from scope:** The "imports nothing" source scan lives in
`preload/preload-weight.test.ts` rather than beside `channel-names.test.ts`.
It needs `node:fs`, and `electron/shared/**` compiles under
tsconfig.web.json as well as the node one (`shared/types.ts`'s header: no
Node or DOM types in that directory). It belongs beside the bundle
measurement anyway — both are the same claim, one at the source and one at
the output.

**Not verified:** Nothing. Both bundle assertions were confirmed red by
restoring the old import: 606,656 bytes unminified against the 24 KB
ceiling, and `"ZodObject" is in the preload bundle`. The size ceiling is
deliberately blunt (an order of magnitude of headroom, catching "something
large got pulled in" without predicting what) and the identifier scan
deliberately specific (naming the failure that actually happened, so a
regression reads as a cause rather than as a number going up).

**Elapsed:** ~25 minutes.
