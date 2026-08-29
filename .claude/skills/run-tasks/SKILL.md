---
name: run-tasks
description: Orchestrate approved tasks from .dev/tasks/ — plan the dependency order, fan out to subagents in isolated git worktrees, verify and review each change, merge them one at a time, then write the run summary. Use when the user has picked which scoped tasks to build ("run T-260828-01 and 02", "build these", "execute the plan"). Invoking this skill is the user's opt-in to multi-agent orchestration.
---

# Run approved tasks

You are the orchestrator. You do not write feature code — you plan, dispatch,
judge what comes back, and own the merge. The value you add is the decisions the
subagents cannot make: what order, what merges, what gets rejected.

## 1. Plan before dispatching

Read every named task file in full. Then decide:

- **Order.** What must land before what. Say why in the plan — a wrong
  dependency guess is the most expensive mistake available here.
- **Parallelism.** Tasks touching disjoint files run concurrently. Tasks
  touching the same file run in sequence, whatever their scopes claim.
- **Rejection.** A scope you cannot build from goes back to the user now, not
  after a subagent has burned a worktree failing to interpret it.

Show the plan and get agreement before spawning anything.

## 2. Fan out

Each task gets its own subagent in its own worktree. The subagent's prompt is
the task file's path plus the standing rules — do not paraphrase the scope into
the prompt, point at it, so there is one copy.

Every subagent, in order: implement → `verify` → `code-review` → commit on a
branch named for the task ID. It reports back what it changed, what verify said,
and what review found. **A subagent that cannot make verify pass reports the
failure; it does not weaken the test.** That rule is worth stating in the prompt
every time.

The task's `category` decides the review gate beyond `code-review` — the table
in [.dev/README.md](../../../.dev/README.md) is authoritative. Add a gate when
the diff turns out to reach past its category; never drop one to save a turn.

### The worktree does not start at main

An isolation worktree is created at the commit that was HEAD when the *session*
started, not at current `main`. Read
`.git/worktrees/<id>/CLAUDE_BASE` to see it. In a long session that is dozens of
commits behind — behind enough that task files, repositories and whole views
built earlier the same day are simply absent.

So the first line of every subagent prompt is an **unconditional** reset, not a
check:

    git checkout -B <task-id> main

Unconditional matters. Phrasing it as "confirm your base is main and rebranch if
not" has now failed twice: an agent reads a working tree with no
`.dev/tasks/202608/T-260828-35-quick-log.md` in it, concludes the scope does not
exist "anywhere in git history or branches", and reports `blocked` — confidently,
with evidence, and wrong. Tell the agent the base is stale as a fact and have it
report the commit it ended up on.

### Model and effort

| Role | Model | Effort | Why |
|---|---|---|---|
| Orchestrator | `opus` | `xhigh` | Planning and merge judgement, 1M context for many task files |
| Implementation | `opus` | `high` | See below — the rework was costing more than the tokens saved |
| Review, architecture | `opus` | `xhigh` | A missed defect costs more than the tokens |
| Index and summary edits | `haiku` | `low` | Mechanical |

Implementation was `sonnet` through the first two runs, on the reasoning that it
codes well at a fraction of the cost. Measured against what actually happened,
that was false economy: the review pass kept returning blocking defects of a
kind that cost a full build/verify/review cycle to fix — a foreign-key check
covering three of eight relations, a partial patch silently NULLing columns, a
timezone off-by-one wrong on the user's own machine — and a fix cycle is the
most expensive unit of work in this pipeline. Use `opus` for implementation.
Drop to `sonnet` only for genuinely mechanical work with a narrow blast radius.

Escalate the orchestrator to `fable` for a run of many interdependent tasks or
one where the architecture is still moving — it is the strongest model for
long-horizon agentic work, at roughly twice Opus's cost. Do not escalate a
three-task run of independent changes.

The skeleton in [workflow.js](workflow.js) is the default shape: a pipeline, so
a fast task reaches review while a slow one is still building. Adapt it; it is a
starting point, not a fixed harness.

## 3. Merge, one at a time

Merges are sequential and yours alone. Per task, in the planned order:

1. Re-read the review findings. Anything unresolved and real blocks the merge.
2. Merge the branch into the working branch.
3. Run `verify` **on the merged result.** Two changes that each passed alone can
   fail together, and this is the only place that gets caught.
4. Append the `Outcome` section to the task file, set `status: done` and
   `closed:`, and move the row to the month `INDEX.md`'s closed table as `● done`.
5. Run `npm run check:index` **before you move on to the next merge**, and treat
   a failure as blocking. This is step 4 made mechanical, and it exists because
   step 4 has been skipped three times across two runs despite being written
   here, in [.dev/README.md](../../../.dev/README.md), and in agent memory.

Set `status` to the bare word in frontmatter and the icon-plus-word form in the
index — the vocabulary is in [.dev/README.md](../../../.dev/README.md). Move a
task to `◐ in-progress` when its subagent starts, not when the run does, so the
index is true mid-run rather than only at the end.

Close each task at its own merge, not in a batch at the end of the wave. A batch
close is the failure mode: the run continues, the batch never happens, and the
index reads `◐ in-progress` for work that shipped an hour ago. `check:index`
now catches exactly that — a task named by a `Merge T-…` commit whose file
still says anything but `done` — but catching it late still means the user read
a false index in between.

If a merge breaks the build, stop the run. Do not merge further tasks onto a
broken tree hoping a later one fixes it.

A task whose review found something real but out of scope closes as `done` with
a follow-up task written — not with the finding recorded nowhere.

## 4. Summarise

Write one run summary from
[.dev/templates/summary.md](../../../.dev/templates/summary.md) into
`.dev/summaries/<YYYYMM>/`, add it to that month's `INDEX.md`, and link every
task. Fill in `What went wrong` honestly — a summary that reports a clean run
that was not clean is worse than no summary.

Then report to the user: what merged, what did not, and what needs them.
