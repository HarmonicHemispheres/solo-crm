---
id: T-260829-10
title: Rename the catalogue identifiers to offerings, before anything is built on them
status: done
category: data
created: 2026-08-29
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

[T-260829-09](T-260829-09-offerings-rename-visible.md) renames what the operator
reads. This renames what the code says, so the two do not drift: the `/services`
route, the `services` nav id, `CatalogueIcon`, and the three tables `services` /
`service_versions` / `service_categories`.

**The argument for doing it now is entirely about timing.** No repository reads
these tables — P3-01 (catalogue repositories) and P3-07 (catalogue view) are
unbuilt, and the route renders a `ViewPlaceholder`. The tables are written by
exactly one thing, the dev seed. After P3-01 and P3-07 land, the same rename
costs a repository, a view, IPC channels and a set of shared zod schemas. Today
it costs one migration and about fifteen mechanical sites, all of which the type
checker finds for you.

**This is the cuttable one.** If the answer is that renaming things nobody sees
is not worth a migration, cutting it is coherent — the cost of cutting is that
the app says Offerings and the code says services, permanently.

## Scope

**In:**

- A migration renaming the three tables and the columns that name them:
  `services` to `offerings`, `service_categories` to `offering_categories`,
  `service_versions` to `offering_versions`, then
  `offering_versions.service_id` to `offering_id` and
  `engagements.service_version_id` to `offering_version_id`.
  `offerings.category_id` keeps its name — it is already generic.

  SQLite's `ALTER TABLE ... RENAME TO` rewrites foreign-key references in other
  tables' schemas as long as `legacy_alter_table` is off, which is the default.
  **Verify that rather than assuming it** — after migrating, `PRAGMA
  foreign_key_check` must come back empty and the `engagements` DDL must name
  `offering_versions`.

  **Migration number:** [T-260829-04](T-260829-04-branding-store.md) also claims
  `0005`. Whichever merges second takes the next free number; do not both write
  a `0005_` and discover it at the merge.

- The Drizzle mirrors in `electron/main/db/schema.ts:149-185` and `:204` —
  `serviceCategories` to `offeringCategories`, `services` to `offerings`,
  `serviceVersions` to `offeringVersions`, `engagements.serviceVersionId` to
  `offeringVersionId`.

- The engagements surface that carries the column, all mechanical and all
  typechecked: `electron/shared/engagements.ts:46,120,132,144`,
  `electron/main/db/repositories/engagements.ts:143,170,202,219,242`,
  `electron/renderer/lib/test-support/stub-crm.ts:182`. The error message at
  `engagements.ts:202` names "service version" in prose the operator can read —
  rename that too.

- The seed: `electron/main/db/seed/fixture.ts`, `seed/index.ts:299-343,447,462`
  and `seed/index.test.ts`.

- The renderer identifiers: route path `/services` to `/offerings`
  (`routes.tsx:40`), nav id `services` to `offerings` (`nav.ts:47,77`,
  `Rail.tsx:44`), and `CatalogueIcon` to `OfferingsIcon`
  (`components/shell/icons.tsx:80`, `Rail.tsx:6,23`). The glyph itself does not
  change.

- `planning/solo-crm-requirements.md`'s schema block and
  `planning/solo-crm-taskplan.md` where they spell the table names, so the
  documents still describe the database that exists.

**Out:** the user-visible labels — T-260829-09 owns those and lands first. Any
change to what the columns mean, to `agreed_rate_cents` being a snapshot, or to
anything [ADR-003](../../decisions/ADR-003-materialised-revenue.md) decided; this
renames and nothing else. Building the offerings repositories or view — still
P3-01 and P3-07, which inherit the new names.

## Touches

