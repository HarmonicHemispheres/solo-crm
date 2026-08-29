# The development process

Everything an agent writes while developing Solo CRM lands here, so the working
tree stays source code and the record of *why* stays queryable. This file is the
contract; the skills in `.claude/skills/` execute it.

## Layout

```
.dev/
  tasks/YYYYMM/       INDEX.md + one file per task — scope in, outcome appended
  summaries/YYYYMM/   INDEX.md + one file per orchestrated run
  decisions/          ADRs — durable architecture decisions, not month-scoped
  templates/          task.md · summary.md · adr.md
```

Monthly folders keep any single index short. The current month answers "what is
open right now"; an old month answers "what shipped then". Nothing accumulates
into one ever-growing file.

Decisions are deliberately **not** month-scoped — an ADR from March still binds
in December, so filing it by month would bury it.

## The pipeline

| # | Step | Who | Skill |
|---|---|---|---|
| 1 | Request | you | — |
| 2 | Gather context, write task scopes | Claude | `scope-task` |
| 3 | Pick the tasks to run | you | — |
| 4 | Plan and fan out to worktree subagents | orchestrator | `run-tasks` |
| 5 | Implement against the scope | subagent | — |
| 6 | Tests, typecheck, lint | subagent | `verify` |
| 7 | Review the diff | subagent | `code-review` (built-in) |
| 8 | Merge, append outcome to the task file | orchestrator | `run-tasks` |
| 9 | Write the run summary | orchestrator | `run-tasks` |

Steps 2 and 4 are the two places a human decides. Everything between them is
mechanical, which is the point — `scope-task` produces something you can approve
or cut before any code is written.

`changelog` sits downstream of all of it and is not part of every run: summaries
here record how the work went, [CHANGELOG.md](../CHANGELOG.md) records what the
app can now do. Write it when a batch of work adds up to something a user would
notice, not once per merge.

`security-review` and `architecture-review` are not in the default path. Pull
them in when the diff touches IPC, the preload bridge, integration credentials,
the filesystem, or the data model.

**`security-review` runs in its own session, over the accumulated surface —
not inside a run, per diff.** A per-diff security pass sees one channel at a
time and cannot see the thing that actually matters: what the whole boundary now
permits. The URL-scheme gap on `companies.website` was found that way, by a
reviewer looking at one field and naming both its sinks; the same reviewer could
not have told you whether every other string crossing IPC had the same gap.
Batch it, give it the whole `electron/main/ipc/` and `preload/` surface plus
every integration, and run it when a wave has landed rather than while it is
still moving.

## Where a task's record lives

**One task, one file, whole lifecycle.** The scope is written up front and the
outcome is appended at close — findings, files touched, what got deferred. Do
not copy per-task detail into a summary; the summary links to the task.

Summaries are **run-level**: what a single orchestrated run changed across all
its tasks, in the aggregate. That is the document you read a month later.

## Naming

| Kind | Pattern | Example |
|---|---|---|
| Task | `T-YYMMDD-NN-slug.md` | `T-260828-01-fts5-palette.md` |
| Run summary | `R-YYMMDD-NN.md` | `R-260828-01.md` |
| Decision | `ADR-NNN-slug.md` | `ADR-001-ipc-boundary.md` |

`NN` is a same-day counter. Task IDs are permanent — reference them in commits
(`T-260828-01: add FTS5 index`) so `git log` and `.dev/` stay joinable.

Where a task implements a step from
[the task plan](../planning/solo-crm-taskplan.md), record its ID (`P1-01`) in
the `plan_ref` field rather than restating the plan's content.

## Status and category

Two fixed vocabularies. Frontmatter carries the **word alone** so it stays
greppable (`grep -r "status: blocked" .dev/tasks/`); rendered prose — indexes,
tables, anything reported to the user — carries **icon and word together**.

The icon never appears alone. It speeds up scanning a column of thirty rows; it
is not a replacement for the label, exactly as
[the UI rules](../.claude/rules/ui-design.md) require of status colour in the app.

### Status

| | Status | Meaning |
|---|---|---|
| ○ | `open` | Scoped and approved, not started |
| ◐ | `in-progress` | Claimed by a subagent or a worktree |
| ● | `done` | Merged, verified on the merged tree, outcome written |
| ⛔ | `blocked` | Waiting on a decision or another task — record which |
| ✕ | `dropped` | Not building it. The file stays, with the reason |

`○ → ◐ → ●` is a filling ring, the same motif the app uses for cadence. A
dropped task keeps its file; deleting it loses the reason it was considered, and
that reason is why the question stops being re-asked.

### Category

One per task, matching the directory the work lands in — so the category is a
fact about the change, not a label someone chose.

| | Category | Lands in | Default extra gate |
|---|---|---|---|
| 🗄 | `data` | `main/db/` — schema, migrations, repositories | `architecture-review` |
| 🔌 | `ipc` | `main/ipc/`, `preload/` | `security-review` |
| 🎨 | `ui` | `renderer/` | — (`ui-design.md` loads automatically) |
| 🔗 | `integration` | `main/sync/`, `main/favicons/` | `security-review` |
| 📦 | `build` | packaging, tooling, config | — |
| 📄 | `docs` | `planning/`, `.dev/`, `README` | — |

The right-hand column is what makes the category load-bearing rather than
decorative: it decides which review runs beyond the default `code-review`. A
task spanning two categories takes the stricter gate — or, more often, is two
tasks.

## The tools

Each is usable on its own; the pipeline is what happens when they run in order.
None of them is a wrapper around the others, so a one-off use costs nothing.

| Command | Answers |
|---|---|
| `npm run check:index` | Does the record match what actually shipped? |
| `npm run report:run -- <runId> --markdown` | When did a run happen, on what model and platform, at what token cost, and where did its wall clock go? |

`report:run` reads the agent transcripts a run leaves behind, so its numbers are
observations rather than estimates, and it is the only correct way to fill in a
summary's metadata block. With no run ID it reports every workflow in the
current session; with several, it sums them. `CLAUDE_TRANSCRIPT_DIR` points it
at a different session or machine.

## Keeping indexes true

An index is a projection of the files beside it, so it can be rebuilt and is
never the source of truth. Update it in the same commit as the status change.
When they disagree, the task files win.

`npm run check:index` enforces that. It is a checker, not a generator — the
indexes carry hand-written groupings and prose a generator would flatten. It
fails on a missing row, a duplicate left behind by a status move, an icon that
disagrees with its word, an orphan row, a `done` task with no `closed:` date or
no `## Outcome`, and a task named by a `Merge T-…` commit whose file still says
`in-progress`. That last one is the case prose kept missing: the file and the
index agree with each other and are both wrong.

Run it after every status change. `verify` runs it as its final step, so a
stale index fails the same gate the tests do.
