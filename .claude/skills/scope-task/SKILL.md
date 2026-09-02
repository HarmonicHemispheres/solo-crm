---
name: scope-task
description: Turn a request into task files under .dev/tasks/YYYYMM/ — interview the user first, then research the code, then write short briefs (why, story, constraints, acceptance, related files) for the user to approve or cut. Use when the user asks for a feature, fix or change that is not a one-line edit, or says "scope this", "break this down", "write tasks for". Does not implement.
---

# Scope a request into tasks

The output is read by a fresh session with none of this conversation in it. A
scope that only makes sense to someone who was here has failed. A scope that
tells the builder which line to edit has also failed: the builder reads the
code, you describe the outcome.

## 1. Interview

Before reading any file, ask the user with `AskUserQuestion`. Three to six
questions, only the ones whose answer changes the work:

- Who does this and what is true afterwards that is not true now?
- What must not change? What is explicitly out?
- What does "done" look like on screen, or at the command line?
- Anything they have already decided, so you do not re-decide it.

Do not ask what the code can answer. Do not ask obvious questions. Stop when
the story and acceptance can be written from the answers.

## 2. Research

Now read what constrains the answer:

- [planning/solo-crm-requirements.md](../../../planning/solo-crm-requirements.md)
  and [planning/solo-crm-taskplan.md](../../../planning/solo-crm-taskplan.md):
  is there a plan item for this? Carry its ID into `plan_ref`.
- [AGENTS.md](../../../AGENTS.md) gotchas and any ADR this comes near.
- The current month's `INDEX.md`: is it already open, or dropped once and why?
- The code. **Run the thing, do not infer it.** If the scope depends on what a
  tool or module does, execute it and read the output. Every scope this
  project recorded as wrong was written from an assumption about a tool.

Search broadly before claiming something is absent.

## 3. Split

One task is one change a single fresh session can build, verify and close.
If it cannot, it is two tasks. Split where the seams are: a migration, the
repository over it, the view over that. Two tasks that must land in one commit
are one task. Prefer three sharp tasks to one vague one; do not shard so
finely that the coordination costs more than the work.

## 4. Write

Copy [.dev/templates/task.md](../../../.dev/templates/task.md) per task into
`.dev/tasks/<YYYYMM>/`. Keep each under about 300 words.

- **Why** and **Story** come from the interview, in the user's words.
- **Constraints** are requirements and gotchas, not steps.
- **Acceptance** is observable. The last item is always end-to-end: "open the
  app, do X, see Y." For `ui` tasks name the routes `npm run snap` should show.
- **Related** lists what research found. It is a starting point, not a list
  of files to edit.

Set `category` from [.dev/README.md](../../../.dev/README.md); it decides the
extra gate.

## 5. Hand back

Add each task to the month's `INDEX.md` as `○ open`. Show the user the list
with a one-line summary each and your recommended order. Say which you would
cut. If research changed the picture, say that first. They choose; do not
build.
