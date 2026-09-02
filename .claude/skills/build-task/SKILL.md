---
name: build-task
description: Build one approved task from .dev/tasks/ in this session — read the scope beside the code, implement, verify, screenshot UI work, get an adherence review and a code review, write the outcome, close the index. Use when the user says "build T-…", "do this task", "run the next one". One task per invocation; start a fresh session for the next.
---

# Build a task

You are building, in this session, with the user reachable. There is no
orchestrator. Note the time you start.

## 1. Read, then decide

Read the task file in full, then the code it names under Related, then
whatever else you need. **The scope is a brief, not a contract.** If the code
disagrees with it, the code is right about what exists and the user is right
about what they want. Where the scope is wrong or incomplete, do the better
thing and write down what you changed and why. Where the difference is a
genuine choice the user should make, ask them now with `AskUserQuestion`
rather than guessing or blocking.

Mark the task `◐ in-progress` in its file and the month `INDEX.md`.

## 2. Build

Implement against the acceptance list. Follow the patterns the codebase
already uses; [AGENTS.md](../../../AGENTS.md) names the ones that are silently
wrong when ignored. Write tests beside the code, in the style of the tests
already there.

## 3. Verify

Run the `verify` skill. In short:

1. Covering tests while iterating, never the full suite.
2. `npm run typecheck`, `npm run lint` (the Stop hook runs these anyway).
3. For anything under `renderer/`: `npm run build && npm run snap`, then
   **read the screenshots** for the routes the task names. This is the check
   jsdom cannot do and the one that has caught every real UI defect here.
4. The full suite once, at the end: `npm test`.

**Two verify-fix cycles, then stop.** If the third attempt is needed, report
where you are and what you think is wrong. Do not weaken, skip or loosen a
check to get green; a failing check is a result.

## 4. Review

Two reviews, both by a fresh context, both before commit:

- **Adherence.** Spawn a subagent with the task file path and the diff. Its
  brief: "Check that every acceptance item is met, that the listed constraints
  hold, and that nothing outside the task's scope changed without being
  named. Report gaps that affect correctness or the stated requirements only;
  no style, no speculation." Fix real gaps; ignore the rest.
- **Correctness.** `/code-review` at `medium`. Fix blocking findings. Missing
  coverage and nits are a follow-up task or nothing.

Optionally, at most six mutants against the covering test file: change a line
the acceptance names, confirm the test goes red, restore by editing (never
`git checkout <file>`).

## 5. Close

Append the Outcome to the task file: changed, departed from scope, not
verified, elapsed. Set `status: done` and `closed:`, move the index row to the
closed table. Commit with the task ID in the subject, staging by explicit
path. The Stop hook runs `check:index`; a failure there blocks the turn until
the record is right.

Report to the user: what shipped, what departed from the scope, what they
should look at in the screenshots, and what needs them.

Then run `retro`.
