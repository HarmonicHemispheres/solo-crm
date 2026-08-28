---
id: T-260828-31
title: Build the People view and person detail — affiliation history made visible
status: open
category: ui
plan_ref: P1-14
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/people` and `/person/:id` are both placeholders. People are the entity the
whole affiliation model exists to protect — T-260828-21 keeps the history in the
database, and this is the only place it becomes visible. If person detail shows
one current company and nothing else, the model is intact and the user still
cannot see what it bought them, which is the same as not having it.

## Scope

**In:**

- **People view** at `/people`: card and list presentations with the same
  header toggle and per-view persistence as Companies (§6.13, T-260828-28's
  pattern — reuse it rather than reimplementing).
- Cards show name, current company and title, and last contact state.
- **Person detail** at `/person/:id`: name, role, email, phone, current company,
  and **all affiliations** — the closed ones visibly historical with their date
  ranges, not merely absent.
- Activity involving that person, **regardless of which company the row hung
  on**, since a person's history follows them across employers and that is the
  point of the model.
- Inline edit of the person's own fields, and moving a person to a new company
  through `people:move` so the affiliation is closed and reopened in one
  transaction rather than overwritten.

**Out:** Company detail's contacts section (T-260828-30). Shared-history
scoring or "people you have not spoken to" surfacing — P5 judgement metrics.
Gmail-derived contact timestamps (P4-xx); `last_contact_at` renders whatever is
stored.

## Touches

- `electron/renderer/views/People.tsx` — new
- `electron/renderer/views/PersonDetail.tsx` — new
- `electron/renderer/routes.tsx` — replace two `ViewPlaceholder`s
- `electron/renderer/components/primitives/ViewHeader.tsx`, `Card.tsx`, `Row.tsx` — consumed

## Acceptance

- [ ] A person with two affiliations shows both, the closed one visibly
      historical with its `started`–`ended` range, and the open one marked
      current
- [ ] Activity involving that person appears on their page regardless of which
      company the activity row carries
- [ ] Moving a person to a new company from this page leaves the old affiliation
      closed with an `ended` date, not deleted — verified by reading both rows
      back
- [ ] Both presentations render the same record set, same count, same order, and
      the choice persists across a restart
- [ ] A person with no affiliation at all renders without error and without
      inventing a company
- [ ] An unknown `:id` shows a stated "not found"
- [ ] Keyboard reachable throughout, focus visible (X-06)

## Risks

- **Showing only the current affiliation** because it is what the card needs.
  That is the model's whole value, quietly discarded at the last step.
- **Filtering person activity by `company_id`** rather than `person_id` — it
  works for people who never moved, which is most of the seed fixture.
- **A "company" field on the person edit form** that writes an affiliation
  overwrite instead of calling `people:move`. §5 forbids the shortcut in the
  schema; the form is where it comes back.
- **Reimplementing the card/list toggle** instead of sharing T-260828-28's. Two
  implementations means two persistence keys and two behaviours.
