---
id: T-260902-19
title: Count task completions by month, so a sparkline can draw something true
status: open
category: data
plan_ref:
created: 2026-09-02
closed:
---

## Why

The mockup's "Closed this month" stat carries a sparkline over the literal
array `[2,4,3,6,5,…]`. `tasks.completed_at` has existed since the table did
and nothing reads it. The app fakes no other number and should not start.

## Story

As the operator, I see how many todos I have closed each month for the last
six months, from what I actually closed.

## Constraints

- One aggregate over `tasks.completed_at`, grouped by month — a read, no
  schema change, no new column.
- `completed_at` is a timestamp; the buckets must be the operator's local
  calendar months, the same lesson T-260901-24 and T-260901-26 already
  recorded about UTC days.
- A month with no completions is a zero in the series, not a gap — a
  sparkline with holes in it lies about the shape.
- The window is a parameter, not a constant baked at six.
- Return counts, not tasks. This is a stat channel, not a list read.

## Acceptance

- [ ] The channel returns one entry per month in the window, zeros included.
- [ ] A task completed at 23:00 local on the last day of a month counts in
      that month, not the next.
- [ ] A test covers the local-month boundary and the zero-fill.
- [ ] `npm run test:unit` passes; `architecture-review` reads the change.

## Related

- `electron/main/db/repositories/tasks.ts`, `electron/main/db/schema.ts:324`
- `electron/shared/tasks.ts`, `electron/main/ipc/registry.ts`
- `electron/renderer/views/todo-urgency.ts` (`localToday`)
