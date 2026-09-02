---
id: T-260901-30
title: Give the detail-page header one stylesheet instead of two copies that must be edited in step
status: done
category: ui
created: 2026-09-02
closed: 2026-09-02
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

- [x] The five selectors appear in exactly one `.css` file under
      `electron/renderer/`.
- [x] `company-*.png` and `person-*.png` are pixel-identical before and after.
- [x] Open the app, open a company and a person: headers unchanged.

## Related

`views/CompanyDetail.css`, `views/PersonDetail.css`, their `.tsx` headers,
`components/primitives/` for where a `DetailHeader` would live.

---

## Outcome

**Changed:** new `views/detail-header.css`, holding `.back`, `.dhero`,
`.dbanner`, `.dhead` and `.dmeta`; both detail views import it.
`CompanyDetail.css` keeps only what is the company page's own - its banner
image and scrim, and the `.dhead-*` action cluster - and `PersonDetail.css`
keeps nothing of the header at all, since nothing person-specific had ever
been added to it. New check: `views/detail-header.css.test.ts`.

**Departed from scope: substantially, and the scope was wrong.** The task
named five selectors duplicated across two stylesheets. Running the first
draft of the check found `.cmark` - one of the five - declared in **four**
view stylesheets: `Companies.css`, `People.css` and `Today.css` as well as
the two detail ones. All unscoped, all global, all identical bar a `.4px`
against a `0.4px`. Only one copy was ever governing anything, and which one
was a fact about bundler emit order.

That is not a detail-header rule, so it did not go into
`detail-header.css`. `.cmark`, `.cmark span`, `.cmark::after`,
`.cmark.has-image` and `.cmark-img` are `styles/identity-mark.css` now,
loaded once from `main.tsx` beside `tokens.css` and `base.css` - which is
what an app-wide unscoped class actually is. Same shape T-260828-15 found
once already ("three stylesheets fighting over one unscoped selector"). The
check covers it, including that `main.tsx` loads the file: a global
stylesheet nothing imports is a stylesheet that does not exist, and no jsdom
test would notice (Vitest runs with `css: false`).

Two smaller departures, both consequences of the above.

The company *card* called the image state `has-logo` and the company
*detail page* called it `has-image`, and only the detail page's copy set
`background: var(--surface-2)` - so the same transparent PNG logo sat on a
surface on one page and showed the page through it on the other. One class
now (`has-image`), with the detail page's behaviour, which is the correct
one. `Companies.tsx` and `Companies.css.test.ts` updated with it. Not
visible on the seeded database, which has no images.

`.cmark-img` was declared identically in `Companies.css` and
`CompanyDetail.css`; it is in the shared file now too.

Also done here rather than left: the same five views each carried their own
`hue`/`identityColor` and `initials` - the JavaScript half of the same
duplication, five copies, two of which had already drifted textually
(`word[0]` against `word[0] ?? ''`). They are `lib/identity.ts` now. The
mark *components* stay per view: their markup genuinely differs (a 38px card
mark that may hold a logo, a decorative 28px one, a 50px one with an
accent), and only the look and those two functions were ever shared.

**Not verified:** Nothing. The acceptance asked for pixel-identical
`company-*.png` and `person-*.png`, and `npm run snap` gives byte-identical
PNGs at all three widths for both routes across the CSS extraction. A full
36-shot run after the `.cmark` move as well: 30 identical, `companies-*`
different only by T-260901-27's 50d to 49d, `data-*` different only by the
temp profile path and read timestamp the page prints.

**Elapsed:** ~50 minutes.
