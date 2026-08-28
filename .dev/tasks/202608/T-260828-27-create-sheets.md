---
id: T-260828-27
title: Build the create sheets — company, person, engagement, todo
status: open
category: ui
plan_ref: P1-08
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

This is the task the user hit first: the installed app has a New menu
(`components/shell/NewMenu.tsx`) whose items lead nowhere, so there is no way to
put a single record into the database. The `Sheet` primitive exists from
T-260828-11 and has never been given a form to hold. Until this lands, the app
is a shell around an empty file — a fresh install has no seed (the seed fixture
is a `npm run seed` dev CLI and does not ship), so everything a real user sees
depends on being able to type a company in.

The engagement form is the one with a decision in it: §6.4 asks **"Billed to"**
and **"Work is for"** as two separate questions, because billing party and
delivery client are independent columns (§5). A single "Company" field would
collapse the model at the point of entry.

## Scope

**In:** Four sheets, opened from the New menu and from the command palette
(T-260828-37), built on the existing `Sheet`, `Chip`, `Toggle` and `Button`
primitives and writing through the T-260828-26 channels:

- **Company** — name, kind, website, `bills_directly`, billed-via company,
  introduced-by company, cadence days, budget note, since.
- **Person** — name, email, phone, notes, plus an optional company and title
  that opens the first affiliation.
- **Engagement** — name; **"Billed to"** and **"Work is for"** as two fields;
  billing model as a chip group that swaps in the model-specific fields
  (retainer → hours included; fixed → contract value; T&M → hourly rate,
  estimated hours, not-to-exceed); status chips including **`lost`** (G3);
  started on; ends on, left empty for rolling.
- **Todo** — title, due date, status, and optional company / engagement /
  person links.

"Work is for" defaults to the billing company and **stops tracking it once
edited**, so the common case is one field and the split case is still expressible.
Changing billing model preserves what has already been typed in the shared
fields. Enumerations are chip groups, never native selects, per the mockup.
Validation errors come from the shared zod schemas and render against the field
that caused them.

**Out:** The milestone editor for fixed-scope engagements — that is P3-09, and
until it lands fixed-scope revenue is a guess (G4). Editing existing records
inline (the detail views own that). The catalogue / service-version picker
(P3-01). Links (P1-20).

## Touches

- `electron/renderer/components/sheets/` — new, one file per sheet
- `electron/renderer/components/shell/NewMenu.tsx` — wire the items
- `electron/renderer/components/primitives/Sheet.tsx` — consumed, ideally unchanged
- `electron/renderer/lib/query-keys.ts` — invalidation on save

## Acceptance

- [ ] Each form writes exactly the columns its footer claims — asserted by
      reading the row back over IPC after a save, field for field
- [ ] Changing the engagement's billing model swaps the model-specific fields
      and loses nothing typed into name, companies, status or dates
- [ ] "Work is for" mirrors "Billed to" until edited, then holds its own value
      even when "Billed to" changes afterwards
- [ ] An engagement saved with billing ≠ client reads back with both columns
      distinct
- [ ] `lost` is selectable as a status
- [ ] Leaving "Ends on" empty stores NULL, verified on the raw column — not
      today's date, not a sentinel
- [ ] Every form is completable by keyboard alone, open to saved, with a visible
      focus ring at each stop (X-06)
- [ ] A validation failure names the field and does not close the sheet or lose
      input
- [ ] Saving a company makes it appear in the companies list with no manual
      reload

## Risks

- **Collapsing "Billed to" and "Work is for" into one field** because they are
  the same value 80% of the time. That is the schema decision §5 asks to
  preserve, failing at the only place a user could ever express it.
- **Defaulting `ends_on`.** A date picker that will not accept empty silently
  turns every rolling retainer into a fixed term.
- **Money entered as dollars, stored as dollars.** CONVENTIONS.md is integer
  cents; the conversion belongs at the field boundary with a test.
- **Mockup fidelity drift.** `planning/solo-crm-mockup.html` is the
  authoritative visual spec — open it rather than inferring the look, and note
  its `FORMS.engagement` omits `lost`, which G3 decided to add.
