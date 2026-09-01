---
id: T-260901-11
title: Build the Offerings view
status: done
category: ui
plan_ref: P3-07
created: 2026-09-01
closed: 2026-09-01
---

## Why

`/offerings` is a nav item, a route, a breadcrumb — and
`<h1>Offerings</h1>`. `routes.tsx` still points it at `ViewPlaceholder`, whose
own comment says each later task "replaces one of these with its real view".
This is that task for offerings. Nothing can be created, edited, archived or
categorised there today, which is what was reported.

The dev seed already writes five categories and nine offerings with versions,
so this view has real records to render the day the channels land — the data
has been sitting behind a placeholder since the schema was written.

## Scope

**In:** §6.5's surface, against
[T-260901-07](T-260901-07-offerings-ipc.md)'s channels.

- The list, with each offering's name, type, category, billing model, unit
  and current rate. `ui-design.md`: numbers take a unit, not a sentence; a
  rate is money and follows `CONVENTIONS.md`'s money representation.
- Filter by all / services / products, and by category.
- Create, edit and duplicate an offering; create, rename and delete a
  category. A category that holds offerings is refused with the repository's
  own reason shown, not swallowed.
- **Archive, never delete.** Archived offerings are hidden by default and
  reachable through a filter, and the view never offers to delete one.
- Quick-add parsing: `Name, 4500` → fixed, `Name, 4500/mo` → monthly
  retainer, `Name, 175/hr` → hourly T&M. There is a `QuickAdd` primitive
  already; use it rather than a second input.
- The card/list view-mode toggle only if §6.13's persistence
  (`view.offerings.mode`) comes with it — Companies and People both do this
  through the settings table and a third pattern here would be the drift.

**Out:**

- **Changing a price.** §6.5 makes it a distinct action that closes the
  current version and appends the next with an effective date, and P3-08 is
  the sheet that does it, after P3-02 builds the versioning. Neither exists.
  So: **price is not editable anywhere in this view** — creating an offering
  sets its first version's rate and that is the only place a rate is written.
  A disabled "Change price" control with an honest caption is acceptable and
  matches how the backup folder is handled in settings; a working one is out
  of scope and would write a version without the semantics.
- Any revenue figure, chart or rollup. Displaying one offering's price is a
  legal read of an offering column (ADR-003 says so); aggregating prices into
  anything is not.
- Attaching an offering to an engagement —
  [T-260901-13](T-260901-13-engagement-offering.md).
- A per-offering detail route. `ui-design.md`: "a new feature is not a new
  top-level section", and §6.5 asks for a management surface, not a record
  page.

## Touches

- `electron/renderer/views/Offerings.tsx` (new) + `.css` + `.test.tsx`
- `electron/renderer/routes.tsx` — replaces `ViewPlaceholder`
- `electron/renderer/routes.test.tsx`
- `electron/renderer/components/sheets/OfferingSheet.tsx` (new) + test, if
  create/edit is a sheet — and then `layer-manager-context.ts`'s `SheetKind`
  and `LayerManager`'s switch, which is a closed union of four today
- `electron/renderer/lib/query-keys.ts` — if the view needs keys beyond what
  T-260901-07 added
- `electron/shared/settings.ts` — only if a `view.offerings.mode` key lands

## Acceptance

- [ ] `/offerings` renders the nine seeded offerings in five categories, from
      the real channels — no fixture array in the component.
- [ ] `Retainer, 4500/mo`, `Audit, 4500` and `Advisory, 175/hr` each
      quick-add to the right unit and billing model — one assertion per form,
      which is P3-07's own acceptance.
- [ ] Deleting a category that holds offerings shows the refusal's reason and
      the category is still listed afterwards.
- [ ] Archiving hides the offering from the default list, a filter brings it
      back, and an engagement sold at its rate still resolves to it.
- [ ] No control anywhere in the view writes an `offering_versions` rate
      after creation.
