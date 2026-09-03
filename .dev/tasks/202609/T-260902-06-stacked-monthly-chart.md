---
id: T-260902-06
title: The stacked monthly revenue chart, on Revenue and Today, from revenue_lines
status: done
category: ui
plan_ref: P3-11
created: 2026-09-02
closed: 2026-09-02
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

- [x] A newly signed retainer changes the chart with no code change.
- [x] `revMonths` appears nowhere in the codebase.
- [x] Projected and actual differ in stroke, not only fill.
- [x] Open the app on the seeded database: bars on both Revenue and Today.

## Related

`views/Revenue.tsx`, `views/Today.tsx`, `components/primitives/Ring.tsx`
(the existing inline-SVG primitive pattern), `styles/tokens.css`,
T-260902-04, T-260902-05.

---

## Outcome

Built with -03, -04 and -05; see -03's Outcome for the session.

**Changed:** `components/revenue/RevenueChart.tsx` and `.css` — the mockup's
`stackChart()` over `revenue:summary`'s series, twelve months from three
back to eight ahead, a dashed divider after the current month, and
`RevenueLegend`. Actual segments are solid; projected ones are paler *and*
dashed (`vector-effect: non-scaling-stroke`, so the dash survives the
stretched canvas). On Revenue at 190px and Today at 150px.

**Departed from scope:** Two things.

1. `expense` is not a stack — a negative amount has no height — so the
   series is gross of expenses and `REVENUE_SERIES_KINDS` says so; the
   tiles and the table are net. Nothing writes an expense row yet.
2. The tooltip names the month only. A per-month money total summed in the
   component would have been a revenue figure computed in the renderer
   (conventions review); the bar scale is unitless.

**Not verified:** The stroke difference is asserted by class in the tests,
not by computed style — jsdom applies no stylesheet. The screenshots show
it.

**Elapsed:** see -03.
