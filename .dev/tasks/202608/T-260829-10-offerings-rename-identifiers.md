---
id: T-260829-10
title: Rename the catalogue identifiers to offerings, before anything is built on them
status: in-progress
category: data
created: 2026-08-29
closed:
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

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
