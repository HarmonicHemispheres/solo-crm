---
name: architecture-review
description: Review a change against Solo CRM's structural commitments — the IPC boundary, the data model, materialized revenue, pull-only integrations, and the constraints that keep a future sync path open. Use when a diff touches db/, ipc/, preload/, sync/, or adds a module boundary; when a decision feels like it needs an ADR; or when asked whether an approach fits. Judges structure, not correctness — pair it with code-review.
---

# Architecture review

Correctness is `code-review`'s job. Yours is whether the change leaves the
codebase able to absorb the *next* change — and whether it quietly spends a
constraint the project deliberately bought.

## What this project committed to

Read [AGENTS.md](../../../AGENTS.md) for the gotchas and
[requirements §4–§7](../../../planning/solo-crm-requirements.md) for the
reasoning. The commitments that a diff can erode without ever failing a test:

**The IPC boundary.** The renderer touches no SQLite and no filesystem. A change
that reaches around the preload bridge — even conveniently, even in one place —
ends the property that makes `contextIsolation` meaningful.

**Materialized revenue.** Every revenue question is one `SUM … GROUP BY` over
`revenue_lines`. Per-model branching computed live off engagement columns is the
mockup's shortcut, and porting it is the highest-risk regression available here
(task plan G5). Flag any revenue figure derived any other way.

**Pull-only integrations.** No write path to Stripe, Notion, Drive, Calendar or
Gmail. This is what stops the tool becoming a fourth thing to maintain, and it
is a one-line change to break.

**The sync-ready schema.** UUID keys, `created_at`, `updated_at` on every table
— except tables keyed by natural identity (`settings` by key, `favicons` by
host), see
[ADR-002](../../../.dev/decisions/ADR-002-settings-key-value-table.md). Cheap
now, and the whole reason a later Turso/libSQL move is a drop-in. A table
outside that exemption that skips them is a table that will have to be
rewritten.

**Local-first.** No account, no server, no telemetry, no network call the user
did not configure. Fully functional offline.

**Performance.** Any view under 100ms at 10× current data. A query that is fine
at 40 companies and quadratic at 400 is a finding now, not later.

## How to judge

Ask what the change makes hard. New code is cheap to write and expensive to live
in; the question is not "does this work" but "what does the next person have to
work around".

Distinguish the three cases, and say which you are looking at:

- **Fine** — fits the existing structure, no comment needed.
- **A deliberate tradeoff** — reasonable, but it spends something. Name what,
  and write an ADR from
  [.dev/templates/adr.md](../../../.dev/templates/adr.md) so the next person
  finds the reasoning instead of re-deriving it.
- **Erosion** — a commitment above, given up for local convenience. Say so
  plainly and propose the alternative that keeps it.

Being right about structure and vague about it is worthless. Point at
`file:line`, say what breaks and when, and propose something concrete.

## Scope discipline

Review what the diff does, not the architecture you would have chosen. A change
consistent with a decision you disagree with is not a finding — reopening the
decision is a separate conversation, and an ADR is where it belongs.

Say clearly when a change is structurally fine. An architecture review that
always finds something teaches everyone to skip it.
