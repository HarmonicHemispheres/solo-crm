---
name: verify
description: Run the project's checks — typecheck, lint, tests, migrations — and report what actually passed. Use before a commit, before a merge, after a merge, and as the gate in every run-tasks subagent. Reports failures faithfully; never weakens a check to make it pass.
---

# Verify

## The rule that matters

**A failing check is a result, not an obstacle.** Never delete, skip, `.only`,
`.skip`, loosen an assertion, raise a timeout, or add an expected-failure marker
to get a green run. If a check fails, report the output and stop. If the check
itself is genuinely wrong, say so and leave it failing — changing it is its own
task with its own review.

This is the one instruction in this repo worth repeating in every subagent
prompt, because a subagent under pressure to finish will otherwise quietly take
the easy path.

## Two modes, and the difference matters

**Iterating** — you are mid-change and want to know whether the thing you just
touched works. Run only what covers it. A full suite here tells you almost
nothing you did not already know and costs everyone else on the machine.

```
node_modules/.bin/vitest run path/to/thing.test.ts
npm run test:unit                                    # the fast pool
```

**Gating** — you are about to hand this off, merge it, or call it done. Run
everything, once. This is the mode the rest of this document describes.

Measured on this project: the suite is ~62% of all agent wall-clock, builders
were running the full gate around four times each while iterating, and 64
minutes went into re-running byte-identical commands. Splitting the two modes
costs nothing — the same checks still run before anything is handed off.

Some specifics that have each cost real time here:

- **Never run bare `npx vitest run`.** With no project filter it runs all five
  projects including the serial Electron pools; 179 such calls cost 128 minutes
  in one run. Use `node_modules/.bin/vitest run <file>` or `npm run test:unit`.
- Prefer `node_modules/.bin/<tool>` to `npx <tool>` — `npx` re-resolves on every
  call, and there were 697 such calls in one run.
- **Do not re-run a command whose inputs have not changed.**

## What to run

The stack is Electron + Vite + TypeScript with Drizzle and better-sqlite3.
Discover the actual commands from `package.json` rather than assuming; run every
one that applies to what changed, in this order — cheapest signal first:

1. **Typecheck** — `tsc --noEmit`. Catches the most per second.
2. **Lint.**
3. **Unit tests**, then integration tests if they are separate.
4. **Migrations** — if the diff touches `db/`, confirm they apply to a fresh
   database *and* to a copy of an existing one. A migration that only works on
   an empty database is broken and will not look broken.
5. **Build** — only when the change could plausibly break packaging.
6. **`npm run check:index`** — always, and last, because it is the one check
   that fails on a record rather than on code. It compares every task file
   against its month `INDEX.md` and flags a task already merged that never got
   closed. Treat a failure exactly like any other: fix the record, do not skip
   the command.

If a command does not exist yet, say which one is missing rather than silently
running a smaller set. "Tests pass" when there are no tests is a false report.

## Reporting

State what you ran, what passed, and what failed with the real output — not a
summary of it. If you ran a reduced set, say which and why.

Never report a check as passing that you did not run.

## Judging a failure

Say whether the failure is in the change or pre-existing on the working branch —
check by running the same command on a clean tree when it is not obvious. A
pre-existing failure is not the current task's to fix, but it is the current
task's to report, because it will otherwise be blamed on the next change.

Flaky is a claim that needs evidence. Re-run it; if it passes, say it passed on
retry and note it. Do not call something flaky to move on.

**A timeout is not a failure until it reproduces alone.** Re-run that file by
itself before reporting, and say explicitly whether it reproduced. Three tasks
in one wave reported `verify-failed` for timeouts caused purely by concurrent
agents contending for CPU; all three passed on a quiet machine, and treating
those reports as real would have bought three fix cycles that repaired nothing.
This is a diagnosis, not an excuse — a test that fails under the load it will
actually meet is a real defect, and it gets a task rather than a shrug.
