---
id: T-260901-26
title: Make the Activity view's date-range filter use the same calendar day the rows display
status: done
category: ui
created: 2026-09-01
closed: 2026-09-02
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

- [x] A row displayed on day D is included by a filter From=D, To=D, for a
      timestamp whose UTC date is D+1.
- [x] Open the app after 17:00 local, log a touch, filter Activity to today:
      it is listed.

## Related

`electron/renderer/views/Activity.tsx` (the bounds, ~line 99; the row
format, ~line 86), `views/todo-urgency.ts`'s `localToday`,
`shared/format.ts`.

---

## Outcome

**Changed:** `views/Activity.tsx` — `dayStartTimestamp`/`dayEndTimestamp`
now build the picked day with the *local* `Date` constructor and convert to
the wire's UTC instant, in place of `parseDateOnly`'s UTC midnight. The
`DAY_MS` constant and the `parseDateOnly` import went with it.
`Activity.test.tsx` gains the regression test and loses a literal.

**Departed from scope:** Two small things, both in the same direction.

The end bound is built field by field (23:59:59.999 local) rather than as
`start + DAY_MS - 1`, which the old code did: a day is not always 86,400,000
ms long, and on a spring-forward date the arithmetic version runs the range
an hour into the next day. The same class of bug as the one being fixed,
found while fixing it.

The existing date-range test asserted the literal `'2026-08-20T00:00:00.000Z'`
- an assertion about the machine's timezone, and the one that encoded the
bug. It now builds the expected instant the same way the view does.

**Not verified:** Nothing, but worth naming how. The new test builds its
fixture *from* the local timezone (18:00 local on the filtered day), so it
states the same property wherever it runs: in UTC the two frames coincide
and it passes trivially, and on this machine (America/Los_Angeles) it is the
regression. Confirmed red against the unfixed view, with the message
`2026-09-02T01:00:00.000Z (shown as Sep 1) must fall inside
[2026-09-01T00:00:00.000Z, 2026-09-01T23:59:59.999Z]`.

A first draft of that test asserted the *rendered* row instead, and passed
against no fix at all: `placeholderData: keepPreviousData` deliberately
holds the previous rows on screen through the refetch, so `getByText` finds
the row whether or not the new filter would exclude it. The assertion is on
the bounds that crossed the IPC boundary, which is what the repository's SQL
actually compares.

**Elapsed:** ~20 minutes.
