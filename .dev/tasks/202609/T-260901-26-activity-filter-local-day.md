---
id: T-260901-26
title: Make the Activity view's date-range filter use the same calendar day the rows display
status: open
category: ui
created: 2026-09-01
closed:
---

## Why

`Activity.tsx` builds `occurredFrom`/`occurredTo` as UTC-midnight bounds of
the picked date while rendering each row's `occurredAt` in local time. A
touch logged at 18:00 Pacific on Sep 1 is stored as `2026-09-02T01:00Z`,
reads "Sep 1, 6:00 PM", and is excluded by From=Sep 1/To=Sep 1 but included
by From=Sep 2. Every evening touch lands under the next day's filter.

## Story

As the operator, filtering Activity to a day shows the rows that say that
day on them.

## Constraints

- CONVENTIONS.md: timestamps stay UTC on the wire; the conversion belongs
  at the edge, in the renderer, when the bounds are built.
- LESSONS.md line 12.

## Acceptance

- [ ] A row displayed on day D is included by a filter From=D, To=D, for a
      timestamp whose UTC date is D+1.
- [ ] Open the app after 17:00 local, log a touch, filter Activity to today:
      it is listed.

## Related

`electron/renderer/views/Activity.tsx` (the bounds, ~line 99; the row
format, ~line 86), `views/todo-urgency.ts`'s `localToday`,
`shared/format.ts`.
