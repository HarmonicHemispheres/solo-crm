---
id: T-260828-43
title: Extract the repository machinery every repository is currently copying
status: in-progress
category: data
plan_ref:
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

**Five independent reviewers raised this independently**, which is what makes it
worth a task rather than a nit. Every repository built in R-260828-02 carries a
byte-identical copy of the same ~50 lines from `companies.ts`: `parseInput`,
`stripUndefinedValues`, the `SqliteConstraintError` interface,
`isSqliteConstraintError`, the `ConstraintHandler` type, `translateWriteError`,
`formatIssues`, `boolToSql`, and the `FIELD_SPECS` / `CREATE_DEFAULTS` shape.

That is five hand-synced copies of the absent-vs-explicitly-undefined rule —
the rule that was a **blocking** defect on T-260828-20 precisely because getting
it wrong silently NULLs a column. One copy drifting reintroduces that bug in one
entity only, which is the hardest version to notice.

The cause is recorded honestly: the orchestrator's wave-B prompt told all five
builders to copy `companies.ts` as the pattern, and they did — literally. The
instruction should have been to extract. `errors.ts` and `refuseIfReferenced`
*were* properly reused, so the `RefusalError` / `blocker` shape is not forked;
this is narrower than that, and correspondingly cheaper to fix.

The window matters. Six more repositories are not coming, but T-260828-36
(search) and the P2/P3 repositories are, and each one that lands first is
another copy to reconcile.

## Scope

**In:**

- `electron/main/db/repositories/input.ts` — `parseInput`,
  `stripUndefinedValues`, `formatIssues`. The absent-vs-undefined rule and the
  zod issue formatting, defined once, with the explanatory comment that
  currently lives in six places living in one.
- `electron/main/db/repositories/sqlite-errors.ts` — `SqliteConstraintError`,
  `isSqliteConstraintError`, `ConstraintHandler`, `translateWriteError`, and the
  generic `NOTNULL` / `UNIQUE` / `PRIMARYKEY` handlers. Each repository supplies
  only its own table-specific handlers — the `FOREIGNKEY` message and any
  `CHECK` branches — which is the part that legitimately differs.
- Rewrite `companies.ts`, `people.ts`, `engagements.ts`, `tasks.ts`,
  `activity.ts` and `settings.ts` to import rather than redeclare.
- One test file for the extracted modules covering the behaviour that is
  currently only tested incidentally through six callers — in particular that an
  explicitly-`undefined` key is stripped, since that is the defect this prevents.

**Out:** Any behaviour change. This is a pure extraction: every repository must
behave identically before and after, and the existing per-repository tests are
the proof. Changing a refusal message, tightening a schema, or "improving"
anything while moving it makes the diff unreviewable. `errors.ts` and
`referential-guard.ts`, which are already shared and need no work. The
`FIELD_SPECS` / `CREATE_DEFAULTS` **shape** — the tables themselves are
genuinely per-entity; only extract the machinery that walks them if a clean
generic falls out, and skip it if it does not.

## Touches

- `electron/main/db/repositories/input.ts` — new
- `electron/main/db/repositories/sqlite-errors.ts` — new
- Every existing file in `electron/main/db/repositories/`

## Acceptance

- [ ] `parseInput`, `stripUndefinedValues`, `formatIssues`,
      `isSqliteConstraintError` and `translateWriteError` are each declared
      exactly **once** in the tree — asserted by a grep in the test, not by
      reading the diff, so a seventh copy fails the suite
- [ ] The full suite passes with no test modified — if a test needs changing,
      the extraction changed behaviour and is wrong
- [ ] Deleting the undefined-stripping line makes tests in **more than one**
      repository fail, proving the shared rule is genuinely shared
- [ ] Each repository still supplies its own `FOREIGNKEY` and `CHECK` messages;
      no refusal message changes text
- [ ] `tsc -p tsconfig.node.json` and `tsc -p tsconfig.web.json` both pass

## Risks

- **Doing it while branches are in flight.** Every unmerged repository branch
  touches these files; this task must run when none is open, or it will conflict
  with all of them at once.
- **Over-extraction.** `FIELD_SPECS` and `CREATE_DEFAULTS` are per-entity data,
  not machinery. Forcing them into a generic would produce a worse abstraction
  than the duplication it removes.
- **Silent behaviour change while moving code.** The whole value here is that
  behaviour is identical; the tests passing unmodified is the only evidence of
  that, so a modified test is the signal the extraction went wrong.
