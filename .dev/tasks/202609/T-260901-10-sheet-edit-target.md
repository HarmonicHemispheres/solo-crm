---
id: T-260901-10
title: Open a sheet on a record that already exists, and give an engagement its edit affordance
status: open
category: ui
created: 2026-09-01
closed:
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
