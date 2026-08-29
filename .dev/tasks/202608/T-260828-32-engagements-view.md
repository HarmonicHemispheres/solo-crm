---
id: T-260828-32
title: Build the Engagements view — cards grouped by status, progress per billing model
status: in-progress
category: ui
plan_ref: P1-15
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/engagements` is a placeholder, and under ADR-005 it is the **only** view of
engagement state — the mockup's Pipeline nav item was deliberately not ported
(D-02), so there is no board to fall back on. Whatever this view fails to show
about where work stands is not shown anywhere.

The card content is model-dependent in a way that is easy to get wrong: a
retainer's progress is hours against allowance, a fixed scope's is milestones
completed, a T&M engagement's is hours against estimate. Drawing the same
progress shape for all three is worse than drawing none, because it reads as
information.

## Scope

**In:** The Engagements view body:

- Cards grouped by status — `active`, `pending`, `proposed`, `held`,
  `delivered`, `lost` — with group headers and counts.
- Each card: name, billing company, client company (when different, marked as
  such), `ModelTag`, date range with NULL `ends_on` rendered as **rolling**, and
  model-appropriate progress.
- Retainers show hours against allowance; fixed scopes show milestones completed
  against total; T&M shows hours against estimate with the not-to-exceed noted.
  `equity` and `none` show no progress shape at all.
- **Hours-derived figures are visibly marked provisional** until the timelog
  import (P4-05) lands — AGENTS.md is blunt that without it, every retainer
  hours-used and effective-rate figure is fiction within two weeks. Marking them
  is not optional decoration.
- Cards navigate to the engagement's companies; a dedicated engagement detail
  route is not in the current route table and is not added here.

**Out:** Any revenue figure — ADR-003 keeps per-model money branching inside the
P3-05 generator, and this view must not compute one. The milestone editor
(P3-09). A Pipeline nav item or board (ADR-005 decided against it; its absence
is a decision, not an omission). Filters and saved views (P2-08).

## Touches

- `electron/renderer/views/Engagements.tsx` — new
- `electron/renderer/routes.tsx` — replace one `ViewPlaceholder`
- `electron/renderer/components/primitives/Card.tsx`, `ModelTag.tsx`, `Chip.tsx` — consumed

## Acceptance

- [ ] Retainers render hours against allowance, fixed scopes render milestones,
      T&M renders hours against estimate — three distinct shapes, from the seed
      fixture's own engagements
- [ ] No card renders a progress shape that does not apply to its model; an
      `equity` or `none` engagement renders none
- [ ] Every hours-derived figure carries a provisional marker, asserted in a test
      so it cannot be dropped by a later styling pass
- [ ] `ends_on: null` renders as "rolling", never as a blank or a far-future date
- [ ] An engagement whose billing and client companies differ names both; one
      where they match names one
- [ ] All six status groups appear when populated, `lost` included, and an empty
      group is omitted rather than shown empty
- [ ] No `SUM`, no per-month projection and no per-model money branching appears
      in this view's source
- [ ] Keyboard reachable, focus visible (X-06)

## Risks

- **ADR-003.** A "book value" or "monthly total" header on this page is the
  single most likely place the materialised-revenue decision gets undone, and
  the mockup does exactly that with hardcoded arrays. `architecture-review`
  names it as a standing flag.
- **Unmarked hours.** `time_entries` is empty until P4-05; a progress bar drawn
  from nothing reads as zero progress rather than as no data.
- **Reintroducing Pipeline** because a status-grouped card view looks like it
  wants to be a board. ADR-005 is the record; re-litigating it is a decision
  task, not this one.
