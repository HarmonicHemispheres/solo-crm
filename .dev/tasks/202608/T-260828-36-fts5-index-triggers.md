---
id: T-260828-36
title: Create the FTS5 search index and its triggers in their own migration
status: open
category: data
plan_ref: P1-06
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`search_fts` is one line in §5 with no sync mechanism, and G6 settled what it
has to be: an **external-content FTS5 table plus `AFTER INSERT/UPDATE/DELETE`
triggers on all five source tables**. Migration 0001 (T-260828-07) deliberately
creates neither — that omission was a decision, so the two tasks cannot both
issue the same `CREATE`. Without this, the command palette has nothing to search
and §6.9's whole capture-and-find loop is missing.

An external-content table is the choice that keeps the index from being a second
copy of the data that drifts. It is also the choice that makes triggers
mandatory rather than optional: get one `DELETE` trigger wrong and the index
accumulates orphan rows that surface as results pointing at records that no
longer exist.

## Scope

**In:** A new migration owning both halves:

- `search_fts` as an external-content FTS5 table over `companies.name`,
  `people.name`, `engagements.name`, `tasks.title` and `activity.body`, carrying
  enough to identify the source row and its kind.
- `AFTER INSERT`, `AFTER UPDATE` and `AFTER DELETE` triggers on each of the five
  source tables, following SQLite's documented external-content pattern
  (the delete-then-insert form on update, not a bare update).
- A `searchAll(query, opts)` repository function returning ranked results with a
  kind per row, in `electron/main/db/repositories/search.ts`.
- A **rebuild** command that drops and repopulates the index from source, for
  recovery and for the equivalence test below.
- The migration applies cleanly on a database already migrated by 0001, and on a
  database that already contains the seed fixture.

**Out:** The command palette UI (T-260828-37) and its IPC channel, which goes in
with that task. Search over links, milestones or the catalogue — the five tables
G6 names, no more. Fuzzy or typo-tolerant matching; FTS5 prefix queries are what
§6.9 asks for.

## Touches

- `electron/main/db/migrations/` — a new numbered migration and its registration
  in `index.ts`
- `electron/main/db/repositories/search.ts` — new
- `electron/main/db/repositories/search.test.ts` — new
- `electron/main/db/schema.ts` — possibly, if the table is declared there

## Acceptance

- [ ] The migration creates `search_fts` **and** its five triggers, and applies
      cleanly on a database migrated by 0001 — asserted by running it against
      one, not by inspection
- [ ] Renaming a company changes its search result with no rebuild step
- [ ] `INSERT … DELETE … INSERT` across all five tables leaves no orphan rows —
      verified by comparing the FTS row count to the summed source count
- [ ] The rebuild command produces an index **identical** to the incrementally
      maintained one, compared row for row over the same fixture
- [ ] Deleting a source row removes its index entry, so no result points at a
      record that no longer exists
- [ ] Migration 0001 still creates neither the table nor the triggers — a test
      asserts this, so the two migrations cannot collide
- [ ] A query matching nothing returns an empty list, not an error

## Risks

- **Both migrations creating the table.** 0001's omission is deliberate and
  documented in G6; a well-meaning "the schema should be complete" edit to 0001
  breaks every existing database on the next migrate.
- **The `AFTER UPDATE` trigger written as a bare update.** SQLite's
  external-content pattern requires delete-then-insert; the naive form leaves
  stale terms searchable, which reads as a caching bug months later.
- **`architecture-review` is a required gate here** (the plan escalates P1-06):
  this adds a second write path to five tables, and it is the kind of change
  that reaches further than its directory suggests.
- **Contentless vs external-content confusion.** A contentless table cannot be
  queried for its columns and would force a second copy; G6 chose
  external-content deliberately.
