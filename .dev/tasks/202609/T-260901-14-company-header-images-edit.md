---
id: T-260901-14
title: Give company detail its logo, its banner and a visible way in to editing
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

Two things were reported about the company page: it has no edit button, and
its banner is a decorative strip with nothing in it.

The first is a discoverability problem, not a missing capability. A company
*is* editable today — `DetailsCard` has inline field editing over
`companies:update` for website, cadence, since, budget note, notes and kind.
But it sits in a card called "Details", somewhere in an `auto-fit` grid below
the fold, with no cue that anything on the page can be changed. Someone
looking for "edit this company" does not find it, which is indistinguishable
from it not existing.

The second is the banner. `.dbanner` is a gradient derived from `hue(name)`
and holds nothing.
[T-260901-08](T-260901-08-company-images-store.md) and
[T-260901-12](T-260901-12-company-images-ipc.md) give a company a real logo
and a real banner; this is the view that shows them and lets an operator set
them.

## Scope

**In:**

- The header renders the company's banner image where `.dbanner` currently
  draws its gradient, and the company's logo in place of `CompanyMark`'s
  derived initials. **Both fall back to what is there today** — the
  `hue(name)` gradient and the initials mark — when a slot is absent. Absence
  is the default, exactly as it is for the rail's own branding; there is no
  "no image" state to design, because the derived mark *is* it.
- Upload / replace / remove for each slot, through T-260901-12's channels.
  Follow `BrandingRow`'s shape in `WorkspaceSettings.tsx`: nothing optimistic,
  because what a pick produces depends on a native dialog the renderer cannot
  predict and a refusal it cannot anticipate — the only image shown is one a
  channel came back with. A refusal lands beside the control that failed.
- A visible Edit affordance in the header that opens the company sheet on
  this company, using [T-260901-10](T-260901-10-sheet-edit-target.md)'s
  plumbing.
- **Decide what happens to `DetailsCard`'s inline editing** and record the
  reason. Two editable paths to the same six fields is the actual risk here:
  either the sheet becomes the way and the card becomes read-only, or the
  card keeps inline editing and the header's button is a shortcut into the
  same fields. Pick one; do not ship both without saying which is
  authoritative.
- The header must survive a long company name, a very wide banner and a
  square logo without the layout breaking, down to ~700px.

**Out:**

- The heading's type. [T-260901-02](T-260901-02-detail-heading-type.md) fixes
  the missing `h1` rule that makes the banner read as empty, and it lands
  first. Do not also change it here — two tasks adjusting the same header's
  vertical rhythm will fight.
- The companies list cards
  ([T-260901-15](T-260901-15-company-card-banner.md)).
- Person detail. It has the same `.dhead`/`.dbanner` structure and no images
  in scope.
- Deleting a company.
- Cropping, repositioning or zooming an uploaded image. If a banner needs a
  focal point, that is a decision and a task, not something to invent here —
  `object-fit: cover` with a stated anchor is the scope.

## Touches

- `electron/renderer/views/CompanyDetail.tsx` + `.css` + `.test.tsx`
- `electron/renderer/components/sheets/CompanySheet.tsx` + test — edit mode
- possibly a shared image-slot row extracted from `WorkspaceSettings.tsx`'s
  `BrandingRow`, if the second consumer makes the duplication real

## Acceptance

- [ ] A company with no images renders exactly the header it renders today
      (after T-260901-02) — the gradient banner and the initials mark.
- [ ] Uploading a logo shows it in the header without a reload; removing it
      returns the initials mark.
- [ ] Uploading a banner shows it behind the header; removing it returns the
      `hue(name)` gradient.
- [ ] A refused upload (SVG, oversized) shows the refusal's own message
      beside the control that failed, and the previous image is unchanged.
- [ ] Cancelling the picker changes nothing and shows no error.
- [ ] The Edit control is keyboard-reachable, has an accessible name naming
      the company, and opens the sheet populated with that company's values.
- [ ] Saving from the sheet updates the header and the Details card without a
      reload.
- [ ] Whichever editing path was made authoritative, the other does not also
      write — asserted, so the two cannot disagree.
