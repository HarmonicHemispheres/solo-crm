---
id: T-260828-53
title: Restore the focus ring in the sheets, and close wave D's UI review findings
status: done
category: ui
plan_ref:
created: 2026-08-28
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Consolidated should-fixes from T-260828-27, -28 and -29, merged non-blocking so
the run could keep moving. One of them is an accessibility regression and should
be treated as the reason this task exists; the rest are real but smaller.

**`.inp { outline: none }` suppresses the app's global keyboard focus ring on
every input, date field, select and textarea in all four create sheets.** The
reviewer verified this against the production bundle rather than inferring it:
`base.css`'s `:focus-visible { outline: 2px solid var(--verdigris) }` sits at byte
6064 and `.inp` at 12404, so the later rule wins. X-06 requires focus visible on
every interactive element against the obsidian ground, and
`.claude/rules/ui-design.md` makes it binding. Right now a keyboard user filling
in the engagement form cannot see where they are.

The second theme is that several acceptance criteria named their own assertion
method and the tests did not use it — the same "exercises the mechanism, never
the integration" pattern that has now appeared throughout this run.

## Scope

**In:**

1. **Restore the focus ring.** Remove or scope `.inp { outline: none }` so
   `:focus-visible` wins on every field in all four sheets. Add a test that
   fails if the ring is suppressed again.
2. **Field-level validation errors.** T-260828-27's scope says errors "render
   against the field that caused them"; they currently render as one banner at
   the top naming the *database column* — a user typing `$28,500` into Contract
   value sees `contractValueCents: "$28,500" is not a valid amount`. Map the zod
   issue path to the field and render it there, with the field's own label.
3. **Test the acceptance criteria as written.** Criteria 1 and 6 of T-260828-27
   say "reading the row back over IPC after a save, field for field" and
   "verified on the raw column"; all four suites instead assert an outbound
   payload against a `vi.fn()` stub that accepts anything. At least the
   engagement sheet should round-trip against a real migrated database, since
   that is where `ends_on` NULL and the model-specific union actually matter.
4. **Two surviving mutants**, both guarding real paths:
   - replacing `billedViaCompanyId: billsDirectly ? null : billedVia || null`
     with `billedVia || null` keeps all four CompanySheet tests green — the
     guard covers picking a billing partner and then switching "Who invoices"
     back to direct;
   - deleting the `if (mutation.isPending) return` double-submit guard leaves
     every sheet suite green. It was added at review to stop a fast double-Enter
     inserting two rows, and PersonSheet is where it matters.
5. **A partial-failure hole in PersonSheet**: when `people:create` succeeds and
   `people:addAffiliation` then fails, the person row is committed but nothing
   invalidates the people cache, because `invalidate` only runs in
   `useSheetMutation`'s `onSuccess`. Retrying works; cancelling leaves a real
   person invisible until reload.
6. **From T-260828-28**: the presentation toggle uses text labels where the
   mockup uses icon buttons (`VIEWTOG`, mockup line ~1465), and
   `handleModeChange` writes the new mode into the query cache optimistically
   with no `onError`, so a failed `settings:set` leaves the optimistic value in
   place with the stored value disagreeing.
7. **From T-260828-29**: ADR-001's never-contacted guard is untestable as
   written — replacing `cadenceState`'s `lastTouchAt == null` branch with
   `{ pct: 0, label: 'never' }` renders a never-contacted company as a green
   "ok" bar and no test notices. Also: `companiesById` is built only from the
   list query, which has no pending gate or error branch, while the body renders
   as soon as the detail query resolves — the three IPC calls race.

**Out:** Anything cosmetic that is not in a review finding. Restyling the sheets.
The mockup-fidelity nits recorded in T-260828-28's outcome (default sort order,
global class names) unless they fall out of item 6 for free.

## Touches

- `electron/renderer/components/sheets/` — `fields.css` and the four sheets
- `electron/renderer/views/Companies.tsx`, `CompanyDetail.tsx`
- The corresponding test files

## Acceptance

- [ ] Tabbing through every field of all four sheets shows a visible focus ring,
      and a test fails if `outline: none` is reintroduced on `.inp`
- [ ] A bad Contract value renders its error **against the Contract value field**,
      labelled as the user sees the field, not as a column name
- [ ] At least one sheet round-trips through a real migrated database and asserts
      the stored columns, including `ends_on` being NULL when left empty
- [ ] Both surviving mutants now fail: the `billsDirectly` guard and the
      double-submit guard each have a test that goes red without them
- [ ] A failed `addAffiliation` after a successful `people:create` leaves the
      people list showing the new person
- [ ] A failed `settings:set` on the presentation toggle rolls the optimistic
      cache value back
- [ ] A never-contacted company does not render as "ok", and a test fails if it
      does
