---
id: T-260829-08
title: Make every create button open a real form, and make a dead one impossible
status: in-progress
category: ui
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The "New company", "New person" and "New engagement" buttons on the list views
open a sheet with the right title, a disabled **Create** button, and the text
*"This form ships with its own task (P1-08)."* The forms themselves exist and
work — T-260828-27 built all four and the topbar New menu opens them correctly.
The list-view buttons simply do not say which form they want.

`openSheet(title, trigger?, kind?)` takes the form kind as an **optional** third
argument (`layer-manager-context.ts:54`). `LayerManager` falls back to a
placeholder shell when it is missing (`LayerManager.tsx:206-227`), a fallback
kept deliberately so callers written before T-260828-27 would keep working. Six
call sites never passed it:

| File | Lines |
|---|---|
| [Companies.tsx](../../../electron/renderer/views/Companies.tsx) | 288, 326 |
| [People.tsx](../../../electron/renderer/views/People.tsx) | 297, 333 |
| [Engagements.tsx](../../../electron/renderer/views/Engagements.tsx) | 332, 364 |

Two per view: the header button and the empty-state call to action — so the
buttons a first-run user reaches *first*, on an app with no records, are exactly
the broken ones. Nothing failed: no error, no console warning, a plausible sheet
with the correct title. Typecheck, lint, tests and `code-review` all passed
because an optional argument being absent is legal.

So the fix is not six edits. It is removing the state that made six edits
possible to forget.

## Scope

**In:**

- Change the signature to `openSheet(kind: SheetKind, title: string, trigger?:
  HTMLElement | null)` — `kind` **required and first**. It must lead because a
  required parameter cannot follow an optional one in TypeScript, and because
  the argument that decides which form appears should not be the one that is
  easiest to leave off the end.

- Update all nine call sites: the six above, plus `NewMenu.tsx:38,43,48` and
  `create-commands.ts:83`, which already pass a kind and only need reordering.

- **Delete the placeholder branch** — the `default` case in `LayerManager.tsx`,
  its `<Sheet>` shell, its disabled Create button and its `EmptyState`. With
  `kind` required and `SheetKind` a closed union of four, the switch is
  exhaustive and a form with no content becomes unrepresentable rather than
  merely unused. Drop the `EmptyState` import if nothing else in the file needs
  it.

- Update `LayerManager.test.tsx:33-34`, which calls `openSheet` without a kind
  today. Those two buttons exist to test the open/close mechanism, so give them
  a real kind rather than keeping a kind-less path alive for tests.

- Check whether `sheetTitle` still has a consumer once the placeholder is gone.
  Each of the four sheets renders its own `<Sheet title>`, so `sheetTitle` may
  now be carried through the context and read by nothing. If so, remove it from
  the context and from `openSheet` — it is the same class of thing as the
  optional `kind`: a path kept alive past its last reader. If something does
  still read it, say what in the outcome.

- A regression test that closes the hole behaviourally, not just by type:
  render each of Companies, People and Engagements with no records, click the
  empty-state create button, and assert the sheet that opens contains that
  entity's first real field (the company name input, the person name input, the
  engagement name input) — not merely that a sheet opened. Repeat for the header
  button. Six assertions, one per broken call site.

**Out:** any change to the four sheets themselves — they work. The Todos view,
which creates through inline `QuickAdd` rather than a sheet and is not affected;
`TodoSheet` stays reachable through the command palette. Adding create buttons
anywhere that lacks one. A lint rule — making the parameter required puts this
in the type checker, which is a stronger gate than a rule and does not need
writing.

## Touches

- `electron/renderer/components/shell/layer-manager-context.ts`
- `electron/renderer/components/shell/LayerManager.tsx`, `LayerManager.test.tsx`
- `electron/renderer/components/shell/NewMenu.tsx`, `create-commands.ts`
- `electron/renderer/views/Companies.tsx`, `People.tsx`, `Engagements.tsx`
- the corresponding view tests

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `grep -rn "This form ships with its own task" electron/` returns nothing.
- [ ] `grep -n "kind?: SheetKind" electron/renderer/components/shell/layer-manager-context.ts`
      returns nothing — the parameter is not optional.
- [ ] Reverting any single call site to omit its kind fails `npm run typecheck`.
      State in the outcome that this was actually tried, on which call site.
- [ ] In a real window, on a database with no records: each of the three views'
      empty-state buttons and each of their header buttons opens a form with
      editable fields and an enabled Create button, and a record created that way
      appears in the list without a reload. Six paths, checked by hand.
- [ ] The topbar New menu and the ⌘K create commands still open the same forms.

## Risks

- **The failure mode is that this looks fixed when it is not.** The sheet already
  opened with the correct title before this change; a test that asserts "a sheet
  is open" passes against the broken build. The acceptance criteria therefore
  name a field inside the form, and the manual pass is on an empty database
  because that is where the empty-state buttons — half the defect — are the only
  way in.
- Reordering `openSheet`'s parameters touches every caller at once. Two
  positional strings would silently swap if the signature were
  `(title, kind)`; putting the closed union first means a swap is a type error
  rather than a form titled `company` containing the wrong fields.
- `sheetTitle` removal is the sort of cleanup that quietly breaks an
  accessible name. If the sheets do not each carry their own `aria-label`,
  removing it costs the sheet its name in the accessibility tree — check before
  deleting, and if in doubt keep it and say so.
- [T-260828-15](T-260828-15-real-window-qa-pass.md) — the real-window QA pass —
  is still open and is the gate that would have caught this. This task does not
  replace it.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
