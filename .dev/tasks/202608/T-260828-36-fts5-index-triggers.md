---
id: T-260828-36
title: Create the FTS5 search index and its triggers in their own migration
status: done
category: data
plan_ref: P1-06
created: 2026-08-28
closed: 2026-08-28
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


---

## Outcome

Merged as `879cd1c`, resolving one conflict by hand.

**Changed:** `migrations/0002_search_fts.sql` (new — the FTS5 table, the
`search_source` union view and AFTER INSERT/UPDATE/DELETE triggers on all five
source tables), `repositories/search.ts` and its test, plus version-expectation
updates in `migrate`, `connection`, `schema`, `registry` and `bridge` tests.

**Review:** blocking. All fixed before merge.

1. *(blocking)* `registry.test.ts` and `bridge.test.ts` hardcoded schema version
   1; migration 0002 makes a fresh database version 2. Both now derive it from
   `MIGRATIONS` so migration 0003 will not re-break them.
2. The content view was named `search_fts_content` — **exactly the shadow table
   FTS5 reserves for `search_fts`**. Proven: `DROP TABLE search_fts` then
   `CREATE VIRTUAL TABLE` fails with "view 'search_fts_content' already exists",
   and succeeds once renamed. Nothing broke today; it would have permanently
   foreclosed drop-and-recreate for every future migration. Renamed to
   `search_source` while the migration was still unshipped — afterwards it costs
   a migration against every existing database.
3. Mutation-proven: deleting `rebuildSearchIndex`'s `'delete-all'` left all 68
   tests green, because the suite only ever rebuilt an already-correct index
   where re-inserting identical rowids is a silent no-op. Recovery from drift is
   the function's entire purpose. Now covered by a planted-orphan test.
4. Mutation-proven: removing `ORDER BY rank` also left the suite green.
5. Four test files reached for migration 0001 as `MIGRATIONS[0]`; now
   `MIGRATIONS.find(m => m.version === 1)`, so inserting a migration at index 0
   cannot silently repoint the guards that keep 0001 and 0002 from colliding.

**Merge conflict:** `registry.test.ts`, against T-260828-26. Both sides were
right — T-26 added a `callChannel` helper that parses request *and* response
through the contract; T-36 derived the version constant. Resolved by taking
both, and dropping T-36's explicit `safeParse` since `callChannel` subsumes it.

**Deferred → T-260828-51:** the union view's `content_rowid` is a computed
expression, so no index can serve it. Measured at 10× volume: 95 / 488 / 581 ms
against §8's 100 ms budget, versus 13.8 / 124 / 41 ms self-contained. `"a"*` is
not pathological — it is what the palette issues after one keystroke.

**Deferred → T-260828-52:** no ADR for the union view or the `rowid * 8 + kind`
encoding, which is a cross-cutting contract any sixth searchable table must
honour.
