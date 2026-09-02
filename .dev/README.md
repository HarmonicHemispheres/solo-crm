# The development process

Everything an agent writes while developing Solo CRM lands here, so the working
tree stays source code and the record of *why* stays queryable. This file is the
contract; the skills in `.claude/skills/` execute it.
[ADR-016](decisions/ADR-016-factory-slimming.md) records why it is this shape,
and [HOWTO.md](HOWTO.md) is the operator's guide to using it.

```
.dev/
  tasks/YYYYMM/       INDEX.md + one file per task — scope in, outcome appended
  decisions/          ADRs — durable architecture decisions, not month-scoped
  LESSONS.md          at most twenty one-line lessons no check can enforce
  summaries/          historical run summaries, no longer written
  templates/          task.md · adr.md
```

## The pipeline

| # | Step | Who | Skill |
|---|---|---|---|
| 1 | Interview: what, for whom, what must be true after | Claude asks, you answer | `scope-task` |
| 2 | Research the code, write task files, propose an order | Claude | `scope-task` |
| 3 | Approve, cut or edit the tasks | you | — |
| 4 | Build one task in a fresh session: implement, verify, screenshot, review, close | Claude | `build-task` |
| 5 | Look at the screenshots and the outcome | you | — |
| 6 | Did anything go wrong that a check could catch? | Claude | `retro` |

Two human checkpoints: before code exists, and after it runs.

**A scope is a brief, not a contract.** The builder reads the code with the
scope beside it and is expected to find what the scope missed. Deviating is
fine; deviating silently is not. Every departure goes in the Outcome.

**One task fits one fresh session.** If it cannot be built, verified and
closed in one context, it is two tasks.

**Sequential by default.** Worktrees and parallel subagents are for
independent mechanical work you explicitly ask for, and `cleanup-worktrees`
runs the same day.

A one-line fix skips all of this. The process is for work worth a record.

## Gates

| Gate | When | What |
|---|---|---|
| Stop hook | any turn that leaves source dirty | typecheck, lint, `check:index`; blocks on failure |
| `verify` | before closing | covering tests, then the full suite once; `npm run snap` for `renderer/` |
| Adherence review | before closing | a fresh subagent reads the diff against the acceptance list, gaps only |
| `code-review` | before closing | correctness, at `medium` |
| Retry budget | always | two verify-fix cycles, then stop and report |

`architecture-review` on a diff touching `db/`, `ipc/`, `preload/`, `sync/`.
`security-review` in its own session over the accumulated IPC surface once a
batch has landed, never per diff.

## Task record

One task, one file, whole lifecycle: scope up front, a short Outcome at close
(changed, departed from scope, not verified, elapsed). Name tasks
`T-YYMMDD-NN-slug.md`, decisions `ADR-NNN-slug.md`, and put the task ID in
commit subjects so `git log` and `.dev/` stay joinable.

| | Status | | Category | Lands in | Extra gate |
|---|---|---|---|---|---|
| ○ | `open` | 🗄 | `data` | `main/db/` | `architecture-review` |
| ◐ | `in-progress` | 🔌 | `ipc` | `main/ipc/`, `preload/` | batched `security-review` |
| ● | `done` | 🎨 | `ui` | `renderer/` | `npm run snap`, screenshots read |
| ⛔ | `blocked` | 🔗 | `integration` | `main/sync/`, `main/favicons/` | batched `security-review` |
| ✕ | `dropped` | 📦 | `build` | packaging, tooling, config | — |
| | | 📄 | `docs` | `planning/`, `.dev/`, `README` | — |

Frontmatter carries the bare word; indexes carry icon and word. A dropped
task keeps its file, with the reason. An index is a projection of the task
files beside it, updated in the same commit; `check:index` enforces it.

## Lessons

Something went wrong that the next session would repeat. In order of
preference: make it a check; or one line in [LESSONS.md](LESSONS.md), capped
at twenty; or let it go. Never a new paragraph in a skill or README because of
one incident. `retro` is the skill.

## Measuring

`npm run metrics`: per release, tasks closed, follow-up fixes among them,
median elapsed. Those and the issues you report against a release judge the
process. Token counts do not.
