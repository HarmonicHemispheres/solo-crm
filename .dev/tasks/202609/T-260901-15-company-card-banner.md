---
id: T-260901-15
title: Carry a company's banner onto its card, behind a gradient
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
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

## Outcome

Merged into `main` from branch `T-260901-15` (builder `924686a`, nothing
changed at merge). Seven files — the three the scope named, a new
`Companies.css.test.ts`, and one-line carve-outs in `tsconfig.web.json`,
`tsconfig.node.json` and `eslint.config.js` for it.

**The read.** One `companyImages:thumbnails` call per view mount (ADR-015),
held outside `isLoading`/`loadError` so the grid paints on `companies:list`
and a missing or failed thumbnail never holds or replaces the list. The
same map feeds the card and the table row; the test asserts exactly one
call for 30 rows and still one after switching presentation. The measured
cost at 60 companies the ADR asked for could not be taken — the seeded
database has no images and the builder's tree had no write path — so the
outcome records the property the number depends on (the call count) and
the ADR's own estimate (~1.5 MB of derivatives against ~84 MB of originals).

**The card.** `.ccard.has-banner` adds a `.ccard-wash` sibling at
`z-index: -1` in the button's own stacking context, `aria-hidden` and
`pointer-events: none`, so the card stays one button with one accessible
name. A company with no banner renders the bare `ccard` and no extra child
— byte-identical to before. `CompanyMark` is image-aware locally and takes
the URL as a prop, no read of its own; the table row gets the logo in its
26px mark and no banner.

**Legibility as a number, not a hope.** The wash is capped at 16% at the
top edge and gone by 44% of the card's height; the lower half sits on
opaque `--surface`. At that cap `--papyrus` measures 9.0:1 over a white
banner and 15.0:1 over black; `--faint` (the metadata line's colour today,
already only 3.0:1 on a bare card) would fall to 1.9:1, so
`.ccard.has-banner .top .meta` steps up to `--mute` (5.3:1 / 8.9:1) — the
one visual change to an existing element, and only under a banner.
`Companies.css.test.ts` reads the gradient's own stops and does the WCAG
arithmetic, following `tokens.test.ts`/`base.test.ts`/`Rail.test.ts`'s
pattern, because Vitest runs `css: false` and an imported stylesheet is an
empty module in jsdom. The wash is subtle by construction; whether 16% is
enough to *read* as the company's banner is a taste call for the running
app.

**Review.** Six mutants — every card claiming a banner, the wash reading
the logo slot, the card and the row each never showing a logo, the
thumbnails read ignored, and `--mute` reverted to `--faint` under a
banner — all died; the builder's own gradient-stop mutant (84% → 60%
coverage) had already turned the contrast test red. At merge: three tsc
projects, `eslint .`, the Companies tests and the catch-all project.

**Not eyeballed** in the running app; the 1px fixtures the tests use say
nothing about how a real banner looks at 16%.
