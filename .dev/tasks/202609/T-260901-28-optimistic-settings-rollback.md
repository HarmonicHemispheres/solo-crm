---
id: T-260901-28
title: Roll back the optimistic settings writes that have no onError
status: done
category: ui
created: 2026-09-01
closed: 2026-09-02
---

## Why

`Todos.tsx`, `People.tsx`, `WorkspaceSettings.tsx` and `Tour.tsx` write a
setting into the query cache and then mutate with no `onError`.
`Companies.tsx` was converted to `lib/ipc.ts`'s `optimisticUpdate` for this
reason (T-260828-53, item 6). A failed `settings:set` leaves the toggle
claiming a preference that reverts on restart.

## Story

As the operator, a toggle that could not be saved goes back to what it was
and tells me, instead of lying until I relaunch.

## Constraints

- CONVENTIONS.md: `optimisticUpdate` takes the `invalidate` helper as its
  `reconcile` argument; no literal keys.
- The four sites should look like `Companies.tsx`'s, not like each other's.

## Acceptance

- [x] Each of the four mutations restores the previous cached value when
      `settings:set` returns `{ ok: false }`.
- [x] Open the app, flip a toggle with `settings:set` made to fail (a stub,
      or a read-only database): it snaps back.

## Related

`electron/renderer/lib/ipc.ts` (`optimisticUpdate`), `views/Companies.tsx`
(~line 255, the model), `views/Todos.tsx` (~150), `views/People.tsx`
(~234), `views/WorkspaceSettings.tsx` (~113), `components/shell/Tour.tsx`
(~128).

---

## Outcome

**Changed:** all four sites - `views/Todos.tsx`, `views/People.tsx`,
`views/WorkspaceSettings.tsx` (`useSetSetting`) and
`components/shell/Tour.tsx` - replace their bare `setQueryData`-then-mutate
pair with `lib/ipc.ts`'s `optimisticUpdate`, spread into the mutation
exactly as `Companies.tsx` does. Three of the four handlers collapse to a
single `mutate` call, since the cache write now lives in `onMutate`.
Rollback tests added to `Todos.test.tsx`, `People.test.tsx` and
`WorkspaceSettings.test.tsx`.

**Departed from scope:** Nothing. The two snapshot-keyed sites
(WorkspaceSettings, Tour) merge into the `settings:getAll` snapshot rather
than replacing it, which is the shape those pages read; the two
detail-keyed ones replace the single entry, as Companies does.

**Not verified:** Nothing. Each of the three new tests was confirmed red
against its unfixed view.

The WorkspaceSettings one needed a second attempt worth recording. Asserting
only the *final* state passed against no fix at all: `waitFor`'s first poll
runs before React has re-rendered the optimistic value, so "still unchecked"
is momentarily true whether or not a rollback exists - LESSONS.md line 14's
species, in a new disguise. The test now holds the failing write open, waits
for the switch to go *on*, then releases it and waits for it to come back
off. That sequence cannot be satisfied by nothing happening.

Tour has no new test: `Tour.test.tsx` already covers the visible consequence
("does not reopen when the flag does not stick"), because `autoOpenedRef`
makes the within-session behaviour identical either way. What changed there
is that the cached snapshot no longer claims a write that failed.

**Elapsed:** ~30 minutes.
