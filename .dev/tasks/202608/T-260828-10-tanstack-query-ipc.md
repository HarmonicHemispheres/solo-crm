---
id: T-260828-10
title: Wire TanStack Query over IPC as the renderer's data layer
status: open
category: ui
plan_ref: P0-08
created: 2026-08-28
closed:
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

*Appended at close. Delete this heading if the task is dropped.*
