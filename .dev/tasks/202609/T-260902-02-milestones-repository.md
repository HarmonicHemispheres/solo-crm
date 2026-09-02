---
id: T-260902-02
title: Build the milestones repository — the fixed-scope half of revenue has nowhere to come from without it
status: open
category: data
plan_ref: P3-04
created: 2026-09-02
closed:
---

## Why

A fixed-scope engagement recognises revenue one row per milestone at its
`expected_month` (ADR-003). The `milestones` table exists (migration 0001)
and `deleteEngagement` already checks it, but nothing reads or writes it:
`Engagements.tsx` renders `milestones` as `[]` for every engagement. Until
this lands, the generator (T-260902-03) can only produce retainer and T&M
rows, and every fixed-scope engagement contributes zero.

## Story

As the operator, an engagement I sold as a fixed scope carries its
milestones — name, amount, expected month, done or not — and the sum of
their amounts is the contract value.

## Constraints

- CONVENTIONS.md: `amount_cents` integer, `expected_month` first-of-month
  (`periodMonthSchema`), `completed_at` a timestamp or null.
- ADR-007: domain types and zod schemas in `electron/shared/milestones.ts`;
  SQL and row mapping in `electron/main/db/repositories/milestones.ts`.
- `architecture-review` gate (a `db/` task).

## Acceptance

- [ ] Create, update, complete/uncomplete, reorder, delete; list per
      engagement ordered by `sort`.
- [ ] `sumMilestoneAmounts(engagementId)` is queryable and tested against
      three milestones that add to the contract value and three that do not.
- [ ] Completing sets `completed_at`; uncompleting clears it; reordering
      touches only the rows named.
- [ ] Exposed over IPC as a `milestones:*` namespace with request/response
      schemas, registered in `CHANNEL_CONTRACTS` and `preload`.
- [ ] `npm test` green; open the app — nothing visible changes yet.

## Related

`electron/main/db/schema.ts` (`milestones`), `repositories/engagements.ts`
(the delete pre-check), `shared/engagements.ts`, `main/ipc/registry.ts`,
`planning/solo-crm-taskplan.md` P3-04 and G4.
