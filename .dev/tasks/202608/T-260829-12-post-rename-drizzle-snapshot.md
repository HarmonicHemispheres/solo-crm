---
id: T-260829-12
title: Rename the drift test's base structurally, not by substituting over raw JSON
status: done
category: data
created: 2026-08-29
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

From the review of [T-260829-10](T-260829-10-offerings-rename-identifiers.md).

`schema.test.ts` proves `schema.ts` and the checked-in migrations cannot drift.
It seeds a temp folder with 0001's snapshot, runs `drizzle-kit generate` against
`schema.ts`, and asserts the delta is **exactly** 0004's indexes and 0005's
table — comparing against those migrations' own SQL. That comparison is the
whole value: it ties `schema.ts` to the hand-written SQL the runtime actually
applies.

0006 renames three tables and two columns, and drizzle-kit cannot infer a
rename — it opens an interactive "created or renamed?" prompt that aborts
without a TTY. So T-260829-10 moved the *base*: it reads the renames out of the
registered migrations' SQL and applies them to 0001's snapshot, producing the
state after 0001 and 0006 and leaving the delta exactly as before. Every
assertion survived. That was the right call.

The residual risk is narrow and specific. `applyRenames` substitutes over the
snapshot's **raw text**. That is what lets a single pass also repair drizzle's
compound foreign-key names (`engagements_service_version_id_service_versions_id_fk`)
at the same time as the table keys — but it means a future rename whose *source*
is a token that appears elsewhere would rewrite more than it should. A column
renamed from `name` or `type` is the realistic case: every table in a drizzle
snapshot has a `"name"` key. It fails closed — an over-substituted base stops
matching 0004 and 0005 and the test goes red — but it goes red somewhere
unreadable, and the next person to rename a column is the one who pays.

**This task originally proposed checking in a real post-rename snapshot from
`drizzle-kit generate`, run interactively. That was wrong and is why this scope
was rewritten.** Verified rather than assumed: generating against `schema.ts`
writes a snapshot of the **full current schema** — 19 tables including
`branding`, and all 22 of 0004's indexes. It is not the mid-history base the
test needs. Adopting it would make the delta empty and force deleting the
comparison against 0004's and 0005's SQL, which is the assertion that gives the
test its meaning. The prompt was never the obstacle; the artifact is the wrong
shape.

## Scope

**In:**

- Replace `applyRenames`'s string substitution with a **structural** rename over
  the parsed snapshot. Walk the object and rename only the places an identifier
  can legitimately appear:
  - the `tables` map's keys, and each table's own `name` field;
  - within a renamed or affected table, the `columns` map's keys and each
    column's `name` field;
  - foreign-key entries — `tableFrom` / `tableTo`, the column name arrays, and
    the compound FK **key and its `name`**, which embed table and column names
    and are the reason the textual version existed;
  - index entries whose name or column list embeds a renamed identifier;
  - anything else a rename must reach. **Find these by reading
    `meta/0001_snapshot.json`, not from this list** — treat this list as a
    starting point that may be incomplete, and say in the outcome what you found
    that it missed.
- A **whole-identifier** match everywhere: `service_id` must not match inside
  `service_version_id`. The current longest-first ordering exists to paper over
  exactly this and should not be needed once matching is structural.
- Keep `renamesInMigrations` — reading the renames out of the migrations' own
  SQL rather than restating them is what stops the base drifting from what the
  runtime applies. Only the *application* of those renames changes.
- Keep every existing assertion, including the `EXPECTED_TABLES` guard at the
  point of transformation. That guard was added because the textual version
  could corrupt the base; a structural version should make it redundant, but it
  costs nothing and it fails loudly. **Do not remove it.**
- A test for `applyRenames` itself, which it has never had. The case that
  matters: a rename whose source is a common token. Feed it a snapshot fragment
  with a table named `name`, or a column renamed from `name`, and assert only
  the intended identifier moved. This is the defect the task exists to prevent,
  so it is a test rather than a comment.

**Out:** checking in any new snapshot, and any change to `meta/` — see Why.
Editing `0001_init.sql` or `meta/0001_snapshot.json`; both are history. Changing
what the drift test asserts. Adding an npm script that runs `drizzle-kit
generate` — the runtime applies checked-in SQL and the generator stays a
development tool. Any schema change at all.

## Touches

- `electron/main/db/schema.test.ts`, and wherever `applyRenames` ends up if it
  needs to move to be testable on its own.

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `applyRenames` has direct tests, including a rename whose source token
      appears elsewhere in the snapshot, asserting only the intended identifier
      moved.
- [ ] The drift test still fails on a column added to `schema.ts` with no
      migration. **Performed, not reasoned about** — name the column and paste
      the failure.
- [ ] The drift test still fails on a table renamed in `schema.ts` with no
      matching migration, and still explains the created-or-renamed case rather
      than reporting an empty generation.
- [ ] The delta is still compared against `0004_fk_indexes_polymorphic_cascade.sql`
      and `0005_branding.sql` by their own SQL — `git diff` shows those
      assertions unchanged.
- [ ] `PRAGMA foreign_key_check` on a fully migrated seeded database is still
      empty, proving the structural rename did not silently change what the base
      claims about foreign keys.

## Risks

- **The failure this prevents is one nobody will hit until they rename a
  column**, which makes it easy to under-test. The direct `applyRenames` test is
  the deliverable; the rest is refactoring around it.
- Structural walking can *miss* a place the textual version happened to cover —
  the compound FK names are the known one, and there may be others in a drizzle
  snapshot's shape. Missing one is not silent: the base stops matching 0004 and
  0005 and the test goes red. Read the snapshot rather than trusting the list in
  Scope.
