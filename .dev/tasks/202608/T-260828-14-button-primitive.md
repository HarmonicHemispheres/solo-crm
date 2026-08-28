---
id: T-260828-14
title: Fold the shell's raw `.btn` classes into a Button primitive
status: in-progress
category: ui
plan_ref: P0-09
created: 2026-08-28
closed:
---

## Why

T-260828-11 shipped the shared primitives without a Button — the mockup's
`.btn` / `.btn-prim` / `.btn-ghost` styles landed as `buttons.css`, applied
by class name. T-260828-12's shell already repeats those raw class strings in
three places (both sheet footers and the New menu trigger), and every view
task from P1-08 onward adds more. A class string is invisible to typescript:
`btn btn-prm` fails silently, and a mockup restyle means a grep, not an edit.
Review of both tasks flagged this; this task is the recorded follow-up.

## Scope

**In:**

- A `Button` primitive in `electron/renderer/components/primitives/` typed
  over the variants the mockup actually has — primary, ghost, and the bare
  `.btn` default — forwarding the native button props (`type`, `disabled`,
  `onClick`, `aria-*`).
- Replace every raw `.btn` usage in the shell (LayerManager sheet footers,
  NewMenu trigger, any other) with it. `git grep 'btn '` over
  `electron/renderer` ends up matching only `buttons.css` itself.
- `buttons.css` stays the single styling source, colocated with the
  primitive the way the other primitives own their css.

**Out:** New variants, sizes or icon-button forms the mockup does not have —
the nav-group rule applies to the design system too. Any view content.

## Touches

- `electron/renderer/components/primitives/Button.tsx` — new, plus test
- `electron/renderer/components/shell/{LayerManager,NewMenu}.tsx`
- `electron/renderer/components/shell/buttons.css` — moves beside the primitive

## Acceptance

- [ ] No raw `.btn` class string outside the css file itself
- [ ] Variants are a closed union — a typo'd variant fails `tsc`, not renders
      unstyled
- [ ] The rendered markup is class-for-class what the mockup produces (the
      existing shell tests keep passing unmodified is the proof)

## Risks

- The moment Button exists, the temptation is a `size`/`intent` matrix the
  mockup never had. The variant union is closed until a mockup change opens it.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
