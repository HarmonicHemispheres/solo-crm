---
id: T-260902-16
title: Build the engagement timeline as its own page under Reports
status: open
category: ui
plan_ref: P3-12
created: 2026-09-02
closed:
---

## Why

Every engagement has a start, most have an end, some are rolling, and there is
nowhere in the app that shows them against each other on a time axis. The
mockup has drawn one since the beginning and P3-12 has been waiting on P3-04,
which landed.

## Story

As the operator, I open **Reports → Timeline** and see every engagement as a
bar across the months, grouped by who pays, so I can see what overlaps, what
is ending and what is not signed yet.

## Constraints

- Its own route under the Reports group (T-260902-13), not a toggle on
  `/engagements`. The operator settled this.
- Port the mockup's `ganttView()` / `ganttRow()` (~line 1232), plus two
  controls it does not have: a time range and an active-vs-all filter.
- P3-12's own acceptance: `ends_on = NULL` renders as a fade, not a bar ending
  at an invented date; milestone ticks sit at their `expected_month` and fill
  when completed; unsigned work is distinguishable without relying on colour.
- Bar length and position come from `started_on`/`ends_on` and milestone
  `expected_month` — engagement columns, which ADR-003 permits. **No money
  figure on this page** unless it is one engagement's own headline price;
  anything summed or attributed to a month comes from `revenue_lines`.
- Milestones read through `milestones:list` (T-260902-02). P3-09's editor does
  not exist, so most fixed engagements have none — that must render as an
  honest bar, not as zero ticks implying zero milestones.
- No chart library. Inline SVG or CSS on the tokens, like `RevenueChart`.

## Acceptance

- [ ] A rolling engagement fades at the right edge; a bounded one ends on its
      month.
- [ ] A proposed or pending engagement is distinguishable from an active one
      in a greyscale screenshot.
- [ ] The range control changes which months are drawn; the filter changes
      which engagements are.
- [ ] `npm run snap` — a new `timeline` route at 700/900/1440.
- [ ] Open the app, go to Reports → Timeline, click a bar, land on that
      engagement.

## Related

- `planning/solo-crm-mockup.html` `ganttView` (~1232), `.gantt`/`.gbar` CSS
- `electron/renderer/views/Engagements.tsx`
- `electron/renderer/components/revenue/RevenueChart.tsx` (the SVG pattern)
- `electron/main/db/repositories/milestones.ts`
