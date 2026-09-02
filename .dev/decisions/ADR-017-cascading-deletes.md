---
id: ADR-017
title: A delete refuses by default and cascades only from a confirmation that has shown its impact
status: accepted
date: 2026-09-02
---

## Context

Every `deleteX` in `electron/main/db/repositories/` refuses when anything
still points at the row. `refuseIfReferenced` (`referential-guard.ts`) throws
a `RefusalError` naming the blocker, and the messages are written to tell the
operator what to clear first:

> Cannot delete "Acme": it has 3 activity records. Activity is append-only
> (G8) and cannot be reassigned or removed to make room.

That is a good refusal and a dead end. Activity has no delete of its own — by
decision, G8 — so an operator reading that sentence has been told to clear
something the app gives them no way to clear. The same held for engagements
(an engagement with any activity could not be deleted), and for people. And
none of it was reachable anyway: the four `<entity>:delete` channels existed
in main from T-260828-26 onward and **nothing in the renderer ever called
them**. Offerings had no delete channel at all, only `archive`.

Reported: *"we can't delete engagements, companies or people or offerings.
we need a way to do this."*

Three shapes were considered:

1. **Refuse, and show the reason.** The dialog reports the blocker and stops.
   Honest, and leaves the dead end exactly where it was for activity.
2. **Archive everything.** Nothing is ever removed; records get a flag and
   drop out of lists. Works for offerings (where it already exists and is
   right, because a sold offering is the record of why an engagement was
   priced as it was). Wrong as a general answer: a company typed by mistake
   is not a company that ended, and an operator's database should not
   accumulate their own typos permanently.
3. **Cascade, from an explicit confirmation.** Chosen.

## Decision

**A delete refuses by default. It cascades only when the caller passes
`cascade: true`, which the renderer sets only after showing what would go.**

Three parts, and the third is the one that matters:

1. `deleteRequestSchema` is `{ id, cascade?: boolean }`. Absent means false,
   so every existing caller — and every future one that forgets — keeps the
   refusing behaviour. There is no way to reach a cascade by accident.
2. `<entity>:deleteImpact` returns the counts: what would be deleted, and
   separately what would be *kept and unlinked*. `ConfirmDelete` shows both,
   under different headings, and the confirm button is disabled until they
   have arrived — nobody agrees to a list they have not been shown.
3. **The preview and the delete are derived from one declaration.** Each step
   in `cascade.ts` carries a single `where` clause, and `SELECT COUNT(*)` and
   `DELETE` are both built from it. A dialog that under-counts is worse than
   no dialog, because the operator has been given a number by the app itself
   and it was wrong.

### What cascades, and what only unlinks

Not everything that points at a record should die with it, and the two are
kept apart in the data and on screen:

- **Deleted** — rows that exist only as part of the record. A company's
  engagements, its activity, its todos, its affiliations; an engagement's
  milestones and revenue lines.
- **Unlinked** — rows that are their own thing and merely referred to it.
  Another company that billed through this one is still a company. An
  engagement sold from a deleted offering is still a signed piece of work: it
  loses `offering_version_id` and keeps `agreed_rate_cents`, the snapshot it
  took at signature, which is exactly the case that column exists for
  (`electron/shared/engagements.ts`).

Deleting a company must never delete another company. That is the line.

### On activity and G8

G8 makes activity append-only, and `deleteCompany`'s own refusal says so.
A cascade deletes activity rows, and that is not a reversal:

G8 is about **corrections** — an activity record is not edited or removed to
fix what it says; a correction is a new row, so the log of a relationship
cannot be rewritten. Deleting the company is not a correction to its history.
It is the assertion that the relationship is not something this workspace
tracks at all. Keeping the history would mean activity rows pointing at a
company that no longer exists, which migration 0001's foreign keys forbid
outright — so the real choice was never "keep the history", it was "keep the
company forever".

## Consequences

- The four `deleteX` functions gain a `cascade` parameter and a matching
  `<entity>DeleteImpact` reader. `deleteOffering` is new; `archiveOffering`
  stays, and the two now sit side by side in the UI as the different
  questions they are.
- `cascade.ts` is the one place the cascade is described. A new table with a
  foreign key at one of these four needs a step there — and
  `cascade.test.ts` runs `foreign_key_check` after each entity's delete
  against the seeded fixture, so a missing step fails rather than orphaning
  rows.
- The polymorphic attachments (`links`, `taggings`, `external_refs`) are
  deliberately **not** steps: ADR-011 already cascades them by trigger, and a
  second copy of that rule in TypeScript could drift from it.
  `company_images` is likewise absent — its foreign key is the schema's one
  `ON DELETE cascade` (migration 0007).
- `Button` gains a third variant, `danger`, for one control in one dialog.
  `.claude/rules/ui-design.md` already reserved text labels for "destructive
  confirmation"; this is that.
- Undo is out of scope and stays out. The dialog is the safeguard, and it is
  a real one because it states the actual counts. An undo would mean a
  tombstone or a journal for every table, which is a much larger decision
  than this one and is not needed to stop the mistake this prevents.
