---
id: T-260828-30
title: Build company detail — todos with the next step, activity timeline, contacts
status: open
category: ui
plan_ref: P1-13
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The second half of the company page, and the half that makes it somewhere to
work rather than somewhere to look. A company page that shows engagements but
sends you elsewhere to log a call or tick a todo is a page you stop opening.
Runs after T-260828-29 because both edit the same route component and would
otherwise conflict.

The next step matters more than it looks: `is_next_step` is exclusive per
company (T-260828-23), and this is the only page where a person chooses it.

## Scope

**In:** Three more sections on `/company/:id`:

- **Todos** — open tasks for this company, with the next step visually distinct
  from ordinary todos by more than colour alone (the ui-design rule that status
  colour is never the only signal). Inline completion, inline quick-add, and
  promoting a todo to next step through `tasks:setNextStep`.
- **Activity** — the append-only timeline for this company, newest first,
  showing kind, date, title and body, and **offering no edit or delete
  affordance** (G8). Includes activity hung on this company's people and
  engagements, not only rows carrying its `company_id` directly.
- **Contacts** — people with a *current* affiliation here, showing title and
  primary marker, with historical affiliations behind a disclosure rather than
  mixed into the list.

**Out:** The engagements and details sections (T-260828-29). The global Todos
and Activity views (T-260828-33, T-260828-34). The quick log overlay
(T-260828-35) — this page's inline logging may reuse its component once both
land, but neither blocks the other. Cadence nudges (P2-05).

## Touches

- `electron/renderer/views/CompanyDetail.tsx` — extends T-260828-29
- `electron/renderer/components/primitives/QuickAdd.tsx`, `Row.tsx` — consumed
- `electron/renderer/lib/query-keys.ts` — invalidation after inline writes

## Acceptance

- [ ] The next step is distinguishable from ordinary todos without relying on
      colour alone
- [ ] Promoting a todo to next step clears the marker from the previously
      marked one, on screen, with no manual reload
- [ ] Inline completion and inline quick-add both work without leaving the page,
      and the todo count updates immediately
- [ ] Contacts list current affiliations only; a person who has left appears
      solely under the disclosure, visibly historical
- [ ] The activity section renders no edit and no delete control — asserted in a
      test over the rendered output, not by reading the diff (G8)
- [ ] Activity attached to one of this company's people appears here
- [ ] A company with no todos, no activity and no contacts shows three empty
      states, each offering the action that fills it
- [ ] Keyboard: quick-add, completion and next-step promotion all reachable
      without a mouse (X-06)

## Risks

- **Widening the activity query into a delete path.** The whole append-only rule
  lives at the repository boundary (T-260828-24) and in what the UI offers.
  There is no database enforcement behind it.
- **Optimistic updates on next-step promotion** that show two next steps for a
  frame, or leave the old one marked if the write fails. The write is
  transactional; the UI should reflect the settled state.
- **Pulling person and engagement activity in with three separate queries** and
  merging client-side out of order. Timeline order is the one thing a timeline
  has to get right.
- **Colour as the only status signal** — `.claude/rules/ui-design.md` forbids it
  and it loads automatically for renderer work.
