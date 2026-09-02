---
id: T-260901-16
title: Retarget the popover layer when a second InfoPopover opens over the first
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

Found at T-260901-06's merge review. Under `LayerManager`, opening one
`InfoPopover` while another is open leaves the single `popover` layer
registered with the *first* trigger: the second popover's wrapper stops the
document `click` that would otherwise drop the layer (it has to — the same
click is the one opening it), and `openLayer` is a documented no-op for a
kind already on the stack, trigger write included. The first popover hides
itself on the outside pointerdown, the second shows, and Escape then calls
`closeLayer('popover')`, which returns focus to the *first* popover's button.

Reachable as soon as one view carries two: the Settings page after
[T-260901-09](T-260901-09-settings-rebuild.md) has a `ViewHeader` description
popover and a section popover on screen together. A focus-return misdirect,
not a broken control — the popover itself opens and closes correctly.

## Scope

**In:** whichever of these keeps the stack's invariants — decide in the task,
not here:

- `openLayer` accepts a retarget for a kind that is already open when the
  caller says so (a third argument, or a separate `retargetLayer`), so the
  second `InfoPopover` can claim the layer's trigger without the first Escape
  focusing a stale button; or
- `InfoPopover`, on opening while `layers.isOpen('popover')` is already true,
  drops the layer *without* focus return the way the document-click path
  does, and then opens it fresh with its own trigger — which needs a
  no-focus-return close the manager does not currently expose.

Either way, a test in `InfoPopover.test.tsx`'s "inside the layer stack" block:
two popovers under one manager, open A, open B, Escape → focus is on B's
button, A and B are both closed.

**Out:** anything about `menu`, `sheet`, `tour` or the palette; changing the
rule that only one `popover` layer exists.

## Touches

- `electron/renderer/components/shell/LayerManager.tsx` (+ test)
- `electron/renderer/components/shell/layer-manager-context.ts` — if the
  context gains a method
- `electron/renderer/components/primitives/InfoPopover.tsx` (+ test)

## Acceptance

- [x] Open A, open B, press Escape: `document.activeElement` is B's trigger.
- [x] The existing "re-opening is a no-op" contract for every other kind is
      unchanged — `LayerManager.test.tsx` passes unchanged.
- [x] `npm run verify` passes. (There is no `verify` script; the `verify`
      skill's constituent checks — typecheck, lint, covering tests, the full
      suite — were run instead.)

## Risks

- `closeLayer` deliberately focuses the trigger; a variant that does not is a
  second way to close a layer and needs the same care `LayerManager.tsx`'s
  header gives the document-click path.

---

## Outcome

**Changed:** `layer-manager-context.ts` gains `retargetLayer(kind, trigger)`;
`LayerManager.tsx` implements it (no-op unless `kind` is open; stack
untouched); `InfoPopover.tsx` calls it instead of `openLayer` when the layer
is already held, and resets its own `selfOpen` during render when the
manager drops the layer. Tests in `InfoPopover.test.tsx` (two, under a real
manager), `LayerManager.test.tsx` (two), and a stateful `isOpen` stub in the
registration test; `useGlobalShortcuts.test.tsx`'s context stub gains the
new member.

**Departed from scope:** Took the first option (a separate method). Added
one thing the brief did not name, found in review: a popover closed by
Escape or by ⌘K kept `selfOpen` true, so the next popover to register the
layer brought it back too — two panels on screen. Same mechanism, so it is
fixed here rather than as a follow-up. Residual: activating B from the
keyboard skips the pointerdown that hides A, so A stays visible until the
layer closes; focus is still returned to B.

**Not verified:** `npm run snap -- --routes settings` was run and read, but
the change has no pixels — it moves focus.

**Elapsed:** ~35 minutes.
