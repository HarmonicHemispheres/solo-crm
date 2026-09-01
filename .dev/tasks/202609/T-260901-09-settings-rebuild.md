---
id: T-260901-09
title: Rebuild Workspace Settings as a section rail over one vertical page
status: open
category: ui
created: 2026-09-01
closed:
---

## Why

Workspace Settings is seven cards in a `repeat(auto-fit, minmax(340px, 1fr))`
grid. Which card sits where depends on the window width, so nothing is where
it was last time, and the page reads as a pile rather than a structure. Every
card also ends in a `p.meta.settings-foot` paragraph — several of them four or
five lines — explaining behaviour that the controls above them mostly make
obvious. Two complaints, one cause: the page has no hierarchy and compensates
with prose.

[T-260901-03](T-260901-03-settings-layout-decision.md) settles what replaces
it — the section set, their order, the responsive behaviour, whether Data
joins them, and which footers move behind an info affordance. **This task
builds that decision and does not make it.** It cannot start until the ADR
lands.

## Scope

**In:**

- The layout the ADR specifies: a secondary rail listing the page's primary
  sections, and a content area that is one vertical page per section, in place
  of `.settings-grid`.
- Every control that exists today keeps working and keeps writing the same
  key through the same `settings:set` channel. **No setting is added, removed
  or renamed**, and the reads still come from the one `settings:getAll`
  snapshot — there is no second store (ADR-002).
- The prose the ADR assigned to an info affordance moves into
  [T-260901-06](T-260901-06-info-popover-primitive.md)'s `InfoPopover`, with
  an `aria-label` naming its section rather than "About this view".
- The prose the ADR assigned to stay visible **stays visible**. Specifically,
  the two captions that exist to satisfy T-260828-38's acceptance — "a panel
  whose behaviour hasn't landed elsewhere … says so plainly rather than
  storing a value and implying an effect" — are the cadence defaults (no
  effect on any company until P2-02) and the backup folder (no picker until a
  main-process dialog channel exists). Both keep an in-flow caption.
- Keyboard operation: the section rail is navigable by keyboard, the current
  section is programmatically current (not colour alone), and focus order
  follows reading order. `ui-design.md` makes this a v1 requirement, not
  polish.
- Whether the selected section survives a reload: if it should, it uses the
  `settings` table like `view.companies.mode` does, not `localStorage`.
  ADR-002 already rejected `localStorage` for this class of state.

**Out:**

- Moving `/workspace/data` into this page, or removing its nav item — even if
  the ADR decides it should happen. That changes `nav.ts`, `ROUTE_META`, the
  breadcrumb and `routes.test.tsx`'s table agreement, and it is a routing
  change, not a settings-layout change. File it as its own task if the ADR
  says yes.
- The Data view's own layout. Its two colourless buttons are
  [T-260901-01](T-260901-01-button-variant-required.md).
- Any new setting, including anything for P2-02, P4-08 or X-04.
- Redesigning `Card`, `Toggle`, `.setrow`, `.switch`, `.steps` or `.stepb`.
  The controls are fine; their arrangement is not.

## Touches

- `electron/renderer/views/WorkspaceSettings.tsx`
- `electron/renderer/views/WorkspaceSettings.css`
- `electron/renderer/views/WorkspaceSettings.test.tsx`
- possibly `electron/shared/settings.ts` — only if the ADR chose a persisted
  section key

## Acceptance

- [ ] Every key `SettingsSnapshot` declares still has a control on the page,
      and changing each one still round-trips through `settings:set` —
      asserted per key, so a control lost in the rearrangement fails a test
      rather than going unnoticed.
- [ ] The sections and their order match the ADR exactly.
- [ ] No `p.meta.settings-foot` paragraph over one line survives, except the
      two the ADR named — asserted by finding those two by their text and
      asserting nothing else of that class renders more than a line.
- [ ] The cadence card still states that changing a default moves no company
      until P2-02, in the flow, without a click.
- [ ] Every info popover has an `aria-label` that names its section, and none
      of them says "About this view".
- [ ] The section rail is reachable and operable by keyboard alone, and the
      active section is exposed to assistive technology by something other
      than colour.
- [ ] The page works from a maximised window down to ~700px with no
      horizontal page scroll, and the ADR's stated behaviour at the 900px
      breakpoint is what happens.
- [ ] `prefers-reduced-motion` removes any section transition without
      removing the section change.
- [ ] `npm run verify` passes.

## Risks

- **Losing a control in the move.** Seven cards hold roughly fifteen
  controls. The per-key acceptance above exists because "it looks like
  everything is there" is exactly how one goes missing.
- **Reversing T-260828-38's honest-caption decision.** Moving all the prose
  behind popovers is the obvious reading of "put descriptions in info popups"
  and it silently un-does a criterion that was met on purpose. The two
  exceptions are load-bearing.
- The mockup is the authoritative visual spec and this view now departs from
  it. If the ADR's annotation of `planning/solo-crm-mockup.html` did not land,
  this change is indistinguishable from drift to the next person.
- `WorkspaceSettings.css`'s header documents which selectors it borrows from
  `CompanyDetail.css` and `components/sheets/fields.css` rather than
  redeclaring, and relies on `routes.tsx` importing those views eagerly.
  Restructuring this file can quietly break that assumption.
- `BrandingCard` is the one card here that reads no setting at all — it goes
  through `branding:get`/`choose`/`clear`. It must not be folded into the
  settings snapshot on the way past.
