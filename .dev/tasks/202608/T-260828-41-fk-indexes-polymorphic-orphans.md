---
id: T-260828-41
title: Index the foreign-key columns and settle what happens to polymorphic rows on delete
status: done
category: data
plan_ref:
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge, with an ADR number collision resolved on top.

**Changed:** `0004_fk_indexes_polymorphic_cascade.sql` (new), `migrations/index.ts`,
`schema.ts`, `schema.test.ts`, `repositories/{errors,links,referential-guard}.ts`,
`polymorphic-cascade.test.ts` (new), `search.test.ts`,
`.dev/decisions/ADR-011-polymorphic-attachment-cascade.md` (new).

### The cascade is a trigger, not a call in the shared helper

The scope said to implement it in the shared refusal helper "so all six
repositories inherit it" — but that call would have had to live in
`repositories/{companies,engagements,people}.ts`, which T-260828-46 owned
concurrently. Migration 0004 installs
`trg_{companies,people,engagements}_attachments_ad` instead.

**This is better than merely available, and that is why it was accepted.** A
trigger runs inside the deleting statement's own transaction by construction, it
cannot be forgotten by a seventh repository, and it covers writers that are not
repositories at all — `seed/index.ts` and the P4 importers — which a TypeScript
helper never would.

`referential-guard.ts` holds the declaration (`POLYMORPHIC_ATTACHMENT_TABLES`,
`POLYMORPHIC_PARENT_ENTITY_TYPES`, `attachmentCascadeTriggerName`,
`countPolymorphicAttachments`) and a test asserts a trigger exists per
(parent, attachment) pair — so **a fourth attachment table fails a test rather
than going silently uncovered.**

### The create-side check T-260828-55 deferred here

`addLink` with an `entityId` no entity owns now throws `RefusalError` with
`blocker.reason: 'unknown-entity'`, where it previously succeeded. Enforced by
`trg_links_entity_exists_bi`/`_bu` and translated through the shared
`translateWriteError`. T-260828-55 documented that gap in `links.ts` and named
this task as its owner; both halves — refusing a link to a nonexistent entity,
and cascading links when the entity goes — now land in the same migration.

No existing test relied on the old behaviour. `taggings` and `external_refs`
deliberately get **no** equivalent trigger: no writer exists for either, and
guarding a repository nobody has written is a guess.

### A schema drift test that could only ever have passed once

`schema.test.ts` compared a from-scratch `drizzle-kit generate` against
`0001_init.sql`. `schema.ts` is cumulative and migrations are incremental, so
**that comparison could only hold while 0001 was the sole schema-derived
migration** — adding any index broke it by construction, not by drift.

It now seeds a temp folder with 0001's snapshot, regenerates, and asserts the
delta is exactly 0004's `CREATE INDEX` statements and nothing else; a table-level
drift shows up as a `CREATE`/`ALTER` and fails the indexes-only assertion. Two
gotchas are baked into comments there: drizzle-kit joins cwd with `--out`, so an
absolute temp path is read back as `<repoRoot>\C:\Users\…` and fails ENOENT, and
`migrations/meta/` is deliberately left at 0001 because 0002/0003/0004's trigger
halves declare nothing `schema.ts` knows about.

**Mutation-checked:** removing one `index()` from `schema.ts` makes the drift
test fail with `expected [ …(18) ] to deeply equal [ …(19) ]`; restored by
targeted edit, not `git checkout`.

### One pre-existing test fixed rather than weakened

`search.test.ts` asserted `SELECT name FROM sqlite_master WHERE type='trigger'`
returned exactly 15 rows — **a count of every trigger in the database**, which
the 5 new cascade triggers broke. Narrowed to `AND name LIKE 'trg%search%'`:
still exactly 15, still each named individually below it. The assertion got
*more* specific, not looser.

### Six indexes beyond the scope's list, none for symmetry

`milestones.engagement_id`, `revenue_lines.engagement_id` and
`time_entries.engagement_id` are `deleteEngagement` pre-checks the scope's list
omitted. The three composite `(entity_type, entity_id)` indexes are what the
cascade deletes by — **without them each cascade is a triple full scan.**

`0004` leaves pre-existing `links` rows whose `entity_type` is NULL or
unrecognised alone. The cascade compares `entity_type` against a literal per
parent, so such rows are never swept up by whichever delete happened to run last
— a migration that quietly deleted user data would be exactly the loss ADR-011 is
careful about, arriving by the back door.

**Verified at merge:** typecheck clean across all three passes, lint clean,
`node` + `runtime-boot-node` 30 files / 658 tests green on the merged tree.

## The second ADR collision in one run — and the gate that caught it

This branch created `ADR-010-polymorphic-attachment-cascade.md`. An hour
earlier, T-260828-46's `ADR-009` had been renumbered to **ADR-010** to resolve
the *first* collision of this run — so by the time this merged, 010 was taken by
a decision that did not exist when this branch was cut.

**The check added while closing T-260828-46 caught it immediately**, on a
collision it had no knowledge of, at the merge that caused it. That is the whole
argument for a gate over a reminder: the same mistake recurred within the hour,
made by a different agent, for a reason nobody could have avoided by being more
careful.

Renumbered to **ADR-011**, with all references moved across nine files. The
renumber was done by hand rather than by blanket replace: `people.ts` and
`people.test.ts` cite T-260828-46's ADR-010 and are correct as they stand, so a
repo-wide substitution would have silently repointed them at the cascade
decision.
