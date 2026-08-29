---
id: T-260828-43
title: Extract the repository machinery every repository is currently copying
status: done
category: data
plan_ref:
created: 2026-08-28
closed: 2026-08-28
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


---

## Outcome

Merged as the merge commit above. Review non-blocking (1 should-fix, 1 nit).

**Changed:** `electron/main/db/repositories/input.ts` and
`sqlite-errors.ts` (new), `machinery.test.ts` (new), and all seven
repositories reduced to their own SQL and mapping — 568 insertions against 380
deletions across 11 files.

Seven repositories were each carrying their own copy of the same input
normalisation and SQLite error translation. `links.ts` became the seventh in
wave F, and its own review flagged that it was adding a copy rather than waiting
for this task. Four open tasks were queued behind it (T-260828-41, -46, -55,
-56), all of which touch the files this rewrote.

**No test changed.** That was the review's sharpest question, because a
"refactor" that edits its tests has moved behaviour while wearing a refactor's
clothes. The 409 tests under `electron/main/db` pass on the merged tree without
one of them being touched.

**Verify reported `verify-failed`, and the orchestrator merged anyway.** The one
failure was `App.test.tsx`, a renderer test this diff cannot reach — it touches
only `electron/main/db/`. The verify agent did the right thing under the new
rule: re-ran it in isolation, found it *does* reproduce on a quiet machine at
5123ms, checked it against clean `main`, confirmed it fails identically there,
and reported it as pre-existing rather than silently passing or silently
failing. Characterised afterwards at 2 failures in 3 solo runs — the test body
takes 5.02s against a 5000ms limit. T-260828-54 owns it.

**Deferred (follow-ups, not blockers):**

- `stripUndefinedValues` spreads an array into a plain object —
  `{ ...(value as Record<string, unknown>) }` turns `[a, b]` into
  `{0: a, 1: b}`, because an array is `typeof 'object'` and non-null. No caller
  passes an array today, which is why nothing caught it; it is now shared by
  seven repositories, so the blast radius changed even though the code did not.
- The "declared exactly once" guard roots its scan at `electron/`, so a copy
  landing elsewhere would not be caught. Harmless while the renderer never
  touches SQLite, which is an AGENTS.md constraint rather than a property of the
  guard.
