---
id: T-260902-05
title: Build the Revenue view — rollup toggle, four metrics, the by-month table
status: open
category: ui
plan_ref: P3-10
created: 2026-09-02
closed:
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

- [ ] Toggle changes attribution rows and not the total (asserted).
- [ ] `grep` of `views/Revenue.tsx` finds no `billingModel`, `agreedRateCents`,
      `contractValueCents`, `hourlyRateCents`.
- [ ] Empty database → the same honest empty state as today, not zeros.
- [ ] Open the app on the seeded database: four non-zero metrics, rows
      for each company under Billing party.

## Related

`views/Revenue.tsx`, `views/Today.tsx` (its header comment on the deviation
this closes — the hero money stats come back in the same change or a
follow-up), `components/primitives/Stat.tsx`, `planning/solo-crm-mockup.html`
`views.revenue`, T-260902-04.
