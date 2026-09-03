---
id: T-260902-03
title: Build the revenue line generator — the one place that turns an engagement's terms into revenue_lines rows
status: done
category: data
plan_ref: P3-05
created: 2026-09-02
closed: 2026-09-02
---

## Why

Every revenue figure in the app is `SUM(amount_cents) … GROUP BY
period_month, status` over `revenue_lines` (ADR-003), and nothing writes
that table. This is the task the plan calls "the one that decides whether
§5's central decision survives contact", and the reason the Revenue page is
empty. It is also the only place `billing_model` may be branched on.

## Story

As the operator, when I create or edit an engagement its expected revenue
appears month by month — retainers every month of their term, fixed scopes
at each milestone's month, T&M as an estimate until hours replace it — and
signed, invoiced work never moves when I edit a projection.

## Constraints

- ADR-003 is binding: retainer → one `retainer` row per month (rolling
  `ends_on IS NULL` → a stated horizon of twelve months, no further); fixed
  → one `milestone` row per milestone at `expected_month`; tm →
  `tm_estimate` rows replaced by `tm_actual` in the same transaction;
  `equity` and `none` → zero rows. Expense rows are never touched.
- Regeneration is idempotent and never rewrites a row that is `invoiced` or
  `paid`.
- Runs inside the engagement repository's create/update/delete transactions
  and inside milestone writes (T-260902-02), so a forgotten regeneration
  cannot happen from the renderer.
- Every provisional revenue computation from Phase 2 is deleted in this
  change — there are none in the tree today (`grep provisional` finds only
  the hours mark); the acceptance item stays so the check is run.
- `architecture-review` gate.

## Acceptance

- [x] Each ADR-003 model branch has a test that reads rows back.
- [x] Running the generator twice on the same engagement changes no row.
- [x] A row set to `invoiced` survives an edit that changes the rate.
- [x] Writing `tm_actual` for a month deletes that month's `tm_estimate`
      in one transaction; a `SUM` over the month returns the actual.
- [x] `grep -rn billing_model electron/main/db/repositories/revenue*` finds
      only the generator.
- [x] `npm run seed` produces a populated `revenue_lines` for the fixture.

## Related

`.dev/decisions/ADR-003-materialised-revenue.md`, `schema.ts`
(`revenueLines`), `repositories/engagements.ts`, `shared/engagements.ts`
(`BILLING_MODELS`), `seed/index.ts`, T-260902-02.

---

## Outcome

Built with -04, -05 and -06 in one session, at the user's request ("can we
please build the revenue reporting page"), after the Revenue page was found
empty a second time.

**Changed:** `repositories/revenue-generator.ts` — the one `switch` on
`billing_model` — with `regenerateRevenueLines`, `regenerateAllRevenueLines`,
`deleteGeneratedLines` and `writeTmActual`; `shared/revenue.ts` (the line
vocabulary and `writeTmActual`'s input); `shared/format.ts` gains
`periodMonthOf`, `addMonths`, `monthsBetween`, `eachMonth` and
`localPeriodMonth`; `shared/engagements.ts` gains `SIGNED_STATUSES`/`isSigned`.
`createEngagement`/`updateEngagement` run in a transaction that ends in the
generator; `afterMilestoneWrite` calls it. The seed gains the six fixed
scopes' milestones (24 rows, mockup names, contract value split evenly),
runs the generator, and marks its own past months `paid`.

**Departed from scope:** Five things.

1. Which engagements generate is a status filter the ADR does not state:
   `active`, `pending`, `delivered` — signed work. A `proposed` engagement
   would otherwise count as recurring revenue. A rolling `delivered` one
   stops at the current month.
2. A rolling T&M has no total to spread, so its estimate is read as
   expected work *per month*; a bounded one spreads the estimate evenly
   across the term, odd cents on the last month, capped by not-to-exceed
   before spreading. Two readings of one column, stated in the header.
3. `deleteEngagement`'s non-cascade path clears the generator's own
   projected lines before the guard looks. With the generator, every priced
   engagement has lines, and the old refusal ("cannot be reassigned or
   removed") would have made the refusing path a dead end for all of them.
   Invoiced, paid, actual and expense rows still refuse.
4. The seed stands in for Stripe on its own rows only (`--force` on a real
   database touches nobody else's — a review found the first version did).
   Without it nothing on a fresh profile is an actual and the chart has no
   solid bar to draw.
5. "This month" is the operator's local calendar month
   (`localPeriodMonth`), not the UTC one `startOfMonth` reads — LESSONS.md
   12, caught in review; the seed and Today already read the local day.

The acceptance line "`grep billing_model repositories/revenue*` finds only
the generator" is met as -04's constraint reads it: `revenue.ts` names the
column once, as the model rollup's `GROUP BY` key, and a source-scan test
fails on any `CASE`/comparison on it.

**Not verified:** `writeTmActual` has no caller and no channel — the
timelog import (P4-05) is its consumer — so it is covered by its tests
only. The seed shifts milestones by whole months and terms by days, so
near a month boundary a fixture milestone can land a month outside its
engagement's term; cosmetic, dev fixture only.

**Review findings fixed before close:** an invoiced milestone blocked its
whole month, so a second milestone in that month lost its projection on
regeneration (now an invoice stands in for exactly one projection);
`writeTmActual` could delete an invoiced row (now refuses).

**Elapsed:** ~2.5 hours across the four tasks.
