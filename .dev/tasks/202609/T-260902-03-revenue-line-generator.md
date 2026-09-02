---
id: T-260902-03
title: Build the revenue line generator — the one place that turns an engagement's terms into revenue_lines rows
status: open
category: data
plan_ref: P3-05
created: 2026-09-02
closed:
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

- [ ] Each ADR-003 model branch has a test that reads rows back.
- [ ] Running the generator twice on the same engagement changes no row.
- [ ] A row set to `invoiced` survives an edit that changes the rate.
- [ ] Writing `tm_actual` for a month deletes that month's `tm_estimate`
      in one transaction; a `SUM` over the month returns the actual.
- [ ] `grep -rn billing_model electron/main/db/repositories/revenue*` finds
      only the generator.
- [ ] `npm run seed` produces a populated `revenue_lines` for the fixture.

## Related

`.dev/decisions/ADR-003-materialised-revenue.md`, `schema.ts`
(`revenueLines`), `repositories/engagements.ts`, `shared/engagements.ts`
(`BILLING_MODELS`), `seed/index.ts`, T-260902-02.
