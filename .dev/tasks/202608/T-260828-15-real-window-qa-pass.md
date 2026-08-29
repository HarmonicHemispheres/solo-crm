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

---

## Progress — the machine-checkable half is merged (R-260828-03)

This task stays **open**. Two of its four acceptance criteria are met and on
`main`; the other two need a person at a real window, and are not claimed.

### Done, merged, and guarded by a test

**`A route present in AppRoutes but missing from ROUTE_META fails a test.`**
`routes.test.tsx` walked `ROUTE_META` and proved every entry resolved — one half
of an agreement, and the only half checked. A `<Route>` added to `AppRoutes`
alone, which is the ordinary way a view gets added, highlighted no nav item,
showed no breadcrumb, and **left every test green**. The guard now reads
`routes.tsx`'s own source and requires each declared path to have a `ROUTE_META`
entry, with three exclusions each stated in the code (`*` is a redirect,
`workspace` is a layout wrapper, an `index` route has no path attribute at all).

It imports the source through Vite's `?raw` rather than `node:fs`, because a
renderer module may not touch the filesystem and **blunting that rule to let a
test read a file would trade a real boundary for a convenience.** A sanity
assertion requires at least eleven declared paths, so a rename or a change in
how routes are written cannot turn the scan into a vacuous pass over nothing.

*Verified by mutation:* adding `<Route path="reports">` with no `ROUTE_META`
entry fails the new case and nothing else; removed, 20/20.

**`Tab never lands on an element that is not visible.`** Below 900px the rail
was `left: -250px` and nothing more — still in the document, still focusable, so
Tab walked into an invisible menu of eleven nav items and a footer. Fixed with
`visibility: hidden`, delayed past `--motion-rail` so the slide still runs, and
`visibility: visible` with no delay on `.rail.open` because a rail sliding *in*
must be focusable from the first frame.

`visibility` rather than `inert` or `display: none` because it is the only one
of the three that is animatable — the others would remove the tab stop and the
animation together.

*Verified by mutation:* removing `visibility: hidden` fails the new test.

**That mutation check is the reason this section can be trusted, because the
first version of the test passed with the fix removed.** The rule's own
explanatory comment contains the words `visibility: hidden`, so every assertion
was matching prose instead of a declaration. Comments are stripped now. This
project has hit that trap three times — a doc comment tripping
`connection.test.ts`'s Database-owner walk, the ADR-003 money guard needing the
same strip, and here.

### Not done — needs a person at a real window

- [ ] **A written pass/fail list against the mockup at 1440px, 900px and
      700px.** Layout, tokens actually applied, compared with
      `planning/solo-crm-mockup.html`.
- [ ] **No horizontal body scroll at any of the three widths, in a real
      window.** jsdom computes no layout, so nothing automated can answer this;
      a test that claimed to would be measuring nothing.

Also unexercised, and listed so it is not mistaken for covered: the keyboard
walk of the whole shell, and the layer-dialog role/focus-return/aria audit with
devtools. The jsdom tests assert what they can reach; a real window is where
`Esc`/`⌘K`/`⌘L` and focus return are actually seen.

**Boot it with `npm run dev`, or install the built artefact.** The rail fix is
the one to look at first — resize below 900px, close the rail, and Tab through
the page.