- This is a test-only change with no user-visible effect, on the one test that
  stands between `schema.ts` and the migrations diverging. Weakening it while
  tidying it would remove the guard this project most depends on and look like
  cleanup in the diff.

---

## Outcome

**Changed:**

- `electron/main/db/test-support/snapshot-renames.ts` (new) — `renamesInMigrations`, `applyRenames` and `renamedTableName`, moved out of `schema.test.ts` so they can be tested without a `drizzle-kit` child process. The rename is now a walk over the parsed snapshot; `from` is compared with `===` against one field at a time.
- `electron/main/db/test-support/snapshot-renames.test.ts` (new) — 23 direct tests, in the fast `node` pool.
- `electron/main/db/schema.test.ts` — imports the three functions, keeps every assertion, and gained `withoutStackFrames` (see below).

**What the scope's list of places a rename must reach was missing.** Read out of `meta/0001_snapshot.json` rather than taken on trust, as the scope asked. It named the tables map, table `name`, columns, foreign keys and indexes. Also present and also reachable by a rename: **`uniqueConstraints`** and **`compositePrimaryKeys`** (both carry a `columns` array — `taggings_tag_entity_unique` is the live example), and **`checkConstraints`**, which store SQL text rather than structure (`companies_billed_via_company_not_self` holds `("companies"."billed_via_company_id" IS NULL OR …)`). Check constraints are the one place a rename still has to touch text; only the double-quoted form is rewritten, and an *unquoted* whole-word occurrence throws rather than being guessed at.

Two things deliberately **not** renamed, which the textual version would have rewritten had they ever contained a renamed token: index/unique/check constraint **names**, which are literals written in `schema.ts` and which SQLite's `ALTER TABLE … RENAME` does not touch either; and a foreign key whose stored name is not drizzle's derived one, which was named by hand. Foreign key names that *are* conventional are **recomputed** from the parts rather than substituted — which is what the textual pass was really doing when it rewrote `engagements_service_version_id_service_versions_id_fk`.

`renamesInMigrations` now returns statement order and tags each rename with its kind, and a column rename carries the table it belongs to. Both were forced by the structure: 0006 renames `service_versions` and then renames a column of the **new** name, so grouping by kind looks up a table that does not exist yet.

**Proved equivalent before being trusted.** A throwaway test applied both the old textual implementation and the new structural one to the real 0001 snapshot and compared the results — identical, to the byte, `JSON.stringify` included. Mutating it (passing an empty rename list to one side) turned it red, so it was a real comparison. Deleted after running; it would have required keeping the old implementation forever.

**Review:** no blocking findings. Eight mutants, all caught — **two of them caught nothing on the first pass and are the reason this task delivered two tests it would otherwise have missed**:

- Changing the column-list `swap` from `===` to `.includes` passed all 19 tests. Nothing exercised the whole-identifier property on a *column list*, which is half of what the task exists to guarantee. Added a column `service_id_note` alongside `service_id`, in an index over both.
- Changing `renamedTableName` to substring matching also passed. The real rename set does not distinguish the two — `service_versions` does not contain `services`. Added `service_versions_archive` and `legacy_services`.

The other six: prefix-matching in `withRenamedKey` (5 red), dropping the conventional-FK-name recompute (3), a table rename no longer following `fk.tableTo` (3), dropping `renamedTableName`'s kind guard (1), accepting unquoted identifiers in a check constraint (1), and reversing statement order (the file fails to collect — loud, if not pretty).

**One defect found and fixed while performing the acceptance criteria.** The criterion that the drift test "still explains the created-or-renamed case" turned out to be false, and had been since T-260829-10. Renaming a table in `schema.ts` with no migration does fail the test — but the failure was **never printed**. drizzle-kit's abort message carries a stack trace, the assertion interpolated it, and vitest parses assertion *messages* for stack frames the same way it parses real ones: `at render10 (…\drizzle-kit\bin.cjs:1450:31)` sent it to read a source map out of drizzle-kit's bundle, which threw `SyntaxError: Unexpected end of JSON input` **inside the reporter**. The run then said `Tests 22 passed (27)`, one unhandled error, and no failed test — a failing gate that reads as a passing one at a glance.

Confirmed pre-existing by reproducing it against `HEAD`'s copy of the file before any of this task's changes. Fixed with `withoutStackFrames`, which drops `at …` frames and keeps the line that says why (`Interactive prompts require a TTY terminal`). The message now renders in full, and it is strictly more informative than before: the renames it prints are structured.

**Acceptance, performed:**

- Column added to `schema.ts` with no migration — `driftProbeColumn: text('drift_probe_column')` on `companies`. Red: `expected 'ALTER TABLE \`companies\` ADD \`drift_pr…' to be ''`, at the residue assertion.
- Table renamed in `schema.ts` with no migration — `companies` → `accounts`. Red at the length assertion, with the created-or-renamed explanation and `drizzle-kit said: Error: Interactive prompts require a TTY terminal…`.
- The delta is still compared against `0004_fk_indexes_polymorphic_cascade.sql` and `0005_branding.sql` by their own SQL: the only lines in `git diff` mentioning either are comments.
- `EXPECTED_TABLES` guard kept, with its comment rewritten to say why it stays now that it should be redundant.
- `PRAGMA foreign_key_check` on a fully migrated seeded database still empty — `0006_offerings_rename.test.ts`, 7 passed.
- `npm run typecheck`, `npm run lint`, `npm test`: 1304 + 80 = **1384 passing**, up 23 from 1361.

**Deferred:** nothing.