- [ ] A 40-character company name and a 3:1 banner both render without the
      header overflowing at 700px.
- [ ] `npm run verify` passes.

## Risks

- **Two writers to the same six fields.** Inline editing in `DetailsCard`
  and a sheet over the same columns will drift — different validation,
  different error surfaces, different optimistic behaviour. The decision this
  task is required to make is the mitigation; skipping it is the failure.
- The banner is now an operator-supplied image rendering full-bleed behind
  text. Contrast is not guaranteed by anything, and `ui-design.md` treats
  legibility as a v1 requirement. A scrim is probably needed; whatever is
  chosen must work for a white banner and a black one.
- `CompanyMark` is used at three sizes across three views. Teaching it to
  render an image affects the companies grid and the table row too — which
  is [T-260901-15](T-260901-15-company-card-banner.md)'s territory. Decide
  where the image-aware mark lives before editing it.
- The rail's branding row was built once and this is its second instance.
  Copying `BrandingRow` rather than extracting it is how the two acquire
  different refusal behaviour.

## Outcome

Merged into `main` from branch `T-260901-14` (builder `e814f6b`, nothing
changed at merge). Seven files.

**The decision the scope required: the company sheet is the authoritative
writer.** `DetailsCard` is read-only and holds no mutation — asserted in
`CompanyDetail.test.tsx` (`companies:update` never called from the card),
so the two paths cannot silently become two writers again. The reasoning
is in the card's own comment: the sheet is what the header's Edit button
makes discoverable, it is how every other entity is edited, and it can put
"name is required" against a named field. Consequences the scope did not
spell out: `notes` joined the sheet (the card showed six columns, the
sheet covered five); a "Not set" cadence chip carrying a `0` sentinel
mapped to `null` on the wire, because a chip group cannot show null and
the inline editor could clear a cadence; and the edit form diffs against
**what it was seeded with**, not the record — `kind`, `billsDirectly` and
`cadenceDays` have controls that cannot show null, so a record-diff would
write a control's default on every save (open a kindless company, Save,
it becomes a client — there is a test for that mutant). Three inline-edit
tests went with the behaviour they covered and were replaced by the
no-writer assertion and a round trip through the sheet. `PersonDetail`
keeps its inline editing; person is out of scope and that decision is not
made.

**Header.** `CompanyMark` is image-aware locally (not extracted; T-15 has
its own). The banner keeps its `hue(name)` gradient until an image is
stored; with one, `.dbanner.has-image::after` is a one-directional
`--obsidian` ramp (18% → 82%), which is how it works for a white banner
and a black one without branching on the image. Upload/Replace/Remove per
slot sit in one wrapping `.dhead-actions` row, each a `role="group"` named
for its slot with the refusal rendered inside the group; cancelling
neither errors nor clears a standing message. Nothing is optimistic — the
only image shown is one a channel came back with. `editSheet('company',
id, trigger)` opens `CompanySheet` in edit mode: `CompanySheet` →
`CompanyEditSheet` (loads, placeholder until then, "no longer exists" for
a deleted id) → `CompanyForm` seeded in `useState` initialisers, the same
split as `EngagementSheet`. Edit mode filters the company itself out of
the Billed via / Introduced by pickers. `BrandingRow` was not extracted:
the two rows share the two buttons and where a refusal lands and differ
in preview, caption, content-type set and state type; the comment in
`CompanyDetail.tsx` says so, and T-15 is the third instance that would
change the answer.

**Review.** Eight mutants against the two covering files — chosen/cancelled
swapped, refusal shown on both slots, Edit button unnamed, logo never
rendered, scrim class dropped, `kind` always sent, "Not set" sending `0`,
edit opening the wrong id — all died. At merge: three tsc projects, eslint,
the whole renderer project (609), renderer boot and the integration
project, all green.

**Not verifiable in jsdom:** the 700px / 3:1-banner overflow criterion is
asserted structurally (heading, mark and four controls present) and the
scrim by the `has-image` class that selects it; neither has been eyeballed
in the running app.
