---
id: T-260901-24
title: Default "today" to the local calendar day in the four forms that used the UTC one
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

`formatDateOnly(new Date())` reads UTC fields, so west of UTC after about
17:00 it is tomorrow (LESSONS.md line 12). Four call sites used it for
"today": the affiliation `started` a new person is given, the engagement
sheet's "Starts" default, the person page's move-effective date, and the
quick log's title date. Three of those are written to the database. Create a
person at 18:00 Pacific and the affiliation starts tomorrow; a touch logged
with them that afternoon falls outside `withinAffiliationWindow`.

## Story

As the operator, "today" in a form is the day on my wall clock.

## Constraints

- CONVENTIONS.md: date-only values stay `YYYY-MM-DD`; `localToday()` in
  `views/todo-urgency.ts` already produces one for Todos and Today.
- Values already on a record are untouched — only the empty-form default.

## Acceptance

- [x] No `formatDateOnly(new Date())` remains under `electron/renderer/`.
- [x] Every test over the four forms passes unchanged.

## Related

`components/sheets/PersonSheet.tsx`, `components/sheets/EngagementSheet.tsx`,
`views/PersonDetail.tsx` (move form), `components/shell/QuickLog.tsx`,
`views/todo-urgency.ts`, `shared/format.ts`.

---

## Outcome

**Changed:** the four defaults, each now `localToday()`; unused
`formatDateOnly` imports dropped.

**Departed from scope:** Nothing.

**Not verified:** Not exercised on a clock after 17:00 local; the helper's
own tests cover the boundary.

**Elapsed:** ~5 minutes.
