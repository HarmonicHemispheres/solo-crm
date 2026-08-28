---
name: scope-task
description: Turn a request into reviewable task files under .dev/tasks/YYYYMM/ — gather the codebase and planning context first, then split the work into independently buildable tasks. Use when the user asks for a feature, fix, or change that is not a one-line edit, or says "scope this", "break this down", or "write tasks for". Produces scopes for a human to approve or cut before any code is written; it does not implement.
---

# Scope a request into tasks

You are producing the input another agent will build from, with none of this
conversation in its context. A scope that only makes sense to someone who was
here has failed.

## 1. Gather context first

Do not scope from the request alone. Read what already constrains the answer:

- [planning/solo-crm-requirements.md](../../../planning/solo-crm-requirements.md)
  — is this in scope, and does it contradict a stated non-goal?
- [planning/solo-crm-taskplan.md](../../../planning/solo-crm-taskplan.md) — does
  a task already exist for this? If so, carry its ID into `plan_ref` rather than
  writing a competing scope.
- [AGENTS.md](../../../AGENTS.md) — which gotchas does this come near?
- `.dev/tasks/<current month>/INDEX.md` and the month before — is this already
  open, or was it dropped once and why?
- The code the change touches, if it exists yet.

Search broadly before concluding something is absent. "There is no X" is a claim
you have to earn.

## 2. Split

One task is one independently buildable, independently reviewable change. Split
where the seams already are — a migration is not the repository that uses it is
not the view that renders it.

Two tasks that must land together in one commit are one task. A task that cannot
be described without "and then also" is two.

Prefer three sharp tasks to one vague one, but do not shard work so finely that
the coordination costs more than the work. If tasks must run in order, say so in
`Why` — the orchestrator reads that to build its dependency graph.

## 3. Write

Copy [.dev/templates/task.md](../../../.dev/templates/task.md) per task into
`.dev/tasks/<YYYYMM>/`, creating the month folder and its `INDEX.md` if this is
the month's first task. Fill every section; an empty `Risks` means you have not
looked.

Set `category` from the vocabulary in
[.dev/README.md](../../../.dev/README.md) — it decides which review gate the
task gets, so it is a routing decision, not a label. A task you cannot assign
one category to is usually two tasks; split it rather than picking the closest.

Frontmatter takes the bare word (`status: open`, `category: ui`) because it is
grepped. Icons belong in the index tables and in what you report back.

Acceptance criteria are the part that decides whether this works. Write them so
failure is observable — a command that exits non-zero, a number that must match,
a view that must render. "Works correctly" is not acceptance.

## 4. Hand back

Add each task to the month's `INDEX.md` as `○ open`, then show the user the list
with a one-line summary each and your recommended order — status and category
icons alongside their words, so the shape of the batch reads at a glance. Say
plainly which you would cut. They choose what runs; do not start building.

If scoping surfaced something that changes the plan — a requirement that is now
wrong, a dependency nobody had noticed — say that before the task list rather
than burying it in a task file.
