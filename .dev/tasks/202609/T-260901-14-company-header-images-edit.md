---
id: T-260901-14
title: Give company detail its logo, its banner and a visible way in to editing
status: in-progress
category: ui
created: 2026-09-01
closed:
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