- [ ] `grep` of the view for `billing_model`-branched money arithmetic finds
      nothing (ADR-003's standing rule).
- [ ] The view works down to ~700px with no horizontal page scroll.
- [ ] `npm run verify` passes.

## Risks

- **The price-change trap.** "Edit offering" naturally grows a rate field,
  and a rate field here writes a price with no effective date and no record
  of what was sold at the old one — which is the single thing §6.5 and P3-02
  are built to prevent. This is the most likely way this task does damage.
- Adding a fifth member to `SheetKind` widens a union whose closedness is
  what makes `LayerManager`'s switch exhaustive. That is fine, but the switch
  and the context comment both have to be updated, not just the type.
- §6.5 calls this "a management surface, not an analytics surface". Counts of
  engagements sold, revenue per offering and "most popular" are the kind of
  thing that looks like an improvement and is the thing the requirement is
  refusing.
- Nine seeded offerings will not exercise the filters. Test against more than
  the seed.

## Outcome

Merged into `main` from branch `T-260901-11` (builder `bf7c281`, one test
extended at merge in `d4eee97`). Thirteen files: `views/Offerings.tsx`
(+ `.css`, `.test.tsx`), `views/offerings-display.ts` (money grouping via
`BigInt` + `Intl.NumberFormat` on the *string*, so no float touches a rate;
`.00` dropped), `views/offerings-quick-add.ts` (+ test),
`components/sheets/OfferingSheet.tsx` (+ `.css`, `.test.tsx`),
`layer-manager-context.ts` (`SheetKind` gains `'offering'`),
`LayerManager.tsx` (its case), `routes.tsx` (`/offerings` replaces the
placeholder), `routes.test.tsx`.

- The view groups by category — the category is the grouping, so there is
  **no card/list toggle and no `view.offerings.mode` key**; the mockup's
  offerings view has one presentation and a toggle would have had nothing to
  toggle to. `electron/shared/settings.ts` is untouched.
- Filters: all / services / products, and by category, applied in the
  renderer over one unfiltered `offerings:list` read (the view needs the
  whole catalogue for per-category counts; a filtered read would make the
  counts disagree with the rows under them). Archived rows are hidden by
  default and reachable through an Archived chip; the view offers archive
  and duplicate, never delete.
- Create/edit is `OfferingSheet`, split `Sheet` / `EditSheet` / `Form` as
  `EngagementSheet` is. Creating sets the first version's rate — the only
  place a rate is written. Edit shows the current price read-only beside a
  disabled "Change price" with a caption (the backup-folder shape); the edit
  patch type has no `rateCents` key and the test asserts the patch never
  carries one. Category create/rename/delete are inline; a refused delete
  shows the repository's own reason beside that block.
- Quick-add: `Name, 4500` → fixed, `4500/mo` → retainer, `175/hr` → T&M.
  Type is whatever the filter names, `service` otherwise; the mockup's
  name-contains-"product" guess is deliberately not ported.
- Two things the scope did not anticipate: the seed's category named
  "Products" collides with the type filter's "Products" button, so category
  chips are named `"<name> category"` and each block's heading is a real
  `<h2>`; and `renamingId === block.categoryId` put the Uncategorised block
  (id `null`) into rename mode on first paint — caught by the builder's own
  tests, fixed before hand-off.

Acceptance: every box ticked except `npm run verify` (ran as the underlying
tools on the scratchpad Node 22.22.0 — run summary).

**Review.** Six mutants. Five died as written: archived never hidden, type
filter dead, category-delete refusal reason swallowed, `/mo` mapped to T&M,
edit patch carrying `rateCents`. One survived — the category predicate on
rows removed — because the block list is narrowed by category on its own,
so the predicate only shows in the archived list under a category filter;
the existing test now asserts that (`d4eee97`). No price is aggregated
anywhere in the view (ADR-003).

**Follow-up worth a decision, not filed:** `NewMenu.tsx` does not offer
"New offering"; the view carries its own create button and the scope's
Touches did not list the menu.

**Not eyeballed:** the view has not been opened in the running app; the
mockup's category blocks were matched by reading the CSS.
