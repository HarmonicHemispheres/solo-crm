---
id: T-260901-16
title: Retarget the popover layer when a second InfoPopover opens over the first
status: open
category: ui
created: 2026-09-01
closed:
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

- [ ] Open A, open B, press Escape: `document.activeElement` is B's trigger.
- [ ] The existing "re-opening is a no-op" contract for every other kind is
      unchanged — `LayerManager.test.tsx` passes unchanged.
- [ ] `npm run verify` passes.

## Risks

- `closeLayer` deliberately focuses the trigger; a variant that does not is a
  second way to close a layer and needs the same care `LayerManager.tsx`'s
  header gives the document-click path.
