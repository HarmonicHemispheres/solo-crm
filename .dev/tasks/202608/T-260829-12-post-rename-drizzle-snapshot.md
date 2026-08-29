---
id: T-260829-12
title: Check in a real post-rename drizzle snapshot, so the schema is not a derivation inside a test
status: open
category: data
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

From the review of [T-260829-10](T-260829-10-offerings-rename-identifiers.md).

`migrations/meta/` holds exactly one snapshot, `0001_snapshot.json`, describing
the schema as 0001 created it. That was harmless while every later migration only
*added* things: `schema.test.ts` could diff `schema.ts` against 0001 and expect
the additions.

0006 renames three tables and two columns, and a rename is the one change
drizzle-kit cannot infer. Seeing three tables gone and three arrived, it opens an
interactive "created or renamed?" prompt, aborts without a TTY, and emits nothing.
So T-260829-10 derived the base instead: it reads the renames out of the
registered migrations' SQL and applies them to 0001's snapshot text at test time.

That works, it fails closed, and it is well guarded. But it means **the only
description of the schema this project actually runs is computed inside a test
file.** `meta/` on disk now describes a shape no live database has had since 0006
ran. Two costs follow:

- `applyRenames` does text substitution over JSON. Its own review found the
  realistic hazard: a future column renamed from a common token — `name`, `type`
  — would rewrite every such key in the snapshot, not just the intended one. That
  is guarded for table names and fails closed either way, but it is a trap laid
  for whoever renames next.
- Anyone reading `meta/0001_snapshot.json` to learn the schema learns a schema
  from before three tables were renamed.

## Scope

**In:**

- Run `drizzle-kit generate` **once, interactively**, answering its
  created-or-renamed prompt with "renamed" for the three tables and two columns
  0006 renames. Keep the snapshot it writes; discard the migration SQL it offers,
  since `0006_offerings_rename.sql` is already checked in and already applied to
  real databases.
- Check that snapshot in as `meta/0006_snapshot.json` (or whatever name
  drizzle-kit's own convention gives it), alongside the `_journal.json` entry it
  needs to be found.
- Rewrite `schema.test.ts`'s base to read the checked-in post-rename snapshot
  directly. **Delete `applyRenames` and `renamesInMigrations`** — they exist only
  to synthesise what would then be a real file.
- `EXPECTED_TABLES` currently derives itself from `MIGRATION_0001_TABLES` through
  those same helpers. Restate it as a literal list, the way
  `MIGRATION_0001_TABLES` is.
- Whatever `_journal.json` needs so that drizzle-kit picks the new snapshot as
  the previous state rather than 0001's. T-260829-10 found that drizzle takes the
  last file in `meta/` by name, excluding `_journal`; confirm that is still how it
  resolves rather than assuming it.

**Out:** editing `0001_init.sql` or `meta/0001_snapshot.json` — both are history.
Adding an npm script that runs `drizzle-kit generate`; the runtime applies
checked-in SQL and the generator stays a development tool. Any schema change at
all: this is a bookkeeping task, and the schema it records must be byte-for-byte
the one that exists today.

## Touches

- `electron/main/db/migrations/meta/` — one new snapshot, and `_journal.json`
- `electron/main/db/schema.test.ts`

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `grep -n "applyRenames\|renamesInMigrations" electron/` returns nothing.
- [ ] The drift test still fails on a schema-only change: add a column to
      `schema.ts` with no migration, watch it go red, remove it. **Performed, not
      reasoned about** — state which column in the outcome.
- [ ] The drift test still fails on a rename in `schema.ts` with no migration.
      Same: performed, and the failure message still explains the
      created-or-renamed case rather than reporting an empty generation.
- [ ] The checked-in snapshot's table set equals the tables a fully migrated
      database has, asserted in a test against a real migrated database rather
      than against a list.
- [ ] `0001_init.sql` and `meta/0001_snapshot.json` are unchanged —
      `git diff` names neither.

## Risks

- **The prompt has to be answered correctly, once, by hand, and the answer is
  invisible afterwards.** Answering "created" rather than "renamed" for any of the
  five produces a snapshot that describes the right shape by the wrong history;
  the immediate tests would pass and the next `generate` would propose dropping
  and recreating a table with data in it. The acceptance criterion that the
  snapshot's tables match a real migrated database is the check that catches a
  wrong shape, but not a wrong *history* — read the diff of the generated
  snapshot before keeping it.
- Deleting `applyRenames` removes a guard that currently fails closed. The two
  performed-not-reasoned criteria above are what make sure its replacement does
  the same.
- This is bookkeeping with no user-visible effect, which makes it easy to do
  carelessly and easy to defer forever. Deferring is defensible — the derivation
  works. Doing it halfway is not.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
