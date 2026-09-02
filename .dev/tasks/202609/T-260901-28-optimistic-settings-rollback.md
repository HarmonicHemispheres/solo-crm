---
id: T-260901-28
title: Roll back the optimistic settings writes that have no onError
status: open
category: ui
created: 2026-09-01
closed:
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

- [ ] Each of the four mutations restores the previous cached value when
      `settings:set` returns `{ ok: false }`.
- [ ] Open the app, flip a toggle with `settings:set` made to fail (a stub,
      or a read-only database): it snaps back.

## Related

`electron/renderer/lib/ipc.ts` (`optimisticUpdate`), `views/Companies.tsx`
(~line 255, the model), `views/Todos.tsx` (~150), `views/People.tsx`
(~234), `views/WorkspaceSettings.tsx` (~113), `components/shell/Tour.tsx`
(~128).
