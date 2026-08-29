---
name: run-tasks
description: Orchestrate approved tasks from .dev/tasks/ — plan the dependency order, fan out coding subagents in isolated git worktrees, then review each diff yourself, merge one at a time, gate the merged tree once, and write the run summary. Use when the user has picked which scoped tasks to build ("run T-260828-01 and 02", "build these", "execute the plan"). Invoking this skill is the user's opt-in to multi-agent orchestration.
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

The standing rules live in
[subagent-preamble.md](subagent-preamble.md) and go into **every** dispatch
verbatim. Do not re-type them per wave. They were hand-written five times across
five waves and drifted every time; the costly one was a wave whose preamble said
"confirm your base is main" where the previous said "reset unconditionally", and
the confirm-form produced an agent that reported a task file missing from git
history when it was tracked on `main` the whole time. The per-task note goes
*after* the preamble, since that genuinely differs.

Every subagent: implement → typecheck, lint, and the tests covering its own
diff → commit on a branch named for the task ID. It reports what it changed and
what those checks said.

**The builder is not the gate.** It does not run `npm test`, and it does not get
its own verify agent. Six agents each proving the whole repository green is six
times the cost for less information than one run on the merged result — and they
cannot prove it anyway, since the other branches in the wave are not in their
trees. Measured: the separate verify stage cost 260 agent-minutes in one run and
was almost entirely a second performance of what the builder had just done.

**A subagent that cannot make a check pass reports the failure; it does not
weaken the test.** That rule is worth stating in the prompt every time.

**Subagents do not review.** Builders build; you review. See §3.

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
| Orchestrator | `opus` | `xhigh` | Planning, review and merge judgement. Not a subagent — this is the session itself, and it now does the reviewing too |
| Implementation | `opus` | `medium` | See below — the rework was costing more than the tokens saved |
| Index and summary edits | `haiku` | `low` | Mechanical |

There is no verify role and no review role any more: builders check their own
diff, and the orchestrator reviews and gates. That removed two subagents per
task from a pipeline where they cost 260 and 518 agent-minutes in a single run.

**Opus subagents run at `medium` or below.** `high` and `xhigh` buy deliberation
a builder does not need: the scope is already written down and the acceptance
criteria are already explicit. What they cost is wall-clock on every task in the
wave at once, which is the thing actually constraining this project. Reserve
`xhigh` for the orchestrator, which is doing all the open-ended work now —
dependency order, review, merge judgement, deciding what a failure means.

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

The skeleton in [workflow.js](workflow.js) is the default shape. With review and
verify gone it is a single fan-out — builders in parallel, results back to you —
rather than a three-stage pipeline. Adapt it; it is a starting point, not a
fixed harness.

Keep the fan-out to about **four** concurrent builders. Six on this eight-core
machine drove the median test run from ~20s to 44s, which made every agent in
the wave slower and failed three healthy branches at their gate. More
parallelism stopped buying throughput before it stopped costing it.

## 3. Merge, one at a time

Merges are sequential and yours alone, and **you are both the reviewer and the
gate.** Per task, in the planned order:

1. **Review the diff yourself**, against the task's acceptance criteria and the
   extra gate its `category` names. This is the step nobody else does now, so
   the run is only as good as your attention here. What that means concretely
   is below.
2. Merge the branch into the working branch.
3. Run the **tests covering that branch's diff** — seconds, not the full suite.
   This is what keeps blame attributable: merge four unverified branches, run
   one suite at the end, and a failure costs a bisect. Merging one at a time
   with a targeted check after each means the branch that broke it is the one
   you just merged.
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

### Reviewing, now that you are the only reviewer

You wrote the dispatch prompt and chose the plan, so you are reviewing work you
have a stake in. That is a real weakness in the arrangement and the only defence
is method. Read the diff against the task file, not against your memory of what
you asked for.

**Mutation testing is the highest-yield thing you can do here.** Mutate a line
and check the covering test file goes red — that single technique has found more
than fifteen tests in this project that could not fail, including whole IPC
surfaces that would have shipped dead with a green suite. Run the covering file
alone, never the suite; pick at most six mutants, aimed at the branches the
acceptance criteria actually name. Done that way it costs seconds. Done as
"re-run everything per mutant" it cost 228 minutes in one run.

Things that have actually been caught by review in this project, as a checklist
of where defects hide here:

- A refusal path that checks some of its cases — `deleteCompany` covered three
  of eight foreign keys.
- A partial patch silently nulling columns it did not name.
- Dates compared across frames — a UTC-midnight value against a local clock,
  wrong by a day west of UTC from ~17:00.
- A test that asserts the mechanism rather than the result: correct byte count,
  correct header, garbage image.
- A constant or map re-declared in a second place instead of imported.
- Ordering on a non-unique column with no tiebreaker.
- A control whose *stored* value is never asserted, so it could render
  permanently on.

Set a finding **blocking** only for something that must be fixed before merge: a
correctness bug a user would hit, a violated AGENTS.md gotcha, a security hole,
or a broken architectural constraint. Missing coverage, mockup fidelity and nits
are follow-up tasks. Do not block on a test that could merely be stronger — that
habit cost roughly ninety minutes in one run.

### The gate, once, at the end

When every branch in the wave has merged, run the full `verify` on the merged
tree yourself:

```
npm run typecheck && npm run lint && npm test && npm run check:index
```

This is the run that decides whether the wave shipped. It is also the only place
a cross-branch failure can surface — two changes that each passed alone can fail
together, and no per-branch check can see it. T-260828-33 added a settings key
and T-260828-38's exhaustiveness test correctly failed on it; both branches were
green alone.

One run, on the merged result, with the machine to itself: that is both cheaper
and a stronger statement than six agents each running the suite against a tree
none of them will ship.

If it fails, the branch you merged last is the first suspect, because step 3
checked each one on the way in.

## 4. Summarise

Write one run summary from
[.dev/templates/summary.md](../../../.dev/templates/summary.md) into
`.dev/summaries/<YYYYMM>/`, add it to that month's `INDEX.md`, and link every
task. Fill in `What went wrong` honestly — a summary that reports a clean run
that was not clean is worse than no summary.

Then report to the user: what merged, what did not, and what needs them.
