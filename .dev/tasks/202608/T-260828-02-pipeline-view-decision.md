---
id: T-260828-02
title: Decide whether the Pipeline view ships, and record it
status: in-progress
category: docs
plan_ref: D-02
created: 2026-08-28
closed:
---

## Why

The mockup ships a **Pipeline** nav item — a five-column board with per-item
probability bars and its own seed array. Requirements §1 opens by rejecting the
sales funnel as the wrong centre of gravity for this business, §2 lists no
pipeline in scope, and §5 has no `stage` or `probability` column to render it
from.

Left undecided this gets built by default, because AGENTS.md names the mockup as
the authoritative visual spec and an agent porting views will port that one.
T-260828-02 is cheap now and expensive after someone has built the board.

## Scope

**In:** Choose among the three options in
[the task plan §A.2](../../../planning/solo-crm-taskplan.md) — drop it, derive it
from `engagements.status`, or build it as drawn — and record the choice as an
ADR with the specific reason each rejected option lost.

Then make the decision visible where it will actually be read:

- Update the plan's **P1-15** line to state whether a Pipeline nav item ships.
- If it is dropped, note in `AGENTS.md` beside the mockup reference that the
  Pipeline view is deliberately not ported. An agent reading the mockup will
  otherwise treat its absence as an omission to fix.

**Out:** Building or deleting any code — there is none yet. Changing the mockup
file; it stays the record of what was designed, including what was designed and
declined.

## Touches

- `.dev/decisions/ADR-NNN-pipeline-view.md`
- `planning/solo-crm-taskplan.md` — §A.2 and the P1-15 entry
- `AGENTS.md` — only if the decision is to drop it

## Acceptance

- [ ] An ADR records the chosen option and the reason the other two lost
- [ ] The plan's P1-15 line states whether a Pipeline nav item ships, so the task
      can be scoped without reopening this
- [ ] If dropped, `AGENTS.md` says so next to the line naming the mockup as the
      authoritative visual spec
- [ ] If derived, the ADR names which status→column mapping is canonical and
      where it lives, so it is not re-invented per view

## Risks

- **AGENTS.md calls the mockup authoritative.** Dropping a view it contains
  creates a standing contradiction between two documents an agent is told to
  trust. The contradiction has to be resolved in writing, not left implicit, or
  it resurfaces every time someone opens the mockup.
- **Option 2 looks free and is not.** Deriving the board from
  `engagements.status` adds a second place engagement status is interpreted —
  the cards view in P1-15 being the first. Two mappings that drift apart is a
  bug that looks like a design inconsistency.
- The mockup's board contains a `Committed` column holding signed recurring work.
  Whatever is decided, the plan's claim that engagements-by-status "already shows
  the whole book" should be checked against that column rather than assumed.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
