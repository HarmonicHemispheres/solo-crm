---
id: T-260902-06
title: The stacked monthly revenue chart, on Revenue and Today, from revenue_lines
status: open
category: ui
plan_ref: P3-11
created: 2026-09-02
closed:
---

## Why

The mockup's chart is a hardcoded fifteen-element array; the real one is
twelve months of `SUM … GROUP BY period_month, kind, status`, stacked by
kind, with projected months drawn distinct from actuals. Today's header
comment records the chart as "deliberately absent" for this reason.

## Story

As the operator, I see the next twelve months of expected revenue stacked
by how it is earned, with what is already invoiced or paid solid and what is
still projected drawn as a projection.

## Constraints

- Reads the series from `revenue:summary` (T-260902-04); no data shaping
  beyond mapping cents to bar heights.
- Projected vs actual distinguishable without colour alone (dashed/hatched,
  plus the legend).
- Inline SVG, tokens from `tokens.css`; no chart library (the app has none).
- `ui-design.md`; snap `revenue` and `today`.

## Acceptance

- [ ] A newly signed retainer changes the chart with no code change.
- [ ] `revMonths` appears nowhere in the codebase.
- [ ] Projected and actual differ in stroke, not only fill.
- [ ] Open the app on the seeded database: bars on both Revenue and Today.

## Related

`views/Revenue.tsx`, `views/Today.tsx`, `components/primitives/Ring.tsx`
(the existing inline-SVG primitive pattern), `styles/tokens.css`,
T-260902-04, T-260902-05.
