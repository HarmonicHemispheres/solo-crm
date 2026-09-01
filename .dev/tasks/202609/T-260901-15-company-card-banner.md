---
id: T-260901-15
title: Carry a company's banner onto its card, behind a gradient
status: open
category: ui
created: 2026-09-01
closed:
---

## Why

The companies grid is `.ccard` — a flat `--surface` panel with an initials
mark, a name, tags and a cadence meter. Once a company has a banner
([T-260901-08](T-260901-08-company-images-store.md)) the grid is the place it
earns its keep: a wall of thirty cards is where an image identifies a record
faster than a name does, which is what `ui-design.md`'s "show, don't tell" is
about.

The request is specific about how: the banner behind the card's content,
faded out with a gradient, not as a header strip. That keeps the card's text
legible and keeps the image doing identification rather than decoration.

## Scope

**In:**

- `.ccard` renders the company's banner as a background layer, masked by a
  gradient so the card's content sits on solid ground and the image reads as
  a wash rather than a photo. Where a company has no banner, the card renders
  exactly as it does today — no placeholder, no empty band.
- The card's logo, if one is set, in place of the initials mark. Same
  fallback rule.
- Whichever list read [T-260901-04](T-260901-04-company-images-decision.md)
  specified is the one this uses. **Do not fetch full-size images per card**
  unless that is what the ADR decided, and if it is, this task's outcome
  records the measured cost at 60 companies.
- The list (table) presentation gets the logo in its 26px mark. It does not
  get a banner — a table row is not a canvas.
- Legibility is a requirement, not an outcome: the card's text must meet
  contrast against a white banner and a black one, and the gradient is what
  guarantees it.

**Out:**

- Company detail ([T-260901-14](T-260901-14-company-header-images-edit.md)).
- Uploading from the card. The grid shows; detail edits.
- The People grid, the Today view's rows, the command palette results, and
  every other place a company is named. Each is a separate judgement about
  whether an image helps there; none of them was asked for.
- Any change to `hue()` or `initials()`. They stay, as the fallback and as
  the accent the card already uses.

## Touches

- `electron/renderer/views/Companies.tsx` + `.css` + `.test.tsx`
- possibly a shared image-aware `CompanyMark`, if T-260901-14 established
  where it lives

## Acceptance

- [ ] A company with a banner renders it behind its card, faded by a
      gradient, with every existing element of the card still present and
      legible.
- [ ] A company with no banner renders the card unchanged from today —
      asserted by comparing rendered markup and computed background against
      the pre-change output.
- [ ] Card text meets its contrast requirement over both a fully white and a
      fully black test banner.
- [ ] The grid issues the read the ADR specified — asserted by counting
      channel calls for a 30-company fixture, so a per-card fetch cannot slip
      in unnoticed.
- [ ] The card's hover and focus states still read against a banner
      background; `:focus-visible` is still visible.
- [ ] `prefers-reduced-motion` is unaffected — the existing `translateY`
      hover is already covered, and no new animation is added.
- [ ] The list presentation shows logos and no banners.
- [ ] `npm run verify` passes.

## Risks

- **The read cost is the whole risk.** Thirty cards each pulling a full-size
  banner as a base64 `data:` URL is the failure ADR-015 exists to prevent,
  and it will be invisible on a seeded database with no images at all.
- A background image behind a card whose border already carries hover and
  focus state can swallow the focus ring. `ui-design.md` makes visible focus
  a v1 requirement.
- `.ccard` is a `<button>`. Adding a background layer must not change what is
  clickable or introduce a child that intercepts the click.
- Colour carries meaning in this app — "section, company, billing model,
  status — never decoration". A banner is decoration by nature; it must not
  end up competing with the cadence meter or the kind tag for the eye.
