---
id: T-260902-05
title: Build the Revenue view — rollup toggle, four metrics, the by-month table
status: done
category: ui
plan_ref: P3-10
created: 2026-09-02
closed: 2026-09-02
---

## Why

The route shows a header over an explanation (T-260902-01). Once
`revenue:summary` exists (T-260902-04) the §6.7 view can be built the way
the mockup draws it: a Billing party / End client / Model toggle, four stat
tiles, and the "Recognised by month" card — with every number read from the
channel and none computed in the component.

## Story

As the operator, I open Revenue and see this month's recurring revenue,
the fixed backlog, the T&M run rate and how concentrated I am on my largest
payer; I flip the toggle and the same money is attributed a different way.

## Constraints

- ADR-003: no arithmetic over engagement columns in the renderer; the only
  numbers on the page arrive from `revenue:summary`.
- The mockup's `views.revenue` is the visual spec: `Stat` tiles, the
  concentration bar, the legend. Its `revMonths` array is not ported.
- `ui-design.md`; `npm run snap -- --routes revenue` at three widths.
- Replaces the T-260902-01 body; keep its header and info text.

## Acceptance

- [x] Toggle changes attribution rows and not the total (asserted).
- [x] `grep` of `views/Revenue.tsx` finds no `billingModel`, `agreedRateCents`,
      `contractValueCents`, `hourlyRateCents`.
- [x] Empty database → the same honest empty state as today, not zeros.
- [x] Open the app on the seeded database: four non-zero metrics, rows
      for each company under Billing party.

## Related

`views/Revenue.tsx`, `views/Today.tsx` (its header comment on the deviation
this closes — the hero money stats come back in the same change or a
follow-up), `components/primitives/Stat.tsx`, `planning/solo-crm-mockup.html`
`views.revenue`, T-260902-04.

---

## Outcome

Built with -03, -04 and -06; see -03's Outcome for the session.

**Changed:** `views/Revenue.tsx` and `Revenue.css` replace T-260902-01's
body: the toggle in the header, four `Stat` tiles (Recurring / month is the
hero, with the next-twelve-months figure beneath it — the annualised number
ADR-003 routes through `revenue_lines`), the chart card and the rollup
table with a totals footer. `Today.tsx` gets §6.1's money tiles back in
place of the two stand-in counts, and the chart card in the mockup's
position. `formatMoney` and a new `plural` in `offerings-display.ts` serve
both. `revenue-single-source.test.ts` scans the two views and the chart
for any engagement price column.

**Departed from scope:** Two things.

1. Today's hero moved from Open todos to Recurring / month, which is the
   mockup's; Open todos stays, plain. "Active engagements" and "Companies"
   went with their test.
2. A failing `revenue:summary` is not folded into Today's `loadError`: the
   tiles read a dash and the Revenue card shows the message, so one bad
   revenue row cannot blank the dashboard's todos (review finding).

**Not verified:** Nothing. Screenshots at 1440/900/700 show four non-zero
tiles, rows for each billing party, and no overflow at any width. Follow-
ups, not done here: a shared identity-mark primitive (Revenue's is the
sixth private copy), a shared `layout.css` for `.grid`/`.stats` (fifth
copy), and one `BILLING_MODEL_LABEL` map instead of the rollup's own in
main.

**Elapsed:** see -03.
