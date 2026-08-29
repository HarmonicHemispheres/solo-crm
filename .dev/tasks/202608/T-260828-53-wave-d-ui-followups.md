---
id: T-260828-53
title: Restore the focus ring in the sheets, and close wave D's UI review findings
status: in-progress
category: ui
plan_ref:
created: 2026-08-28
closed:
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
