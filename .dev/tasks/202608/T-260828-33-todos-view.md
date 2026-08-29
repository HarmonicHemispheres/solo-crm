---
id: T-260828-33
title: Build the Todos view — grouped by date or client, inline completion and quick-add
status: done
category: ui
plan_ref: P1-16
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/todos` is a placeholder, and Today (P2-04) is built on top of it later. The
grouping is the feature: the same open tasks partitioned by date answer "what is
owed now" and partitioned by client answer "what do I owe this person before the
call". Two views of one set, not two sets.

`waiting` is the state that decides whether the count is trusted. §5 keeps
waiting items out of what is owed while still letting them age visibly — a
follow-up that has sat for three weeks is information, but it is not work you
can do today.

## Scope

**In:** The Todos view body:

- **Group by date** — Overdue, Today, This week, Later, No date, Waiting.
- **Group by client** — one group per company, plus an unattached group.
- The grouping choice in the `ViewHeader`, persisted per view (§6.13,
  T-260828-25).
- Inline completion on every row, writing through `tasks:update` and moving the
  row to its new group without a reload.
- Inline quick-add on **every** group, and a task added in a dated group is
  created already in that bucket — adding under "This week" sets a due date in
  that window rather than creating a no-date task that jumps elsewhere.
- Waiting items excluded from the owed count, shown with how long they have been
  waiting (`waiting_since`, T-260828-23).
- Company, engagement and person links on each row, navigating to those pages.

**Out:** The Today view and its hero metrics (P2-04). Cadence-generated nudge
tasks (P2-05). Recurring todos. Bulk edit. Drag between groups — the plan does
not ask for it and it is a large amount of interaction for a single-user tool.

## Touches

- `electron/renderer/views/Todos.tsx` — new
- `electron/renderer/routes.tsx` — replace one `ViewPlaceholder`
- `electron/renderer/components/primitives/QuickAdd.tsx`, `Row.tsx`, `ViewHeader.tsx` — consumed

## Acceptance

- [ ] Both groupings show the same open tasks, partitioned differently —
      asserted by comparing the flattened sets, not the group counts
- [ ] Waiting items are excluded from the owed count and still visible, showing
      elapsed time since `waiting_since`
- [ ] Quick-add under "This week" creates a task that lands in "This week" on
      the next render, not in "No date"
- [ ] Completing a task inline moves it out of its group immediately and updates
      the count in the same render
- [ ] The owed count comes from `tasks:countOpen`, not from a filter written in
      this view — one definition of "open" (T-260828-23)
- [ ] An overdue task is distinguishable from a due-today task without relying
      on colour alone
- [ ] With no tasks at all, the view shows an empty state offering quick-add,
      not a set of six empty group headers
- [ ] Quick-add, completion and grouping toggle are all keyboard reachable (X-06)

## Risks

- **A second definition of "open".** If this view filters `status !== 'done'` it
  will include waiting items in the owed count, and the number stops being
  trusted about a week later — the exact failure §5 warns about.
- **Date-bucket boundaries computed in local time against UTC timestamps.**
  `due_on` is a date-only value (CONVENTIONS.md); comparing it against a
  timestamp is how "Today" ends up off by one overnight.
- **Quick-add inheriting the group only visually** — the row appears in the
  right place until the next refetch moves it.
- **Colour as the only overdue signal** — `.claude/rules/ui-design.md`.


---

## Outcome

Merged as `8854794`, resolving a one-line `routes.tsx` import
conflict. Review non-blocking.

**Changed:** `views/Todos.tsx`, its CSS and test, one line of `routes.tsx`, and a
new `view.todos.groupBy` settings key.

The owed count comes from `tasks:countOpen` rather than a filter written in the
view, so waiting items stay out of it — the "open defined twice" risk that
T-260828-23's review already had to remove once at the repository layer.

**Note:** this task's new settings key is what broke T-260828-38 on the merged
tree — see that task's outcome. Working as intended: the exhaustiveness test
caught a registry key nothing accounted for.
