---
id: T-260828-20
title: Build the companies repository — CRUD, billing links, referential refusals
status: in-progress
category: data
plan_ref: P1-01
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`electron/main/db/` holds a connection, a migration runner, a schema and a seed
fixture — and nothing that reads or writes a row. Migration 0001 created
`companies` in T-260828-07 and the seed fixture writes to it directly with raw
Drizzle inserts, so the table is real but no code outside `seed/fixture.ts`
knows how to touch it. Every task downstream of this one — the IPC channels, the
companies view, company detail, the create sheets, the palette — needs a
companies repository to exist before it can be built, which is why the plan
names P1-01 first in the P1-CUT subset. This is the first task in the project
that makes the database do work.

## Scope

**In:** A new `electron/main/db/repositories/companies.ts` exporting typed
functions over the `companies` table as `schema.ts` declares it:

- `listCompanies`, `getCompany(id)`, `createCompany(input)`,
  `updateCompany(id, patch)`, `deleteCompany(id)`.
- Every column round-trips: `kind`, `website`, `bills_directly`,
  `billed_via_company_id`, `introduced_by_company_id`, `cadence_days`,
  `budget_note`, `notes`, `since`.
- UUID `id` and `created_at` / `updated_at` are set by the repository, never by
  a caller — the convention AGENTS.md makes universal and ADR-002 exempts only
  `settings` and `favicons` from. `updated_at` moves on every update.
- Zod input schemas for create and update, built from `electron/shared/types.ts`
  primitives (`dateOnlySchema` for `since`, not a bare string) per CONVENTIONS.md.
- Referential refusals that return a **reason**, not a raw SQLite error: deleting
  a company that is another company's `billed_via_company_id` or
  `introduced_by_company_id`, or that has `activity` rows, is refused with a
  message naming what blocks it and how many rows. Migration 0001 gave
  `activity`'s back-links RESTRICT foreign keys deliberately (G8, ADR-001) —
  this repository turns that constraint into a sentence.
- A repository-level error type the IPC layer can map to its envelope, so
  T-260828-26 does not have to string-match.

**Out:** IPC channels (T-260828-26 owns the whole registry, one task by design).
Any renderer code. The people, engagements, tasks and activity repositories —
each is its own task. Decay/cadence computation (P2-03). Links (P1-18).

## Touches

- `electron/main/db/repositories/companies.ts` — new
- `electron/main/db/repositories/companies.test.ts` — new
- `electron/main/db/repositories/errors.ts` — new, the shared refusal type
- Possibly `electron/main/db/schema.ts` — read only; no DDL change is expected

## Acceptance

- [ ] A company created with all fourteen writable columns set, then read back
      by `getCompany`, is equal field-for-field to what went in
- [ ] `createCompany` assigns a UUID `id` and equal `created_at`/`updated_at`;
      a subsequent `updateCompany` moves `updated_at` and leaves `created_at`
- [ ] Setting `billed_via_company_id` to the row's own `id` is rejected by the
      database `CHECK` (`companies_billed_via_company_not_self`), and the
      repository surfaces it as a refusal, not an unhandled throw
- [ ] `deleteCompany` on a company that is another's billing party returns a
      refusal naming the blocking company, and the row is still present
      afterwards
- [ ] `deleteCompany` on a company with activity rows is refused with a reason
      that names the activity count; no activity row is deleted or orphaned
- [ ] `since` rejects `'2026-8-1'` and accepts `'2026-08-01'` — the
      `dateOnlySchema` boundary, not a hand-rolled check
- [ ] Tests run against a real migrated in-memory/temp database, not a mock

## Risks

- **Deleting through the FK instead of refusing before it.** The tempting
  implementation catches `SQLITE_CONSTRAINT` and rephrases it. That produces a
  correct-looking message for the case that fires and a raw error string for the
  case that does not. Check first, in the same transaction as the delete.
- **Reintroducing a parent/child company link.** `billed_via_company_id` is a
  billing pointer, not a hierarchy — §5's modelling note. A convenience helper
  like `getSubsidiaries()` would quietly make it one.
- **`bills_directly` defaults to `true` in the schema.** An update patch that
  omits the field must not reset it; distinguish "absent" from "explicitly false".
