---
id: T-260828-41
title: Index the foreign-key columns and settle what happens to polymorphic rows on delete
status: in-progress
category: data
plan_ref:
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Two structural gaps found by review on T-260828-20, both deferred because they
belong to the schema rather than to one repository, and both of which every
later repository inherits.

**No foreign-key column is indexed.** Migration 0001 creates three indexes, none
on an FK. Every repository's delete pre-check therefore issues
`SELECT COUNT(*) FROM <child> WHERE <fk> = ?` against an unindexed column — and
one of those children is `activity`, the fastest-growing table in the app.
Negligible for a single rare delete; the shape is repeated by six repositories
and is exactly what X-07's 10× volume harness would catch late.

**Three tables are orphaned silently on delete.** `links`, `taggings` and
`external_refs` are polymorphic (`entity_type` / `entity_id`, migration 0001)
with no foreign key to `companies`, so neither the repository's pre-checks nor
SQLite stops a delete from stranding their rows. `seed/index.ts` already writes
`links` rows with `entity_type = 'company'`, so seeded databases carry them
today. Unlike the FK gap there is no safety net at all here — not even a raw
error.

## Scope

**In:**

- A migration adding indexes on the foreign-key columns the repositories'
  delete pre-checks and list filters actually query — at minimum
  `activity.company_id`, `activity.person_id`, `activity.engagement_id`,
  `engagements.billing_company_id`, `engagements.client_company_id`,
  `tasks.company_id`, `tasks.engagement_id`, `tasks.person_id`,
  `affiliations.company_id`, `affiliations.person_id`,
  `time_entries.company_id`, `companies.billed_via_company_id`,
  `companies.introduced_by_company_id`.
- A decision, recorded, on what a delete does to polymorphic rows: cascade them
  in the same transaction, or refuse the delete while they exist. Then implement
  whichever, in the shared refusal helper so all six repositories inherit it
  rather than each remembering.
- Extend the shared delete helper (added by T-260828-20's fix pass) to cover the
  polymorphic tables by `entity_type` + `entity_id`, so a repository declares
  them the same way it declares real foreign keys.

**Out:** Any change to the polymorphic design itself — `entity_type`/`entity_id`
is deliberate (a link attaches to a company, a person or an engagement, so no
single-table FK is possible). New indexes on non-FK columns; measure first.

## Touches

- `electron/main/db/migrations/` — a new numbered migration
- `electron/main/db/repositories/errors.ts` and the shared delete helper
- `electron/main/db/schema.ts` — index declarations
- Repository tests covering the orphan case

## Acceptance

- [ ] Every FK column named above has an index, and the migration applies
      cleanly to a fresh database **and** to a copy of a seeded one
- [ ] Deleting a company that has `links` rows either removes them in the same
      transaction or refuses with a reason — whichever the recorded decision
      says, asserted either way
- [ ] After any successful entity delete, no row in `links`, `taggings` or
      `external_refs` references the deleted id — asserted by query, over a
      seeded database
- [ ] The polymorphic tables are declared through the same helper as real FKs;
      a repository does not hand-roll the check
- [ ] `EXPLAIN QUERY PLAN` on a delete pre-check shows an index search rather
      than a full scan

## Risks

- **Indexing everything.** Each index costs write throughput on the tables the
  Gmail and timelog importers will hammer hardest. Index what the repositories
  query, not every FK for symmetry.
- **Choosing cascade without recording why.** Silently deleting a user's links
  because a company was removed is a data-loss decision; it needs to be a
  decision, not a default.
- **The migration must not touch `search_fts`** — T-260828-36 owns that table
  and its triggers, and the two migrations must not collide.
