---
id: T-260902-12
title: Decide the company page's shape — one activity feed, one engagements card, and what the mockup's two-card split becomes
status: open
category: docs
plan_ref:
created: 2026-09-02
closed:
---

## Why

The mockup draws a company's Todos and its History as two separate cards, and
splits engagements into "Billed here" and "Work delivered here". The operator
has a reference design that merges the first pair into one "todos and touches,
newest first" feed and the second into one Engagements card. Departing from
the mockup is allowed; departing silently is not — Pipeline, Settings and
company images each got an ADR first, and this is the fourth.

## Story

As the operator, I open a company and read one story of what has happened and
what is owed, instead of scanning two cards to reconstruct it — and the next
session knows this was chosen, not drifted into.

## Constraints

- AGENTS.md names the mockup the authoritative visual spec. A divergence is
  recorded as an ADR **and** annotated in place in
  `planning/solo-crm-mockup.html`, the way ADR-005, ADR-014 and ADR-015 are.
- `ACTIVITY_KINDS` is `call | email | meeting | note`. The reference design
  shows a `SYSTEM` row ("Engagement … created") that no kind can produce. Say
  whether that is in or out; do not leave it implied.
- Decide the ordering rule for a merged feed: todos and touches share no
  timestamp column (`tasks.dueOn`/`completedAt` vs `activity.occurredAt`).
- Notes becomes its own card; Details drops its "—" rows for an add
  affordance. Both are part of the same decision.

## Acceptance

- [ ] `.dev/decisions/ADR-018-company-page-shape.md` exists, stating the
      merge, the ordering rule, the SYSTEM-kind answer, and what stays.
- [ ] `planning/solo-crm-mockup.html` carries the divergence note at
      `views.company`, in the style the three existing annotations use.
- [ ] AGENTS.md's References list names the fourth exception.

## Related

- `planning/solo-crm-mockup.html` `views.company` (~line 1544)
- `.dev/decisions/ADR-014-settings-layout.md`, `ADR-015-company-images.md`
- `electron/renderer/views/CompanyDetail.tsx`, `electron/shared/activity.ts`
