---
id: T-260901-13
title: Sell an engagement from an offering, snapshotting the rate once
status: done
category: ui
plan_ref: P3-03
created: 2026-09-01
closed: 2026-09-01
---

## Why

An engagement can already point at what was sold — `engagements.offering_version_id`
is a real column, the repository accepts `offeringVersionId` on create and
update and refuses an id that does not resolve, and six of the seeded
engagements have one. No form ever sets it. So every engagement created in the
app is sold from nothing, and the offerings list has no relationship to the
work.

The data half of P3-03 is already built, in T-260828-22, and its rule is
enforced in the repository rather than asked for in a comment.
`electron/shared/engagements.ts`'s header: `agreedRateCents` "is a snapshot
taken at signature. It is writable on create; the update schemas below still
accept the key … but the repository never writes it to a column on
`updateEngagement`". `updateEngagement` has the one line that makes that true
and says so.

What is missing is the form that reads the price list exactly once, when the
engagement is created. That is this task, and it is the last piece of "attach
an offering to an engagement".

## Scope

**In:**

- An offering picker on `EngagementSheet`'s create form, reading
  [T-260901-07](T-260901-07-offerings-ipc.md)'s channels. It selects an
  offering and resolves to that offering's **current** `offering_version_id`.
- On create, the form sends both `offeringVersionId` and `agreedRateCents`,
  the latter taken from the chosen version's rate at the moment of submit.
  This is the one read of the price list, and it is a copy, not a link.
- Selling from no offering stays possible and is not an error —
  `offering_version_id` is nullable, one seeded engagement has none, and the
  migration test asserts a NULL survives.
- **On edit** ([T-260901-10](T-260901-10-sheet-edit-target.md)'s mode), the
  offering may be changed but the rate is not re-snapshotted and
  `agreedRateCents` is not sent. The repository drops the key silently, which
  means the UI must not present a control implying otherwise: if changing the
  offering on a signed engagement appears to change its rate and does not,
  that is worse than not offering it. State what the form shows here.
- Where an engagement's offering is visible: the engagement card should say
  what it was sold as. `ui-design.md` — that is a label, not a sentence.

**Out:**

- Re-rating an existing engagement. There is no re-rate path in the
  repository "in this task's Scope" by T-260828-22's own words, and adding
  one is a data decision with revenue consequences (ADR-003), not a form
  change.
- Displaying an engagement's rate by joining to the live price. P3-03's
  acceptance is explicit: "No query joins an engagement to a live price to
  display its rate." The stored `agreed_rate_cents` is the only source.
- The milestone editor (P3-09) — the other missing field on this same form.
- Filtering or grouping engagements by offering.

## Touches

- `electron/renderer/components/sheets/EngagementSheet.tsx` + test
- `electron/renderer/components/sheets/queries.ts` — an offerings list hook
  beside the existing `useCompaniesList`
- `electron/renderer/views/Engagements.tsx` + test — showing what it was sold
  as
- `electron/renderer/views/CompanyDetail.tsx` — only if the engagement cards
  there show it too

## Acceptance

- [ ] Creating an engagement from an offering priced at $3,500 stores
      `agreed_rate_cents = 350000` and the matching `offering_version_id` —
      read back from the database, not asserted on the request.
- [ ] Changing that offering's price afterwards leaves the engagement's
      `agreed_rate_cents` at 350000 — verified by reading the row, not by
      reasoning. (Creating a second offering at the new price is the way to
      set this up without P3-02.)
- [ ] Deleting or archiving the offering version an engagement was sold from
      changes nothing about that engagement's stored numbers.
- [ ] The update payload from the edit form contains no `agreedRateCents`
      key, for every path through the form.
- [ ] Creating an engagement with no offering still succeeds and stores NULL.
- [ ] A grep of the renderer finds no query joining an engagement to a
      current offering version to display a rate.
- [ ] `npm run verify` passes.

## Risks

- **The rate is a copy and every instinct says make it a link.** A form that
  displays "rate: (from offering)" and resolves it live is the failure P3-03
  exists to prevent, and it will look correct for as long as no price ever
  changes.
- The offering picker on the *edit* form is the subtle case: the repository
  accepts `offeringVersionId` on update, so an engagement can be re-pointed
  at a different offering while keeping its old agreed rate. That is
  intentional and it is also confusing to look at. Whatever the form does,
  say why in the outcome.
- `updateEngagement` accepts `agreedRateCents` in its schema and drops it.
  A form that echoes a full record back on save will hit that path and appear
  to work.
- This depends on both T-260901-07 (for the channels) and T-260901-10 (for
  the edit mode). Landing it before either means building against nothing.

## Outcome

Merged into `main` from branch `T-260901-13` (builder `91c291b`, one test
added at merge in `7909d83`). Twenty files.

**Create form.** The sheet reads `offerings:list({ active: true })` and
offers only offerings with a `currentVersion`; picking one sends the
*version* id as `offeringVersionId` and copies `version.rateCents` into
`agreedRateCents` once, at submit. Picking none sends NULL and no rate key
at all. The option label shows the price about to be copied, so the
snapshot is visible when it is taken.

**Edit form.** The picker stays editable — the repository accepts
`offeringVersionId` on update, and re-pointing a signed engagement at
another offering while keeping its agreed rate is the intended, if
odd-looking, behaviour the scope's Risks named. The options carry bare
names and no prices, the field's caption says the agreed rate was set when
this was signed and does not change here, and the patch carries
`offeringVersionId` only when it changed; `agreedRateCents` is never in an
update payload on any path. An engagement sold from an offering the active
list no longer shows keeps an extra option naming it, so an untouched save
does not unsell it.

**Read side.** `listEngagements` and a new `getEngagementWithOffering`
LEFT JOIN through `offering_versions` to `offerings` for `offeringId` and
`offeringName` only — no rate column is selected, so nothing in the
renderer can display a live price (ADR-003). `Engagements.tsx` and
`CompanyDetail.tsx` render "sold as {name}" beneath the card meta; the
shared `engagementWithOfferingSchema` extends `engagementSchema`, and
seven fixture files gained the two nullable columns.

**Review.** Seven mutants against the covering files: rate not snapshotted,
offering id sent as the version id, edit always re-sending the offering,
stored-but-unlisted offering dropped, join dropping the name, card never
saying sold-as — all died. The active-only filter on the list request
survived (the stub returned the same rows either way); the merge commit
asserts the request itself. `npm run verify`'s parts ran green at merge:
three tsc projects, eslint, the whole renderer project, the engagement
repository and IPC tests, the sheet round-trip integration test and the
renderer boot project.

**Not eyeballed:** the picker and caption have not been opened in the
running app.
