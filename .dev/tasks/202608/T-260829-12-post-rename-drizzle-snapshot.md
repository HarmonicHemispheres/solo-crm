---
id: T-260829-12
title: Rename the drift test's base structurally, not by substituting over raw JSON
status: open
category: data
created: 2026-08-29
closed:
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

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
