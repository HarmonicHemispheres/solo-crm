---
id: T-260902-02
title: Build the milestones repository — the fixed-scope half of revenue has nowhere to come from without it
status: done
category: data
plan_ref: P3-04
created: 2026-09-02
closed: 2026-09-02
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

- [x] Create, update, complete/uncomplete, reorder, delete; list per
      engagement ordered by `sort`.
- [x] `sumMilestoneAmounts(engagementId)` is queryable and tested against
      three milestones that add to the contract value and three that do not.
- [x] Completing sets `completed_at`; uncompleting clears it; reordering
      touches only the rows named.
- [x] Exposed over IPC as a `milestones:*` namespace with request/response
      schemas, registered in `CHANNEL_CONTRACTS` and `preload`.
- [x] `npm test` green; open the app — nothing visible changes yet.

## Related

`electron/main/db/schema.ts` (`milestones`), `repositories/engagements.ts`
(the delete pre-check), `shared/engagements.ts`, `main/ipc/registry.ts`,
`planning/solo-crm-taskplan.md` P3-04 and G4.

---

## Outcome

**Changed:** new `shared/milestones.ts` (write schemas, the list/sum
request shapes, `milestoneSchema` re-exported) and
`repositories/milestones.ts` (+ test, 17 cases); seven `milestones:*`
channels plus `milestones:list` in `ipc-types.ts`, `registry.ts`,
`stub-crm.ts`; a `milestones` query-key entity and `invalidate.milestones`;
`Engagements.tsx` reads the renamed channel.

**Departed from scope:** Three things, two of them from review.
1. The brief's Why was wrong: a read (`listMilestones`, channel
   `engagements:milestones`) and a renderer consumer already existed. The
   build first kept that read beside a new write namespace; the
   architecture review showed that left every milestone mutation calling
   two invalidate helpers, with `invalidate.engagements` refetching every
   engagement list for a milestone edit. So the channel is renamed to
   `milestones:list`, `listMilestones` moved into `milestones.ts` (which
   now imports nothing from `engagements.ts`, so T-260902-03's generator
   cannot close an import cycle), and `queryKeys.engagements.milestones`
   is gone. Renderer and four test files changed for a `db/` task.
2. Every write runs in one transaction ending in `afterMilestoneWrite`, a
   no-op seam T-260902-03 fills with "regenerate this engagement" — one
   line there instead of six places.
3. Reorder requires the full set of the engagement's ids. The subset the
   first version allowed could not honour the requested position (a row
   set to `sort 0` beside an older `sort 0` still listed second), so it is
   refused as `incomplete-order`. The plan's "does not renumber unrelated
   rows" is read as other engagements' rows.
Also: `milestones:sum` is documented as a check on terms, not a revenue
figure — the first draft cited ADR-003 as if it were, which the review
caught as the exact misreading that would produce a backlog computed from
milestones.

**Not verified:** `architecture-review` and the correctness review both ran
on the tree before the reorder change; the reorder itself is covered by
three tests. No end-to-end IPC test drives a `milestones:*` write
(`registry.test.ts` calls `milestones:list` only); the repository tests
cover the writes and the contracts typecheck. `afterMilestoneWrite` being
reached inside each transaction is asserted by nothing — it does nothing
yet. The batched `security-review` over the new IPC surface is owed.

**Elapsed:** ~70 minutes.
