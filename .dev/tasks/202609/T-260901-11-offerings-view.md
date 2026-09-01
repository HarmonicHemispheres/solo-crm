---
id: T-260901-11
title: Build the Offerings view
status: open
category: ui
plan_ref: P3-07
created: 2026-09-01
closed:
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
