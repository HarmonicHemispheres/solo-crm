---
id: T-260902-17
title: Let a revenue line be marked invoiced or paid, so the chart has an actual to draw
status: open
category: data
plan_ref:
created: 2026-09-02
closed:
---

## Why

Every row in `revenue_lines` is `projected` — I queried the operator's
database and milestones back to January still say so. `status` has exactly one
writer in the plan, the Stripe adapter (P4-02), which is two phases away. Until
then the chart draws a dashed future over a dashed past and the distinction it
was built to make (T-260902-06) says nothing.

## Story

As the operator, I mark a month's revenue as invoiced or paid myself, because
I know it arrived, and the chart stops calling the last eight months a
forecast.

## Constraints

- **Do not infer actuals from the calendar.** A month being over is not
  evidence money came in; the operator rejected that reading. A line becomes
  actual only when someone says so.
- The generator owns `status = 'projected' AND kind IN (retainer, milestone,
  tm_estimate)` (`OWNED_LINES_SQL`). Marking a line actual takes it out of
  that set — which means regeneration will no longer reconcile it. That is the
  existing contract (the seed already relies on it); state it in the header
  rather than discovering it later.
- Set `invoiced_at` / `paid_at` alongside `status`, and allow the reverse —
  a line marked by mistake must be returnable to `projected`, back under the
  generator's ownership.
- P4-02 is still the real writer. Whatever this adds must not collide with a
  future Stripe pull: an operator-marked line and a Stripe-marked line need to
  be distinguishable, or the reconciliation rule needs writing down.
- ADR-003: no branching on `billing_model` outside the generator.

## Acceptance

- [ ] Marking a line paid, then regenerating the engagement, leaves it paid.
- [ ] Returning it to projected puts it back under the generator's control —
      the next regeneration reconciles it.
- [ ] `revenue:summary`'s series reports the marked month as `actual`.
- [ ] A test covers mark → regenerate → unmark → regenerate.
- [ ] `npm run test:unit` passes; `architecture-review` reads the change.

## Related

- `electron/main/db/repositories/revenue-generator.ts` (`OWNED_LINES_SQL`,
  `writeTmActual`), `electron/main/db/repositories/revenue.ts` (the series
  `CASE WHEN status IN ('invoiced','paid')`)
- `electron/shared/revenue.ts`, `electron/main/ipc/registry.ts`
- `.dev/decisions/ADR-003-materialised-revenue.md`
- `planning/solo-crm-taskplan.md` P4-02
