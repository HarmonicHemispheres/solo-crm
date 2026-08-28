---
id: T-260828-22
title: Build the engagements repository — split billing, model-specific fields, six statuses
status: in-progress
category: data
plan_ref: P1-03
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Engagements are what the CRM is for — the row that carries a rate, a term and a
billing model, and the row every revenue question in Phase 3 reads through.
Nothing can create one today. Three schema decisions live or die in this file:
billing party and delivery client as independent columns (§5), `ends_on` NULL
meaning *rolling* rather than a sentinel date, and `agreed_rate_cents` as a
snapshot taken at signature and never re-read from the catalogue price list. A
repository that quietly coalesces `client_company_id` to `billing_company_id`,
or defaults `ends_on`, satisfies an ordinary read of the table and undoes all
three.

## Scope

**In:** `electron/main/db/repositories/engagements.ts`:

- `listEngagements` (filterable by status, by billing company, by client
  company), `getEngagement(id)`, `createEngagement`, `updateEngagement`,
  `deleteEngagement`.
- `billing_company_id` and `client_company_id` written and read independently.
  A query from either side returns the engagement.
- `status` accepts all six — `active | pending | proposed | held | delivered |
  lost`. `lost` is in the schema by G3; the form gains it in T-260828-27.
- `billing_model` accepts `retainer | fixed | tm | equity | none`, and the
  create/update schema is a **discriminated union on the model**: a retainer
  carries `hours_included`; `fixed` carries `contract_value_cents`; `tm` carries
  `hourly_rate_cents`, `estimated_hours`, `not_to_exceed_cents`. A retainer
  arriving with `contract_value_cents` is rejected, not silently stored.
- `agreed_rate_cents` is writable on create and **ignored on update** unless an
  explicit re-rate function is called, so the snapshot cannot drift by accident.
- `ends_on: null` round-trips as null. No default, no coalesce, anywhere.
- `listMilestones(engagementId)` so a fixed-scope detail view has something to
  render. Milestone *editing* stays P3-09.
- Deletion refusals in the shared shape: an engagement with activity rows, time
  entries or revenue lines is refused with a reason.

**Out:** IPC channels (T-260828-26). Revenue line generation — ADR-003 puts that
in P3-05, and **branching on `billing_model` to produce a revenue figure
anywhere outside that generator is the defect** — so this repository computes no
money beyond returning stored columns. The milestone editor (P3-09). Hours
rollups, which need `time_entries` and the timelog import (P4-05).

## Touches

- `electron/main/db/repositories/engagements.ts` — new
- `electron/main/db/repositories/engagements.test.ts` — new
- `electron/main/db/repositories/errors.ts` — shared

## Acceptance

- [ ] An engagement with `billing_company_id` ≠ `client_company_id` persists both
      and is returned by a query from either side — the seed fixture's Samay
      build (billed EZDeploy, delivered W+K) is the test case
- [ ] `ends_on: null` survives create → read → update → read with no sentinel
      substituted, asserted on the raw column value
- [ ] `createEngagement({ billing_model: 'retainer', contract_value_cents: … })`
      is rejected by the input schema with a message naming the offending field
- [ ] All six statuses, `lost` included, round-trip
- [ ] `updateEngagement` cannot change `agreed_rate_cents` — a test asserts the
      stored value is unchanged after an update that includes it
- [ ] Money is integer cents end to end via `centsSchema`, never a float
      (CONVENTIONS.md)
- [ ] No function in this file returns a summed, projected or per-month figure —
      asserted by review, and by the absence of any `SUM` in the file

## Risks

- **ADR-003 is the decision most likely to fail here.** A helper like
  `monthlyValue(engagement)` reads as obviously useful and is exactly the
  per-model branching AGENTS.md names as the highest-risk carry-over in the
  project. `architecture-review` flags it; do not write it.
- **The discriminated union widening into one flat optional schema.** That
  typechecks and rejects nothing. It has to be a real union.
- **`started_on` is `notNull` in the schema** — the create schema must require
  it rather than defaulting to today, or every engagement silently starts on its
  creation date.
- **`equity` and `none` carry no model-specific columns.** They need explicit
  union members, or the union rejects them along with the bad input.
