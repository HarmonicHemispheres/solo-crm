---
id: ADR-016
title: Tasks build sequentially in one session against a deterministic gate; orchestration, run summaries and per-incident rules are removed
status: accepted
date: 2026-09-01
---

## Context

Nine orchestrated runs and ninety-five tasks in, the process record showed
three things at once. Task files were well scoped and well documented, which
the operator confirmed. Tasks took longer to ship than the same work done by
talking to Claude Code directly. And features shipped missing, broken, or
different from what was asked, which direct sessions did not produce.

The run summaries explain why. Scopes were written from assumptions about the
code and tools; the record names seven incidents of "scope was wrong",
"written from an assumption", "unbuildable as written". Builders were told to
build only what the scope said and to report blocked otherwise, so a wrong
scope became a wasted cycle or a faithful build of the wrong thing. No stage
ever opened the running app: eight outcomes say "not eyeballed", and the
operator's issue list against 0.5.0 is exactly what a jsdom-only gate cannot
see. The serial cost was the orchestrator's per-merge loop, about ten minutes
a task, not the builders. And every failure added a paragraph, so the
instruction set reached eleven thousand words, with a 145-line subagent
preamble that was mostly workarounds for the worktree model itself.

Published guidance and practitioner write-ups converge on the same mechanics:
a check the agent can run, hooks over prose, a fresh context per task, an
interview before a spec, an independent adherence review, and a bounded retry
loop. None of them recommend an orchestration layer at a one-person scale.

## Decision

1. **Interview first.** `scope-task` asks the operator structured questions
   before reading anything, and writes the spec from the answers.
2. **Scopes are briefs, not contracts.** A task file states why, a user story,
   constraints and observable acceptance, under about 300 words. The builder
   reads the code and is expected to depart from the scope where the scope is
   wrong, recording every departure in the Outcome.
3. **One task, one fresh session, sequential.** `build-task` replaces
   `run-tasks`. Parallel worktree fan-out is opt-in for independent
   mechanical work, and `cleanup-worktrees` runs the same day it is used.
4. **The gate is a Stop hook.** Typecheck, lint and `check:index` run
   whenever a turn ends with dirty source. Prose telling agents to run checks
   is deleted.
5. **UI work is verified against the running app.** `npm run snap` boots the
   built app on a seeded throwaway profile and screenshots every route at
   three widths. A `ui` task is not closed until its screenshots were read.
6. **Adherence is reviewed by a fresh context.** A subagent reads the diff
   against the acceptance list and reports gaps only, separate from
   `code-review`.
7. **Two verify-fix cycles, then stop and report.**
8. **Lessons become checks or one line.** `.dev/LESSONS.md` holds at most
   twenty lines, enforced by `check:index`. No rule is added to a skill or
   README because of a single incident.
9. **Run summaries stop.** The Outcome section is the record. Existing
   summaries stay for history.
10. **Three numbers judge the process:** tasks closed per release, follow-up
    fixes among them, median elapsed time. `npm run metrics` reports them.

## Consequences

Fewer words for an agent to hold: the process instructions drop from about
eleven thousand words to roughly three thousand. The operator is present at
the two points where intent is decided and where the result is seen, and
absent from the middle. Throughput on a wave of many independent tasks is
lower than the fan-out gave, and that is accepted: the fan-out's speed was
paid back in fix cycles and drift.

The worktree preamble's Windows hazards do not disappear; they move to
`cleanup-worktrees` and one line in LESSONS.

## Alternatives

**Strip everything and work from bare Claude Code.** Loses the task record,
the ADRs and the acceptance lists, which were the parts working. Rejected.

**Keep the orchestrator, fix the scopes.** The orchestrator's serial loop and
its inability to open the app are structural, not scope quality. Rejected.

**Memory system for lessons with semantic recall.** Adds a mechanism to manage
growth instead of a cap that forbids it. A hard cap of twenty with a check is
simpler and forces the conversion of lessons into checks. Rejected for now.