- `electron/main/db/migrations/000N_offerings_rename.sql` (new) + the meta journal
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/engagements.ts` + its tests
- `electron/shared/engagements.ts`
- `electron/main/db/seed/fixture.ts`, `seed/index.ts`, `seed/index.test.ts`
- `electron/renderer/nav.ts`, `routes.tsx`, `components/shell/Rail.tsx`,
  `components/shell/icons.tsx`
- `electron/renderer/lib/test-support/stub-crm.ts`
- `planning/solo-crm-requirements.md`, `planning/solo-crm-taskplan.md`

## Acceptance

- [ ] `npm run verify` passes.
- [ ] Migrating a database that already holds seeded rows preserves every row and
      every relationship: the counts in `offerings`, `offering_versions` and
      `offering_categories` after the migration equal the counts in the old tables
      before it, and every engagement's `offering_version_id` still resolves to a
      row. Asserted in a test over a pre-migration fixture, not by inspection.
- [ ] `PRAGMA foreign_key_check` returns no rows after the migration, and the
      `engagements` DDL contains `offering_versions`, not `service_versions`.
- [ ] `grep -rniE "service_version|serviceVersion|service_categor|serviceCategor" electron/`
      returns nothing outside `0001_init.sql`, which is history and is never
      edited.
- [ ] `grep -rn "'/services'\|CatalogueIcon" electron/` returns nothing.
- [ ] The rail's Offerings item navigates to `/offerings` and its placeholder
      renders; no route in the app still points at `/services`.
- [ ] The seed loads cleanly into a fresh database and into a migrated one.
- [ ] `architecture-review` runs on this diff — category `data` makes it the
      gate. Its judgement on whether a rename migration is the right instrument
      is recorded in the outcome either way.

## Risks

- **A rename migration looks free and is not.** The failure is silent: a table
  renamed while a foreign-key reference is not leaves a database that opens,
  reads, and only fails when something walks the relationship. The
  `foreign_key_check` criterion is the gate, and it has to run against a
  *migrated database with data*, not a fresh one where there is nothing to
  orphan.
- `0001_init.sql` is history and must not be edited to use the new names. Editing
  it makes an existing database's applied-migration record disagree with what the
  file says was applied.
- The migration number collides with T-260829-04's `0005`. Two files claiming the
  same number do not conflict textually in git — the filenames differ — so it
  surfaces as a runtime ordering surprise rather than a merge conflict. Whoever
  merges second renumbers.
- AGENTS.md's search-index gotcha looks like it applies and does not: the
  catalogue is deliberately absent from `SEARCH_KINDS` and from the
  `search_source` union (`nav.ts:111`), so no kind code moves and no index
  rebuild is needed. Confirm that by reading `search_source` rather than trusting
  this paragraph — a rebuild is the one thing that would make this expensive.
- `engagements` is a live table with a built repository, so this reaches further
  than "three unused catalogue tables" suggests. That is the honest cost, and it
  is the reason to do it before P3-01 rather than a reason not to.

---

## Outcome

**Changed:**

- `electron/main/db/migrations/0006_offerings_rename.sql` (new) — five `ALTER TABLE … RENAME` statements, registered in `migrations/index.ts` as version 6.
- `electron/main/db/migrations/0006_offerings_rename.test.ts` (new) — 7 tests over a **seeded pre-migration** database.
- `electron/main/db/schema.ts` — `offeringCategories` / `offerings` / `offeringVersions` / `engagements.offeringVersionId`; `category_id` keeps its name.
- `electron/main/db/schema.test.ts` — the drift check's base moved; `MIGRATION_0001_TABLES` split from `EXPECTED_TABLES`.
- `electron/main/db/repositories/engagements.ts` and its tests, `electron/shared/engagements.ts` — the column and the operator-readable "offering version" prose.
- `electron/main/db/seed/fixture.ts`, `seed/index.ts`, `seed/index.test.ts` — the seed. `type: 'service'` left alone: a data *value*, not an identifier.
- `electron/renderer/nav.ts`, `routes.tsx` (`/offerings`), `icons.tsx` (`OfferingsIcon`, glyph unchanged), `Rail.tsx` (lines 6, 23, 29, 44 only), `stub-crm.ts` and six renderer tests.
- `polymorphic-cascade.test.ts`, `stats.test.ts` — two collateral fixes, below.
- `planning/solo-crm-requirements.md`, `solo-crm-taskplan.md`.

Untouched, deliberately: `0001_init.sql`, `meta/_journal.json`, `meta/0001_snapshot.json`.

**The dangerous part was checked, and the documentation was inverted.** SQLite's
docs read as though `REFERENCES` rewriting depends on `PRAGMA foreign_keys` —
and `migrate.ts` runs every migration with foreign keys **off**. The builder
probed it directly before writing the migration: the rewrite is governed by
`legacy_alter_table`, not `foreign_keys`, and happens in both states. That probe
is why 0006 is a plain rename rather than a table rebuild — a rebuild would have
dropped `engagements`' search triggers and 0004's indexes along with it.

Against a database migrated 0001–0005, seeded, then migrated to 0006:
`PRAGMA foreign_key_check` returns `[]`; the `engagements` DDL names
`FOREIGN KEY ("offering_version_id") REFERENCES "offering_versions"`; row counts
match on all four tables; the engagement resolves to its version. The test also
asserts a bad write is still **rejected** after the migration — enforcement, not
just shape — that a re-run is a no-op, and that the seed loads into a migrated
database as well as a fresh one.

**`search_source` was read, not trusted.** `0003_search_content_table.sql:54`
unions companies · people · engagements · tasks · activity. The catalogue is
absent, so no kind code moves and no index rebuild is needed — the scope's
paragraph is correct. `engagements` is in the union but projects only `id` and
`name`, neither renamed; `search_source_live`'s DDL is byte-identical after
migrating.

**Review:** no blocking findings.

*The drift assertion was widened by moving its base, not by loosening it — and
this was the thing to get right.* The scope's plan (assert the delta's tables
also equal 0006's) **cannot work**: drizzle-kit sees three tables gone and three
arrived and opens an interactive "created or renamed?" prompt, which without a
TTY aborts and emits no migration at all. There is no flag to answer it. So the
base became 0001's snapshot with 0006's renames applied — the state after 0001
and 0006, before 0004 and 0005 — leaving the delta once again exactly 0004's
indexes and 0005's table, with **every assertion unchanged**. The renames are
parsed out of the registered migrations' own SQL rather than restated, so the
base cannot drift from what the runtime applies.

It still fails closed in every direction, proved three times: the builder added a
column to `offerings` (red) and renamed `tags` → `labels` in `schema.ts` with no
migration (red, via the prompt path); independently at merge, with 04's widening
and 10's base-shift now combined, adding `driftProbe: text('drift_probe')` gave
`AssertionError: expected 'ALTER TABLE \`offerings\` ADD \`drift_pr…' to be ''`.
Reverted with a targeted edit. The second failure mode used to be cryptic, so the
assertion now explains the created-or-renamed case and echoes drizzle's output.

*Two collateral test fixes, neither a weakening.* `polymorphic-cascade.test.ts`
seeded a database stopped at 0003, which stopped being possible once the seed
writes today's names — its base is now every migration except 0004, the one under
test, which is the same precondition stated in a way the next rename will not
break. `stats.test.ts` inserted a flat 5 companies to be the largest table and a
sixth migration made `schema_migrations` overtake it; it is now
`MIGRATIONS.length + 5`.

*`architecture-review` ran, as category `data` requires. Verdict: the rename
migration is the right instrument.* It spends nothing the project bought — the
IPC boundary is unchanged (a field name inside existing zod schemas, both sides
shipping together), revenue untouched, integrations untouched, the renamed tables
keep their UUID keys and timestamps, and a rename moves no rows. No ADR:
"hand-write the migration when drizzle-kit cannot express the change" is the
precedent 0002/0003/0004 already set. **One finding, fixed in the same branch** —
`applyRenames` substitutes over the snapshot's raw text, which is what repairs
drizzle's compound FK names in one pass but means a future rename whose *source*
is a common token (`name`, `type`) would rewrite more than it should. It fails
closed rather than open, but unreadably, so the derived base's table set is now
asserted against `EXPECTED_TABLES` at the point of transformation.

`typecheck`, `lint`, both project groups (39 files / 792 tests and 59 files / 511
tests) passed on the branch. On the merged tree: node projects 40 files / 820
tests, renderer 51 files / 426 tests, and the merge itself auto-resolved
`Rail.tsx` (06's brand block vs 10's icon rename) and `stub-crm.ts` (05's
branding channels vs 10's column rename) with both branches' content intact —
verified by grep, not by trusting the merge.

**Deferred:**

- **The acceptance grep does not come back empty, and should not.** Five matches
  remain, all *about* the old names rather than uses of them: `0001_init.sql`
  (explicitly exempted); `meta/0001_snapshot.json`, the other half of that same
  history — editing it would make 0001's snapshot disagree with the SQL it
  describes, and the drift test reads it as the base; `0006_offerings_rename.sql`,
  which must name what it renames; its test, whose pre-migration fixture must
  write the old names; and `MIGRATION_0001_TABLES` plus a comment in
  `schema.test.ts`. Excluding exactly those five the grep is empty. The criterion
  named only the `.sql` file and should have named the snapshot beside it.
- **`meta/` now describes a schema no live database has**, and the project's
  current schema exists only as a derivation inside `schema.test.ts`. Inherent to
  leaving 0001 as history; the only consumer is that test, and no npm script runs
  `drizzle-kit generate`. Filed as
  [T-260829-12](T-260829-12-post-rename-drizzle-snapshot.md).
