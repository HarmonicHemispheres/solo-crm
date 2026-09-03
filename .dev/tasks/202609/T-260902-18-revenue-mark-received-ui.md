---
id: T-260902-18
title: Give the Revenue page a way to mark a month received, and stop every bar reading as a forecast
status: open
category: ui
plan_ref:
created: 2026-09-02
closed:
---

## Why

The operator reported "all bars in the recognised-by-month chart show as
projected". They do, correctly — nothing in the app can say otherwise.
T-260902-17 makes a line markable; without a surface, nobody can mark one.

## Story

As the operator, I mark last month's retainer as paid from the Revenue page
and watch the bar go solid, so the chart shows a real past and a dashed
future instead of dashes all the way across.

## Constraints

- Depends on T-260902-17.
- The chart itself is not the bug and its projected/actual treatment
  (T-260902-06: paler *and* dashed, legible in greyscale) does not change.
- The Revenue page today has four stats, the chart card and the Rollup table —
  no by-month table. Marking a month needs somewhere to live; decide where
  rather than bolting a control onto the chart's SVG.
- Marking is a write from a page that has only ever read. Follow
  T-260901-28's rule: an optimistic update rolls back on error.
- **Every number stays a `SUM … GROUP BY` off `revenue_lines`** (ADR-003).
  This adds a way to change a row's status; it does not add a second place
  revenue is computed.
- While nothing is marked, the page should say why everything is projected
  rather than leaving the legend implying a distinction that does not exist —
  the same honesty the empty state already has (T-260902-01).

## Acceptance

- [ ] Marking a month paid turns its bars solid without a reload.
- [ ] Unmarking returns them to dashed.
- [ ] With no line marked, the page states that revenue is projected until
      invoices are recorded or Stripe is connected.
- [ ] `npm run snap` — `revenue` and `today` at 700/900/1440.
- [ ] Open the app, go to Revenue, mark a past month paid, see the chart
      change and the Today chart agree.

## Related

- `electron/renderer/views/Revenue.tsx` / `.css`
- `electron/renderer/components/revenue/RevenueChart.tsx` / `.css`
- `electron/renderer/views/Today.tsx` (the same chart)
