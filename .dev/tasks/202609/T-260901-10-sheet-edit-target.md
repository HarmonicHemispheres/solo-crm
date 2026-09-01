---
id: T-260901-10
title: Open a sheet on a record that already exists, and give an engagement its edit affordance
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

Once an engagement is created there is no way to open it again. `/engagements`
renders cards grouped by status with no per-card action, and the only two
buttons on the view both call `openSheet('engagement', …)`, which mounts a
blank create form. A grep of the renderer for `engagements:update` finds one
hit and it is the test stub — the channel exists and has existed since
T-260828-26, and nothing calls it.

There is no detail route to fall back on, by decision:
[ADR-005](../../decisions/ADR-005-pipeline-view.md) made the list view the
only view of engagement state, which is also why `nav.ts` gives an engagement
a row anchor instead of a path. So the list is where editing has to happen,
and today it cannot.

The reason it cannot is one signature. `openSheet(kind, trigger)` takes no
record — deliberately, and its own comment says so: "A dedicated setter
rather than overloading `openLayer` with a payload argument that only one of
five layer kinds ever uses." That was right when every sheet was a create
form. It is now the thing in the way, and the company edit affordance
([T-260901-14](T-260901-14-company-header-images-edit.md)) is blocked behind
the same line.

## Scope

**In:** the plumbing and its first consumer, together — the plumbing alone has
no observable behaviour to review, and the seam is at the sheet system, not
between it and this one form.

- `openSheet` carries an optional record id, and `LayerManager` passes it to
  the mounted form. Prefer a shape that makes the two modes distinguishable in
  the type — a form that receives `undefined` and one that receives an id
  should not be the same call — and keep the existing property that a sheet
  holding no form is unrepresentable.
- Sheets still mount fresh on open. `LayerManager`'s current comment explains
  why the four forms mount only while `isOpen('sheet')`: field state resets by
  fresh mount rather than by an effect that sets state, which the
  `react-hooks/set-state-in-effect` rule forbids. Opening the same sheet on a
  *different* record must reset the same way — this is the case that will get
  missed.
- `EngagementSheet` gains edit mode: it loads the engagement (`engagements:get`
  or the list cache), populates every field, and submits through
  `engagements:update` instead of `engagements:create`. Title, submit label
  and `aria-label` say "Edit", not "New".
- **`agreedRateCents` is not editable and must not be sent.**
  `electron/shared/engagements.ts`'s header states it: a snapshot taken at
  signature, writable on create, and `updateEngagement` "deliberately never
  read[s] it out of `parsed`" even though the update schema accepts the key.
  The form must not present a control that appears to change it.
- An edit affordance on each engagement card. `ui-design.md`: icon buttons by
  default, with an `aria-label`, and at ≤700px hover-revealed row actions stay
  visible because there is no hover on touch.
- The other three sheets keep working unchanged.

**Out:**

- Deleting an engagement. `engagements:delete` exists and is equally
  unreachable; a destructive action needs its own confirmation design and is
  not what was asked for.
- Edit mode for company, person or todo sheets. This task makes them
  *possible*; T-260901-14 uses it for companies. Person and todo are not in
  scope and their sheets should not be touched beyond whatever the signature
  change requires.
- The milestone editor (P3-09) and the offering picker
  ([T-260901-13](T-260901-13-engagement-offering.md)), both of which are
  fields on this same form and both of which land separately.
- An engagement detail route. ADR-005 decided against one.

## Touches

- `electron/renderer/components/shell/layer-manager-context.ts`
- `electron/renderer/components/shell/LayerManager.tsx` + test
- `electron/renderer/components/sheets/EngagementSheet.tsx` + test
- `electron/renderer/components/sheets/useSheetMutation.ts` — if create and
  update share it
- `electron/renderer/views/Engagements.tsx` + `.css` + test
- `electron/renderer/components/shell/create-commands.ts` and every existing
  `openSheet` call site, if the signature change reaches them

## Acceptance

- [ ] Every engagement card has a keyboard-reachable edit control with an
      `aria-label` naming the engagement, and it is visible without hover at
      700px.
- [ ] Opening it populates every field from the record — asserted field by
      field against a fixture, including a model-specific field for at least
      two different billing models.
- [ ] Saving calls `engagements:update` with only the changed fields and the
      card reflects the change without a reload.
