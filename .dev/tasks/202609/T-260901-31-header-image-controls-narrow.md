---
id: T-260901-31
title: Decide where the logo and banner controls live when the header is narrow
status: open
category: ui
created: 2026-09-02
closed:
---

## Why

The company header's action cluster is Edit plus two labelled buttons
(`LOGO Upload…`, `BANNER Upload…`) — five items with two mono labels. At
1440 it reads; at 700 it takes most of the band's width beside a wrapped
heading, and with an image present each slot grows a Replace/Remove pair.
T-260901-14 put them here so the way in to images is visible; whether that
should stay a permanent row of buttons, collapse into a single "Images"
control, or move into the Edit sheet is a decision, not a fix.

## Story

As the operator on a narrow window, the header shows the company, and one
obvious control gets me to editing it — including its images.

## Constraints

- ADR-015: the picker never returns a path; images reach the renderer as
  data URLs only. Whatever the control is, it calls the same channels.
- The Edit button's accessible name and the image slots' `role="group"`
  labels stay, or their tests are updated with them.

## Acceptance

- [ ] A decision recorded in the Outcome (and an ADR if it reverses
      T-260901-14's).
- [ ] `npm run snap -- --routes company --widths 700`: the header's actions
      fit beside a two-line heading without the band growing past the tags.
- [ ] Open the app at 700px, upload a logo and a banner: both paths still
      work.

## Related

`views/CompanyDetail.tsx` (`CompanyHeader`, `ImageSlotControls`),
`views/CompanyDetail.css` (`.dhead-actions`, `.dhead-img*`),
`.dev/tasks/202609/T-260901-14-company-header-images-edit.md`,
`components/sheets/CompanySheet.tsx`.
