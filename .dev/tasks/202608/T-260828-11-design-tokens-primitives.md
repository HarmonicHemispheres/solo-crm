---
id: T-260828-11
title: Lift tokens.css from the mockup and build the shared primitives
status: in-progress
category: ui
plan_ref: P0-09
created: 2026-08-28
closed:
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

*Appended at close. Delete this heading if the task is dropped.*
