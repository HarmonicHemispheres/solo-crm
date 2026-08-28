---
id: T-260828-23
title: Build the tasks repository — next-step exclusivity, waiting transitions, open counts
status: done
category: data
plan_ref: P1-04
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Todos are the half of the app that gets opened daily, and the `tasks` table has
no reader or writer outside the seed fixture. Two behaviours here are not
storage but rules, and both are invisible if they are wrong: exactly one open
task per company may be the next step, and `waiting` is a state that ages
without being owed. Get the second wrong and the Todos view (T-260828-33) shows
an inflated owed count that quietly stops being trusted; get the first wrong and
Today (P2-04) has two next steps for one client and no way to choose.

## Scope

**In:** `electron/main/db/repositories/tasks.ts`:

- `listTasks` with filters — by status, by company, by engagement, by person, by
  due window — plus `getTask`, `createTask`, `updateTask`, `deleteTask`.
- `status` is `todo | waiting | done`. Optional `company_id`, `engagement_id`,
  `person_id` links; a task may carry none of them.
- `setNextStep(taskId)` — **one transaction** that sets `is_next_step` on the
  target and clears it from every other *open* task for the same company. Tasks
  with no company are exempt: they cannot be a company's next step.
- Status transitions own their timestamps: moving to `waiting` stamps
  `waiting_since`; moving off `waiting` clears it; moving to `done` stamps
  `done_at`; reopening a done task clears it. A caller never writes these three
  columns directly.
- `countOpenTasks(filter)` excluding both `waiting` and `done`, so the owed
  count has exactly one definition and the views cannot each invent their own.
- `dueOn` via `dateOnlySchema`; `waitingSince` and `doneAt` via
  `timestampSchema` (CONVENTIONS.md).

**Out:** IPC channels (T-260828-26). The Todos view and its groupings
(T-260828-33). Recurring or templated tasks — not in scope for v1. Cadence
nudges that *generate* tasks (P2-05).

## Touches

- `electron/main/db/repositories/tasks.ts` — new
- `electron/main/db/repositories/tasks.test.ts` — new
- `electron/main/db/repositories/errors.ts` — shared

## Acceptance

- [ ] `setNextStep` on a company with three open tasks leaves exactly one row
      with `is_next_step` true, verified by a count query, and does not touch
      another company's next step
- [ ] `setNextStep` does not clear the flag on a *done* task from the same
      company — closed history is not rewritten
- [ ] A task moved `todo → waiting → todo` has `waiting_since` set then null,
      asserted on the raw column at each step
- [ ] A task moved to `done` and reopened has `done_at` set then null
- [ ] `countOpenTasks` over a fixture of 1 todo, 1 waiting, 1 done returns 1
- [ ] A task with no company, engagement or person is creatable and appears in
      an unfiltered list
- [ ] Passing `waiting_since` or `done_at` directly to `createTask` /
      `updateTask` is rejected by the input schema rather than accepted

## Risks

- **`setNextStep` as two statements outside a transaction.** A failure between
  the clear and the set leaves a company with no next step, which looks like
  ordinary empty state rather than a bug.
- **"Open" defined twice.** If the views compute their own open filter, the
  Today count and the Todos count drift and neither is obviously wrong. One
  exported predicate, used everywhere.
- **`is_next_step` defaults to `false` in the schema, not null** — an update
  patch that omits it must not reset it, the same absent-vs-false trap as
  `bills_directly` in T-260828-20.


---

## Outcome

Merged as `f95696c`. Verify on the merged tree: typecheck clean,
520/520 tests.

**Changed:** `electron/shared/tasks.ts`, `electron/main/db/repositories/tasks.ts`,
`tasks.test.ts` — 1354 insertions.

**Review:** blocking. Fixed before merge.

1. *(blocking)* The next-step invariant was enforced only inside `setNextStep`
   and **silently broken by `updateTask`**, which never touched `is_next_step`.
   Three paths reproduced with probe tests: promoting A, parking it as
   `waiting`, promoting B, then returning A to `todo` left **two** open tasks
   flagged for one company; the same with `done` resurrected a stale flag on
   reopen; and moving a flagged task to another company carried the flag into a
   company that may already have its own next step. `updateTask` now maintains
   the invariant in the same transaction as its write.
2. The test for this task's **own** headline risk could not fail —
   mutation-proven: replacing `db.transaction(` with `((fn) => fn)(` left all 36
   tests green, because the only covering test threw before any `UPDATE` ran.
   Replaced with one that forces a mid-transaction failure.
3. **"Open" had two definitions and the exported one was dead.** `isTaskOpen` was
   called by nothing — not the repository, not its tests, not any sibling branch
   — while every real filter went through a separately hand-written SQL string.
   They agreed by hand. Now one derives from the other.
4. `listTasks` could filter by exact status but **not by open**, so the one thing
   every consumer needs was the one thing the repository would not return.
   T-260828-33 and P2-04 would each have hand-rolled it in the renderer — the
   "open defined twice" risk arriving through the read path.
5. `countOpenTasks` typed `status` away but `buildFilterClause` still read it at
   runtime, so `{status:'done'}` crossing IPC silently returned 0.

**Deferred:** ~50 lines copied verbatim from `companies.ts` → **T-260828-43**.
