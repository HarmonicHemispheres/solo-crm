---
id: T-260901-25
title: Escape in the person-detail fields and the category rename must not save through the unmount blur
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

`LinksCard` guards against the blur Chromium fires when a focused input is
unmounted; `PersonDetail`'s `DetailField` and `Offerings`' `CategoryRenameInput`
have the same `onBlur={commit}` shape without it. Click Email, type a wrong
value, press Escape: the wrong value is saved. Enter on the category rename
sends `offerings:updateCategory` twice. Their jsdom tests pass because jsdom
fires no blur on removal.

## Story

As the operator, Escape means "never mind" and Enter means "once".

## Constraints

- The first outcome wins: whichever of Enter/Escape/blur lands first
  settles the edit and the rest are ignored.
- `DetailField` stays mounted between edits, so the guard must re-arm when
  an edit starts.

## Acceptance

- [x] Escape then blur: no `people:update` / `offerings:updateCategory`.
- [x] Enter then blur: exactly one call.
- [x] Editing a second time after an Escape still commits.

## Related

`views/PersonDetail.tsx` (`DetailField`), `views/Offerings.tsx`
(`CategoryRenameInput`), `components/links/LinksCard.tsx` (the pattern).

---

## Outcome

**Changed:** a `settled` ref in each editor; four tests; a new
`lib/test-support/unmount-blur.ts` (`keyDownWithUnmountBlur`).

**Departed from scope:** The first version of the four tests followed
`LinksCard.test.tsx`'s shape — keydown, then `fireEvent.blur` — and the
code review showed all four passing against the unguarded code: RTL's
`act` has flushed the unmount before the blur is fired, so it lands on a
detached node React never sees; and a synchronous `not.toHaveBeenCalled`
runs before the mutation's `mutationFn` would. The helper replays the blur
from a `document` keydown listener (after React's handler, before the
flush) and settles pending work before returning. All four tests were then
confirmed red on the old code. `LinksCard.test.tsx`'s existing Escape test
had the same vacuous shape and now uses the helper too.

**Not verified:** The third acceptance item has no dedicated test; the ref
is reset in the same click that starts an edit, beside `setDraft`.

**Elapsed:** ~45 minutes.
