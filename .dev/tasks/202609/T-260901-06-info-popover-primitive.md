---
id: T-260901-06
title: Extract ViewHeader's info popover into a primitive anything can use
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

The settings rebuild needs an info affordance beside individual sections and
rows, so the explanatory prose that currently runs three to five lines under
every card can move behind it.

The app already has exactly that control and cannot reuse it. `ViewHeader`
owns `.info` / `.pop` — the mockup's own info button and popover, transcribed
in `ViewHeader.css`'s first line — with its outside-pointerdown and Escape
handling, `aria-expanded`, and a `useId`-generated popover id. But it is
reachable only through `ViewHeader`'s `description` prop, so the only place
in the app that can have one is a view's top-level heading.

Extracting it is the smaller half of the settings work, it is independently
reviewable, and it is the piece a second consumer would otherwise copy.

## Scope

**In:**

- `components/primitives/InfoPopover.tsx` + `.css` + `.test.tsx`, holding the
  `.info` button, the `.pop` panel, the open/close state, the
  outside-pointerdown and Escape listeners, and the `aria-expanded` /
  `aria-controls` wiring — moved out of `ViewHeader.tsx`, not duplicated.
- `ViewHeader` renders it for its `description` prop. **`ViewHeader`'s
  public API does not change** and neither does its rendered markup or class
  names — `.vhead`, `.info-wrap`, `.info`, `.pop` all stay, so no view is
  touched and `ViewHeader.test.tsx`'s existing assertions still hold.
- An `aria-label` prop, because "About this view" is wrong for a row-level
  popover. `ViewHeader` passes its existing string; a caller labelling one
  beside "Default cadence" passes something that names the section.
- **Escape must not fight the layer stack.** `layer-manager-context.ts`
  declares a `popover` layer kind and its comment says it "exists so a future
  `.info` popover can register with this same stack — nothing in this task
  opens one". This is that future. Decide whether the primitive registers,
  and record the reason: `LayerManager` owns Escape for every layer precisely
  so one keypress does not close two things, and a popover open over a sheet
  is the case that decides it. If it does not register, say what happens when
  a popover is open inside an open sheet.

**Out:**

- Any change to what `ViewHeader` renders or which views pass `description`.
- Using it anywhere. [T-260901-09](T-260901-09-settings-rebuild.md) is the
  first consumer and lands after this; a primitive with no caller is fine at
  this seam and is the reason this is its own task rather than a step inside
  the rebuild.
- A tooltip. This is a click-to-open popover with a dismissible panel, not a
  hover hint — hover does not exist on touch and `ui-design.md` makes that a
  contract.

## Touches

- `electron/renderer/components/primitives/InfoPopover.tsx` (new)
- `electron/renderer/components/primitives/InfoPopover.css` (new)
- `electron/renderer/components/primitives/InfoPopover.test.tsx` (new)
- `electron/renderer/components/primitives/ViewHeader.tsx`
- `electron/renderer/components/primitives/ViewHeader.css` — `.info`/`.pop`
  rules move out; `.vhead`/`.vicon` stay
- `electron/renderer/components/shell/layer-manager-context.ts` — only if the
  popover registers

## Acceptance

- [ ] `ViewHeader.test.tsx` passes **unchanged**, including its existing
      assertions about the info button and popover.
- [ ] Every view that passes `description` renders the same DOM as before —
      checked by diffing rendered markup in a test, not by looking.
- [ ] The popover opens on click, closes on Escape, closes on a pointerdown
      outside it, and does not close on a pointerdown inside it.
- [ ] `aria-expanded` tracks the open state and `aria-controls` names the
      panel's id.
- [ ] Two popovers rendered on one page keep independent ids and independent
      open state.
- [ ] Focus returns to the trigger button when the popover closes by Escape.
- [ ] `npm run verify` passes.

## Risks

- Moving CSS between files silently changes cascade order. `.info`/`.pop`
  currently arrive with `ViewHeader.css`; landing them in a file imported
  later or earlier can change which rule wins. Check the rendered look, not
  just the tests.
- The layer-stack question is the one that can be got wrong quietly: an
  Escape handler added here that does not consult `isTopmost` will close a
  popover *and* the sheet behind it, which is the exact failure
  `layer-manager-context.ts`'s header describes and `Sheet`'s
  `closeOnEscape={false}` exists to avoid.
- `ui-design.md`'s "icon buttons by default … icon-only controls need an
  `aria-label`" applies to every instance of this primitive, so the label
  must be required, not optional with a default.

## Outcome

**Changed:** 6 files — `primitives/InfoPopover.tsx` / `.css` / `.test.tsx`
(new; 14 tests), `ViewHeader.tsx` (renders `<InfoPopover aria-label="About
this view">`, public API and markup unchanged), `ViewHeader.css` (`.info`
/ `.pop` rules moved out; `.vhead` / `.vicon` stay), and the `popover`
comment in `layer-manager-context.ts`.

**Decided:** the primitive **registers** with the layer stack
(`openLayer('popover', trigger)`) and installs no Escape listener of its own
while a provider is above it — `LayerManager` owns Escape so one keypress
closes one thing; a popover inside an open sheet stacks `['sheet',
'popover']`, the first Escape closes the popover and returns focus to its
trigger, the second closes the sheet (asserted). Standalone (no provider —
`ViewHeader.test.tsx`'s bare mount) it keeps its own Escape and focus
return. Visible open state is `selfOpen && layers.isOpen('popover')`, so the
palette opening over it (`CLOSES_MENU_AND_POPOVER`) hides it with no sync.
The `.info-wrap` span stops click propagation so the manager's document
click dismisser does not drop the layer the same click opened.

**Review:** passed. Five mutants against `InfoPopover.test.tsx` +
`ViewHeader.test.tsx`: layer registration removed, standalone gate removed
from the Escape effect, `open` ignoring the manager, `stopPropagation`
removed, inside/outside check inverted — every one red. `ViewHeader.test.tsx`
is byte-identical to `main`'s and passes; the byte-for-byte markup test
covers the "same DOM as before" criterion.

**Found, filed as [T-260901-16](T-260901-16-popover-layer-retarget.md):**
under a manager, opening popover B while A is open leaves the `popover`
layer holding A's trigger (`openLayer` is a no-op for an open kind, and B's
wrapper stops the click that would have dropped it), so Escape then focuses
A's button. Not reachable until a view carries two popovers — T-260901-09's
settings page will — and a focus-return misdirect rather than a broken
control, so it does not block this merge.
