---
id: T-260828-15
title: Real-window QA pass — focus rings, rail `inert`, breakpoints, route-meta guard
status: open
category: ui
plan_ref: P0-10
created: 2026-08-28
closed:
---

## Why

Run R-260828-01 proved that jsdom certifies structure, not paint: T-260828-11
shipped a design system that was green in tests while never imported at
runtime, and T-260828-12's blocking defect (palette painting under the
sheet's scrim) was invisible to every DOM assertion. Both tasks closed with
items that only a real window can check. This task is that window, before
the P1-1x view tasks start building on top of whatever it finds.

## Scope

**In:**

- Boot the built app (`ELECTRON_RUN_AS_NODE` unset) and compare against
  [planning/solo-crm-mockup.html](../../../planning/solo-crm-mockup.html)
  at 1440px, 900px and 700px: layout, tokens actually applied, no
  horizontal body scroll — T-260828-12's acceptance line checked for real.
- Keyboard walk of the whole shell: visible focus rings on every stop, rail
  reachable by Tab and activating on Enter, Esc/⌘K/⌘L behaving as the jsdom
  tests claim.
- The below-900px off-canvas rail is currently `left:-250px` with no
  `visibility`/`inert` — Tab walks into an invisible menu (T-260828-12
  review nit). Confirm in-window, then fix with `inert` (or
  `visibility: hidden` delayed past the transition) without breaking the
  slide animation.
- Make the `ROUTE_META` ↔ `AppRoutes` agreement test bidirectional — today a
  route added to `AppRoutes` alone highlights no nav item with every test
  green (T-260828-12 review nit).
- Layer dialogs: role, focus-return and aria audited with devtools, not
  only testing-library queries.

**Out:** Fixing any *view* content — there is none yet. Restyling anything
that matches the mockup. Automated visual-regression tooling (worth its own
decision if this pass finds enough).

## Touches

- `electron/renderer/components/shell/Rail.css` — the `inert`/visibility fix
- `electron/renderer/routes.test.tsx` — the bidirectional guard
- Whatever the pass finds, each as its own small commit

## Acceptance

- [ ] A written pass/fail list against the mockup at all three widths, filed
      in this task's Outcome
- [ ] Tab never lands on an element that is not visible
- [ ] A route present in `AppRoutes` but missing from `ROUTE_META` fails a test
- [ ] No horizontal body scroll at 1440px, 900px or 700px, in a real window

## Risks

- A screenshot pass with no checklist degrades into "looks fine". The
  mockup is the checklist; every deviation is either fixed or written down
  as deliberate, nothing in between.
- Real-window Electron boots flaked under load during R-260828-01; run this
  serially, not alongside another build.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