- [ ] Company detail does not render its body against a half-loaded companies
      list

## Risks

- **Removing `outline: none` and reintroducing the double ring it was there to
  hide.** If the rule exists because a browser default ring looked wrong,
  scope it to `:focus:not(:focus-visible)` rather than deleting it outright.
- **Testing the focus ring by asserting a class name.** The finding was proven
  against the built bundle's cascade order; a test that checks a class would
  pass while the cascade still loses.


---

## Outcome

Merged, then one review finding fixed on top of the merge. Built by a subagent
under the build-only process; reviewed, corrected and verified by the
orchestrator at merge.

**Changed:** the four create sheets and their tests, `fields.css`,
`fields.test.ts` (new), `field-errors.ts` (new), `Field.tsx`,
`useSheetMutation.ts`, `views/Companies.{tsx,css,test.tsx}`,
`tests/integration/engagement-sheet-roundtrip.test.ts` (new),
`tsconfig.integration.json` (new), `tsconfig.{web,node}.json`, `package.json`,
`eslint.config.js`.

### The accessibility regression this task exists for

`.inp { outline: none }` was ported verbatim from the mockup and suppressed the
app's global keyboard focus ring on every input, date field, select and textarea
in all four create sheets — `base.css`'s
`:focus-visible { outline: 2px solid var(--verdigris) }` has the same specificity
as a bare `.inp`, and this stylesheet is applied later, so the later rule won.
X-06 requires focus visible on every interactive element and
`.claude/rules/ui-design.md` makes it binding.

**Fixed by scoping, not deleting.** What the mockup was suppressing is the ring a
*pointer* click leaves behind, and `:focus:not(:focus-visible)` names exactly
that state. Keyboard focus matches `:focus-visible` and never this rule, so it
keeps `base.css`'s ring; a mouse click still gets the quiet treatment the mockup
wanted.

`fields.test.ts` resolves the cascade the way a browser does — specificity, then
source order, across both stylesheets — rather than asserting a class name.
**A class-name assertion would have passed against the defect**, which is the
whole reason the regression survived review the first time.

### Review finding, fixed at merge

`tsconfig.integration.json` claimed to typecheck one named file. It compiled
**116**. `extends` inherits `tsconfig.web.json`'s `include`, and `files` unions
with it rather than replacing it, so the new third typecheck pass recompiled the
entire renderer with Node types on the side. Nothing went *unenforced* — the web
pass still runs without Node types, so a renderer file importing `node:fs` still
fails there — but `npm run typecheck` was doing the renderer twice.

Setting `"include": []` narrowed it to 35 files and immediately surfaced a second
thing: `electron/renderer/window.d.ts` is an ambient augmentation nothing
imports, and the broad glob had been picking it up **by accident**. It is now
named in `files`, so the dependency is explicit rather than lucky. Both
constraints are commented in the file.

### The rest

Item 2 moved validation messages beneath the control that caused them —
`useSheetMutation` now carries a `{ field, message }` pair instead of a string,
and each sheet passes its own label table. Only keys with a `Field` that renders
`errorFor` belong in those tables; a key listed without one would put its message
on a control that never displays it.

**Verified at merge:** `npm run typecheck` clean across all three passes;
`npm run lint` clean; `renderer` + `catch-all` projects 49 files / 379 tests
green on the merged tree, with the review fix applied.

Every new guard was checked against its mutant by the builder, applied and
reverted: reintroducing `.inp { outline: none }` fails the cascade test;
deleting `PersonSheet`'s `if (mutation.isPending) return` fails the double-submit
test; replacing Companies' `optimisticUpdate` with the old
`setQueryData`+`onSuccess` fails the rollback test.

## Left for whoever owns CompanyDetail

Two acceptance bullets could not be closed here because they live in
`views/CompanyDetail.tsx`, which another task owned this wave: the
`cadenceState` never-contacted guard, and the `companiesById` three-query race
that lets the detail body render against a half-loaded companies list. **The
equivalent never-contacted hole in `Companies.tsx` is closed** (its card now
asserts the meter renders `late`, not `ok`), but the detail view still has both.
Carried into the run summary rather than left in a builder's report — see
[T-260828-50](T-260828-50-links-ui.md), which owns that file next.

## A config decision worth knowing about

The round-trip test is renderer code and main-process code at once, which
`local/no-renderer-node-access`, `tsconfig.web` (no Node types) and
`tsconfig.node` (no DOM/JSX) each forbid inside `electron/renderer/**`. Rather
than add it to the lint rule's ignore list — **that would blunt a real
boundary** — it lives in a new top-level `tests/integration/`, is collected by
vitest's existing `catch-all` project, and runs under jsdom via a
`@vitest-environment` docblock. It uses `createElement` rather than JSX because
no tsconfig above `tests/` sets a JSX transform.
