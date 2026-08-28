---
id: T-260828-11
title: Lift tokens.css from the mockup and build the shared primitives
status: done
category: ui
plan_ref: P0-09
created: 2026-08-28
closed: 2026-08-28
---

## Why

The mockup is one 149 KB HTML file that renders every view. Ported view by view,
its CSS gets copied into each component and the design system stops existing —
at which point `ui-design.md`'s instruction to *use the tokens rather than
literal values* has nothing to point at.

Every view task from P1-11 onward assumes these components exist. This is the
task that decides whether Phases 2–5 are pleasant or grim.

## Scope

**In:**

- `tokens.css` — the mockup's `:root` block lifted **verbatim**: colour, type
  scale, radii, spacing, motion timings. Same names, same values. It is the
  authoritative visual spec and this is a transcription, not an interpretation.
- The primitives the mockup uses across more than one view:
  `Card` (with header slot and count chip), `Row`, `Stat` (including the gold
  hero variant), `Tag`, `ModelTag`, `Ring`, `DecayMeter`, `Toggle`, `Chip`,
  `Sheet`, `Toast`, `QuickAdd`, `ViewHeader`, `IconButton`, `EmptyState`.
- Icons as inline SVG on `currentColor`, taken from the mockup. No icon font, no
  package for three glyphs. `IconButton` requires an `aria-label` — make it a
  required prop so it cannot be forgotten.
- The mockup's breakpoint behaviour as shared rules: 900px rail off-canvas and
  two-column sheets collapse; 700px hover-revealed row actions stay visible.
- `prefers-reduced-motion` handled once, here: animation removed, final state
  kept. The mockup already does this for decay bars and value bars — carry the
  rule, not just the outcome.

**Out:** The app shell that arranges them (T-260828-12). Any view. The
`countUp` number animation, unless it falls out of `Stat` naturally — it belongs
with the view that uses it. Storybook or a component gallery.

## Touches

- `electron/renderer/styles/tokens.css` — new
- `electron/renderer/styles/base.css` — reset, focus rings, scrollbars
- `electron/renderer/components/primitives/*` — one file per primitive
- `electron/renderer/components/icons.tsx`
- `eslint` config — the no-literal-colour rule

## Acceptance

- [ ] Every custom property in the mockup's `:root` exists in `tokens.css` with
      an identical value — diffed mechanically, not by eye
- [ ] No component file contains a hex colour, `rgb()` or `hsl()` literal,
      enforced by a lint rule that fails `npm run lint`
- [ ] Changing `--verdigris` in `tokens.css` moves every surface using it
- [ ] `Ring` and `DecayMeter` render at their final width under
      `prefers-reduced-motion: reduce`, with no animation — the meaning survives
      the motion being removed
- [ ] `IconButton` does not compile without an `aria-label`
- [ ] Every primitive is keyboard-operable with a visible focus ring against the
      obsidian ground
- [ ] Rendering the primitives at 1440px, 900px and 700px produces no horizontal
      body scroll

## Risks

- **Transcription drift.** Values retyped rather than copied land one hex digit
  or one pixel out, and it is invisible until two surfaces sit side by side.
  Extract the `:root` block programmatically and diff it.
- **Building primitives without a consumer produces the wrong abstraction.** The
  mockup is the consumer — check each primitive against every place it appears
  there, not against the first one. `Card` in particular varies: header with
  count, header with actions, header with legend.
- Scope creep toward a component library. The list above is closed; a primitive
  used in exactly one view belongs in that view.
- `ui-design.md` says gold marks exactly one hero value per view. If `Stat`'s
  hero variant is easy to apply, it will be applied twice on some view later —
  worth a comment on the prop, since nothing can enforce it.
- The mockup uses `color-mix()` in several places. Check Electron's Chromium
  version supports it before assuming, and note the fallback if not.

---

## Outcome

Merged to main in `a860735` (run R-260828-01). `tokens.css` + `base.css`, all
15 primitives, inline SVG icons on `currentColor`, and a local
`no-literal-colour` eslint rule covering both TS and CSS (tokens.css the sole
exemption; proven to fire, not vacuous). The token diff is a **standing test**
— `tokens.test.ts` re-extracts the mockup's `:root` on every run and asserts
all 23 properties verbatim.

A finding about the mockup itself: its `:root` holds only colours, two font
stacks and `--rail` — no type/spacing scale exists to lift. Radii, motion
timings and shadows recur as closed sets and became clearly-labelled derived
tokens; font sizes stay per-component literals, as bespoke as the source.

Review: 2 blocking + 7 should-fix, all applied at merge. The blocking one is
the cautionary tale: **nothing imported tokens.css/base.css — the entire
design system was dead at runtime while all 73 jsdom tests passed** (jsdom
loads no stylesheets). Also fixed: Sheet focus effect re-firing on every
parent render (untypable forms), Ring radius drift (`size/2-3` per the mockup,
with the test restating the formula independently), undefined `--radius-sm`
reference, sheet max-height double-count, dropped `.sheet-f .note` styles,
QuickAdd icon hardcoding a stroke, and NaN cadence rendering as healthy —
non-finite pct now renders maximally stale per ADR-001, tested. Merge needed
three mechanical conflict resolutions against T-04/T-08 (tsconfig unions,
eslint CSS block + `JS_TS_FILES` scoping). Verify after everything: lint,
both typechecks, 137/137 tests, build — green.

Follow-ups recorded, not blocking:
- **No Button primitive.** The mockup's `.btn`/`.btn-prim`/`.btn-ghost` are
  used in Sheet footers and EmptyState actions, but Button wasn't in the
  closed list. Needs a scope before the first view task ships a styled button.
- Nits deferred: Toast timer keyed on message value; scrim closes on a
  text-drag released outside; `--bp-*` tokens can't drive media queries
  (breakpoints hardcoded twice with sync comments).
- Two acceptance items are code-review-verified only (no layout engine in
  jsdom): visible focus rings, no horizontal scroll at 1440/900/700. First
  real-app screenshot pass should confirm.
