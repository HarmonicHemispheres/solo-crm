---
id: T-260901-29
title: Make the detail-page header band contain its content instead of a fixed strip the content straddles
status: done
category: ui
created: 2026-09-02
closed: 2026-09-02
---

## Why

The mockup draws the detail banner as a 76px strip with the header pulled
40px up over it, sized for mark + one-line heading + tags. The company
header now also carries the decay meter and the Edit / Logo / Banner
cluster, and at 700px the heading wraps — so the mark sat below the band,
the tags hung under its edge and the buttons crossed it. Reported by the
user from the Sitefacts page: "the header vertical height doesn't look good
with the rest of the header content."

## Story

As the operator, the company and person headers read as one band holding
the mark, the name, the tags and the buttons, at any window width.

## Constraints

- `.dbanner` keeps its gradient, the uploaded-image path and the contrast
  scrim (ADR-015); the scrim has to cover text that now starts near the top.
- Same change on the person page, which duplicates these classes.
- `ui-design.md`; the mockup remains the spec for everything else here.

## Acceptance

- [x] `npm run snap -- --routes company,person`: at 1440, 900 and 700 the
      mark, heading, tags and actions all sit inside the band.
- [x] `CompanyDetail.test.tsx`'s image and scrim assertions pass unchanged.
- [x] Open the app, open Sitefacts: the band is as tall as its content.

## Related

`views/CompanyDetail.css` (`.dbanner`, `.dhead`), `views/CompanyDetail.tsx`
(`CompanyHeader`), `views/PersonDetail.css`, `views/PersonDetail.tsx`,
`planning/solo-crm-mockup.html` lines ~382-388.

---

## Outcome

**Changed:** a `.dhero` wrapper in both views; `.dbanner` is its absolute
full-bleed background (no fixed height, no negative margin), `.dhead` has
18px/20px padding inside it. The image scrim's top stop goes 18% → 45%
because text now starts near the top. Comments rewritten to match.

**Departed from scope:** This departs from the mockup's straddling mark
deliberately — the strip was sized for content this header no longer has.
Annotated in the CSS, not the mockup.

**Not verified:** A header with an uploaded banner image was not
screenshotted (the seed has no images); the scrim ramp was reasoned, not
seen.

**Elapsed:** ~25 minutes.
