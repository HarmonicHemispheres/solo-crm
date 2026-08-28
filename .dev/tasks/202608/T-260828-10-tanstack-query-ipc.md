---
id: T-260828-10
title: Wire TanStack Query over IPC as the renderer's data layer
status: done
category: ui
plan_ref: P0-08
created: 2026-08-28
closed: 2026-08-28
---

## Why

Requirements §4: treat IPC as a fetch layer and get caching and invalidation for
free. The alternative — components calling `window.crm` directly and holding
their own state — means every surface that can create a todo has to know every
other surface that displays one. §6.6 puts inline quick-add on *every* view, so
that coupling would be immediate and everywhere.

## Scope

**In:**

- `QueryClient` configured for a local synchronous data source: no window-focus
  refetch, no retry-on-failure by default, `staleTime` chosen deliberately. The
  defaults are tuned for a flaky network that does not exist here, and leaving
  them produces pointless IPC traffic.
- A `queryFn` wrapper that calls a named `window.crm` method and turns the error
  envelope from T-260828-09 into a thrown error Query can handle.
- A query-key convention, written down: entity, scope, id. Documented in
  `CONVENTIONS.md` alongside the date rules so there is one place to look.
- Invalidation helpers per entity, so a mutation names what it invalidates rather
  than each call site guessing.
- An optimistic-update helper for the inline interactions §6.6 requires —
  completing a todo, toggling next-step — including rollback on failure.

**Out:** Any entity query or mutation (P1-07 exposes the channels; the views
consume them). Component work of any kind. Persisting cache to disk — the data
source is local and synchronous, so there is nothing to persist for.

## Touches

- `electron/renderer/lib/query-client.ts` — new
- `electron/renderer/lib/ipc.ts` — `queryFn` / `mutationFn` wrappers
- `electron/renderer/lib/query-keys.ts` — the convention
- `electron/renderer/App.tsx` — provider
- `CONVENTIONS.md` — the key convention

## Acceptance

- [ ] A mutation against one of T-260828-09's proof channels updates every
      component reading that key, with no manual refetch
- [ ] The optimistic helper rolls back and surfaces the error when a mutation
      fails — proven with a deliberately failing channel in a test
- [ ] An error envelope from main reaches the component as a typed error, not as
      an object rendering `[object Object]`
- [ ] Window focus does not trigger refetches
- [ ] The query-key convention is documented and used by the proof queries

## Risks

- **TanStack Query's defaults assume a network.** Retries, refetch-on-focus and
  refetch-on-reconnect are all wrong for a synchronous local database and produce
  work that looks like a performance problem later. Set them explicitly.
- Optimistic updates are the one place this layer can show the user something
  false. The rollback path needs a test, not a code read — it is the path nobody
  exercises manually.
- §8 requires views to render under 100ms at 10× volume. A `staleTime` of zero
  turns every navigation into a fresh IPC round trip; too long and a
  just-completed todo reappears. State the value chosen and why.
- This is `ui` by directory but it is the contract every later view depends on. A
  key convention changed in Phase 2 is a change to every view written before it.

---

## Outcome

Merged to main in run R-260828-01 (commits `92578fb` + fix round `449be5b`).
`electron/renderer/lib/`: `query-client.ts` (staleTime Infinity, no
focus/reconnect refetch, no retries — every default deliberate and argued in
CONVENTIONS.md's new "Query cache" section), `ipc.ts` (`callCrm` converts the
IpcResult envelope to a typed `IpcCallError` — including a
`'bridge-unavailable'` code when the preload never exposed `window.crm` —
plus `ipcQueryFn`/`ipcMutationFn` and `optimisticUpdate`), `query-keys.ts`
(`[entity, scope, id?]` factories + `invalidate` helpers typed
`Record<keyof typeof queryKeys, …>` so a new entity without its helper fails
tsc). Key convention documented in CONVENTIONS.md beside the date rules.

**staleTime: Infinity** — correctness comes from explicit per-entity
invalidation, not a clock; a missing `invalidate.<entity>()` is the bug to
fix, never a smaller duration. The P4-01 sync-writer gap this opens is
recorded with task-ID pointers in CONVENTIONS.md.

Review found the optimistic path genuinely broken and falsely certified:
rollback was a silent no-op when the key had nothing cached (query-core
ignores `setQueryData(key, undefined)` — the false value stayed rendered),
and both tests behind that criterion were vacuous. The fix round: `removeQueries`
on the empty-snapshot path; both tests rewritten to run the real
onMutate→error cycle and wait for `mutation.status === 'error'`;
`optimisticUpdate` now REQUIRES the per-entity invalidate helper as its
`reconcile` argument (the raw-key invalidation contradicted the branch's own
convention — the P1-07 trip hazard); a real per-key mutex serializes
concurrent optimistic mutations across the full cycle (TanStack's `scope`
only serializes the network call — discovered empirically); the window-focus
test is load-bearing (fails if the flag flips); App provider smoke test.
Every fix proven by reintroducing the bug and watching its test fail.

Verify after fixes: 284/284 tests, all gates green. Declined with reasoning:
DataTag key↔data typing (would couple key factories 1:1 to channel names;
revisit at P1-07).

Handoff for P1-07 and the view tasks: build keys only via `queryKeys.*`
factories, invalidate only via `invalidate.<entity>()`, and use
`optimisticUpdate` for §6.6's inline interactions — the reconcile argument is
required on purpose.
