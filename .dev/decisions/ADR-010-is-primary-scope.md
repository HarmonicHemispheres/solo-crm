---
id: ADR-010
title: is_primary on an affiliation is scoped to the company, not the person
status: accepted
date: 2026-08-29
---

## Context

§5 of the requirements says only `is_primary boolean` on `affiliations`. The
acceptance criterion T-260828-21 built the people repository against — "setting
one primary clears the others" — reads equally well two ways, and the two mean
different things:

- **Per person.** "Which company is this person's main affiliation" — their day
  job among a day job, a board seat and an advisory stint.
- **Per company.** "Which of the several people we know at this client is the
  main point of contact" — the one to call.

T-260828-21 implemented the per-company reading, and recorded why in a code
comment above `clearOtherPrimaries`. That is where the decision lived until
now: not findable by anyone reading the requirements, the task plan or the
decisions folder, and invisible to the two tasks that have to agree with it —
**T-260828-31** (the person detail view, which renders the flag) and
**T-260828-26** (the IPC contract, which carries it across the boundary).
R-260828-02's review flagged the gap; T-260828-46 closes it.

## Decision

`affiliations.is_primary` means **"the main point of contact at this
company"**. Writing `isPrimary: true` on an affiliation clears `is_primary` on
every *other* affiliation at the **same company** — never on the same person's
affiliations elsewhere — and only on affiliations that are still open
(`ended IS NULL`).

One person may therefore be primary at several companies at once, and that is
correct, not a bug to fix.

## Consequences

- **The per-person question is already answered without a flag.** A person's
  current affiliation is `ended IS NULL`; a person-scoped `is_primary` would
  only re-derive that, and would then have to be kept in step with `ended` on
  every `endAffiliation` and `movePerson`. The per-company question has no
  other column that answers it.
- **A closed stint keeps its `is_primary`.** Naming a new primary contact at a
  client must not rewrite who was primary during a stint that already ended —
  the same history argument that gave affiliations their own table (§5). This
  falls out of the `ended IS NULL` clause in `clearOtherPrimaries`.
- **Reopening interacts with it.** `updateAffiliation({ ended: null })`
  (T-260828-46) puts a row back into the open set, so a reopened affiliation
  can be cleared by a later primary write at that company. That is the
  intended reading: it is an open affiliation again.
- **Pinned by a test, not by prose.** `people.test.ts`'s case *"is_primary is
  scoped to the company, not the person (ADR-010): one person can be primary at
  two companies at once"* fails if the per-person reading is ever implemented.
  It deliberately uses one person across two companies — the pre-existing
  "different company" case uses two people and passes under either reading.
- **T-260828-31 and T-260828-26 build against this.** A person detail view
  showing "primary" against a person's row means primary *at that company*; the
  IPC contract carries the flag unchanged and adds no per-person derivation.

## Alternatives considered

- **Per-person scope.** Rejected: duplicates `ended IS NULL`, and leaves the
  company-side question — the one a solo consultant actually asks before
  picking up the phone — unanswerable.
- **Both, as two columns.** Rejected: nothing in §5 or the mockup asks for the
  person-side flag, and a second boolean is a second thing to keep consistent
  on every affiliation write for no read that needs it.
