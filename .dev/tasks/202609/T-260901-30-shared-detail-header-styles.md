---
id: T-260901-30
title: Give the detail-page header one stylesheet instead of two copies that must be edited in step
status: open
category: ui
created: 2026-09-02
closed:
---

## Why

`.dbanner`, `.dhead`, `.dmeta`, `.cmark` and `.back` are declared twice —
`CompanyDetail.css` and `PersonDetail.css` — each file's header saying "no
shared home exists yet". T-260901-29 had to make the same change in both,
and T-260901-14's image and scrim rules exist only in the company copy, so
the two are already diverging.

## Story

As the operator, a company page and a person page have the same header, and
a change to one is a change to both.

## Constraints

- One stylesheet, loaded by both views (or a `DetailHeader` primitive that
  owns it); `PersonDetail.css` keeps only what is the person page's own.
- No visual change: `npm run snap` before and after should differ by nothing
  on `company` and `person`.

## Acceptance

- [ ] The five selectors appear in exactly one `.css` file under
      `electron/renderer/`.
- [ ] `company-*.png` and `person-*.png` are pixel-identical before and after.
- [ ] Open the app, open a company and a person: headers unchanged.

## Related

`views/CompanyDetail.css`, `views/PersonDetail.css`, their `.tsx` headers,
`components/primitives/` for where a `DetailHeader` would live.