- [ ] The payload sent on save contains no `agreedRateCents` key, and the
      stored value is unchanged after an edit that changes the billing model
      — read back from the repository, not inferred.
- [ ] Opening the sheet on engagement A, closing it, then opening it on
      engagement B shows B's values with none of A's left behind.
- [ ] Every existing create button still opens a blank form, and
      `openSheet('engagement')` with no record still means "new".
- [ ] Changing an engagement's billing model through the edit form leaves the
      other model's columns `NULL` rather than stale — the behaviour
      `updateEngagement` already implements, asserted from the UI path.
- [ ] `npm run verify` passes.

## Risks

- **The create path is the one with users.** Every regression here is
  invisible until someone creates a record and finds a field prefilled from
  the last thing they looked at.
- Making the record id optional on `openSheet` re-opens exactly the hole
  T-260829-08 closed by making `SheetKind` required — an optional argument
  that changes what the sheet *is*. If create and edit end up as two distinct
  call shapes rather than one with an optional tail, that is the better
  answer and the reason belongs in the outcome.
- `updateEngagement` resets the other model's columns only when the patch
  actually changes `billingModel`. A form that always sends the model, changed
  or not, still hits the "same model" branch — but a form that sends a full
  record back on every save will send `agreedRateCents` too, which the schema
  accepts and the repository silently drops. That silence is the risk: it
  looks like it worked.
- The engagement anchor id (`engagementAnchorId`) is what the command palette
  scrolls to. Restructuring the card must not change or duplicate it.

## Outcome

**Changed:** 9 files. `layer-manager-context.ts` gains `SheetFormTarget`
(`{ mode: 'create' } | { mode: 'edit'; id }`), `SheetTarget` (that plus
`kind`) and `editSheet(kind, id, trigger?)` — a second method, not an
optional tail on `openSheet`, for the reason this task's Risks named.
`LayerManager` holds a `SheetTarget` instead of a `SheetKind`, keeps the
"do not swap what is mounted while the sheet is open" contract for the whole
target, and keys the mounted form on `kind:id` so a different record is a
different element. `EngagementSheet` splits into a target resolver, an
`EngagementEditSheet` that loads `engagements:get` and shows placeholder
chrome until the record is in hand, and an `EngagementForm` that seeds every
field in `useState` initialisers from the record or `null` — the form is
mounted with the record, never filled by an effect. Edit saves build a diff
of the columns the form owns and post it through `engagements:update`; the
model discriminant travels whenever a model column does, so the patch
matches the update schema's union and the repository's reset-on-switch
branch. `agreedRateCents` is in no state, no control and no payload, in
either mode. `Engagements.tsx` gives each card an `IconButton` labelled
`Edit "<name>"` in an `.eng-actions` block revealed on hover/focus-within
and always visible below 700px; the anchor id is untouched. The other three
sheets are unchanged beyond the switch in `LayerManager`; `useSheetMutation`
did not need to change. A stored `null` billing model shows as `none` and
saving it untouched sends no model key.

**Review:** passed. Six mutants against `EngagementSheet.test.tsx` +
`LayerManager.test.tsx` + `Engagements.test.tsx` (63 tests): name always
sent (5 red), `agreedRateCents` echoed into the patch (7 red), the
"Work is for" mirror left on in edit mode (1 red), stored-null vs. selected
`none` treated as a change (1 red), `editSheet` building a create target
(6 red). The sixth — dropping the `key` on the mounted form — survived,
and is equivalent for today's code: nothing swaps the target while the
sheet is open and closing unmounts it, so the key defends against a caller
that does not exist yet. The "read back from the repository" half of the
`agreedRateCents` criterion is `engagements.test.ts`'s existing
`updateEngagement cannot change agreedRateCents` case (a common-field
patch, not a model switch; the repository never reads the key on either
branch), and the renderer tests prove the model-switch payload carries no
such key. Covering run on the merged tree: 17 files, 202 tests; tsconfig.web
and eslint clean.

**Found at merge, fixed on main (`639aa2e`):** `InfoPopover.test.tsx`
(T-260901-06) fakes a `LayerManagerContextValue` and did not know about
`editSheet`. Both branches were green alone; only the merged tree could
show it. Test-only, three lines.
