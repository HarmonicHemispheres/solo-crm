---
id: T-260829-11
title: Delete the sheet title nothing reads, and the openSheet parameter that feeds it
status: done
category: ui
created: 2026-08-29
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

From the review of [T-260829-08](T-260829-08-create-buttons-dead-form.md).

That task deleted `LayerManager`'s placeholder sheet — the one every list-view
create button was opening. The placeholder was the only thing that ever rendered
`sheetTitle`, as its `<Sheet title>` and its `aria-label`. With it gone, the
context still carries `sheetTitle`, `LayerManager` still calls `setSheetTitle`,
and `openSheet` still takes a `title` argument that eleven call sites dutifully
pass — and nothing reads any of it.

T-260829-08's own thesis was that an optional argument nobody has to pass is a
defect waiting to be forgotten; it made `kind` required so the type checker
enforces what six call sites had failed to remember. A required argument that no
longer feeds anything is the same shape of problem one turn later: every new
create button will be asked for a title, and the title will go nowhere.

It was left in deliberately rather than missed. Removing `title` cascades into
`CreateCommand.sheet.title`, which T-260829-08's scope said only needed
reordering, and widening that diff during a security- and type-sensitive
signature change was the wrong trade at the time. It is the right one now, on its
own, where the whole diff is deletion.

**The accessibility question is already settled and does not need re-asking.**
All four sheets hardcode both their own `<Sheet title>` and their own
`aria-label` — `CompanySheet.tsx:119,121`, `PersonSheet.tsx:129,131`,
`EngagementSheet.tsx:196,198`, `TodoSheet.tsx:91,93`. No sheet takes its
accessible name from `sheetTitle`. That was verified during T-260829-08, not
assumed.

## Scope

**In:**

- `openSheet` becomes `(kind: SheetKind, trigger?: HTMLElement | null)`.
- Remove `sheetTitle` from `LayerManagerContextValue`, the `useState` and the
  `setSheetTitle` call in `LayerManager.tsx`, and the context memo.
- Update all eleven call sites to drop their title string: `NewMenu.tsx`,
  `create-commands.ts`, `Companies.tsx` (header, empty state, grid card),
  `People.tsx` (same three), `Engagements.tsx` (header, empty state), and the
  `LayerManager.test.tsx` harness.
- `CreateCommand.sheet.title` in `create-commands.ts` — if `title` is now unread
  there too, remove the field; if the palette renders it as the command's own
  label, keep it and say so in the outcome. **Check rather than assume**: the
  palette's visible command label and the sheet's title are different things
  that happen to hold the same string today.
- The mock in `hooks/useGlobalShortcuts.test.tsx:103` drops its `sheetTitle: ''`
  entry.

**Out:** any change to the four sheets, to which form a button opens, or to
`SheetKind`. Any change to what the command palette *displays* — if a title is
what the palette shows, that is a real reader and it stays.

## Touches

- `electron/renderer/components/shell/layer-manager-context.ts`
- `electron/renderer/components/shell/LayerManager.tsx`, `LayerManager.test.tsx`
- `electron/renderer/components/shell/NewMenu.tsx`, `create-commands.ts`
- `electron/renderer/views/Companies.tsx`, `People.tsx`, `Engagements.tsx`
- `electron/renderer/hooks/useGlobalShortcuts.test.tsx`

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `grep -rn "sheetTitle" electron/` returns nothing.
- [ ] Every sheet still has its accessible name: a test opens each of the four
      and asserts `getByRole('dialog', { name: … })` finds it. This is the check
      that makes the deletion safe, so it is a test and not an inspection.
- [ ] The command palette's create commands still display their labels — asserted
      in `CommandPalette.test.tsx`, not by eye.
- [ ] The nine create-path assertions T-260829-08 added still pass unchanged
      except for the dropped argument.

## Risks

- This is a pure deletion, which is the kind of change that looks free and
  removes a reader nobody thought to grep for. The accessible-name test is the
  gate: if a sheet loses its name, that test fails rather than a screen reader
  finding out.
- `create-commands.ts` is the one genuinely ambiguous spot — a `title` there may
  be the palette's label rather than the sheet's. Deleting a visible label
  because it shares a name with a dead one would be the defect this task
  introduces.

---

## Outcome

**Changed:**

- `electron/renderer/components/shell/layer-manager-context.ts` — `sheetTitle` removed from the context; `openSheet` is now `(kind: SheetKind, trigger?: HTMLElement | null)`.
- `electron/renderer/components/shell/LayerManager.tsx` — the `useState`, the `setSheetTitle` call, the `title` parameter and both context-memo entries.
- `electron/renderer/components/shell/create-commands.ts` — `sheet` is now `{ kind }`; `runCreateCommand` passes `(kind, trigger)`.
- `NewMenu.tsx`, `Companies.tsx`, `People.tsx`, `Engagements.tsx` — the call sites.
- `LayerManager.test.tsx` — three new harness triggers and the four-way accessible-name test.
- `hooks/useGlobalShortcuts.test.tsx` — the mock drops `sheetTitle: ''`.

**Fourteen call sites, not the eleven this scope predicted** — NewMenu 3,
Companies 3, People 3, Engagements 2, `runCreateCommand` 1, and the
`LayerManager` test harness 2. The two `onCreate` props typed as
`LayerManagerContextValue['openSheet']` followed automatically, as expected;
only their call expressions changed.

**`CreateCommand.sheet.title` was removed, after checking rather than
assuming.** This scope flagged it as the one genuinely ambiguous spot — a
`title` there might have been the palette's own visible label. It was not:
`CommandPalette.tsx:236-240` builds each create row from
`command.paletteLabel`, and `NewMenu` draws hand-written JSX checked against
`command.menuLabel`, both asserted in `CommandPalette.test.tsx:106,123-136`.
The only reader of `sheet.title` anywhere was `runCreateCommand` forwarding it
straight back into `openSheet`. Both visible labels are untouched and their
tests pass unchanged.

**Review:** no blocking findings.

*The deletion's gate was verified to be a gate.* The four-way accessible-name
test was run **before** the deletion as well as after — 20/20 green
pre-deletion — so it proves the sheets already named themselves rather than
proving nothing. Independently at merge, stripping `aria-label` from
`CompanySheet.tsx:121` turned **five** tests red with `Unable to find an
accessible element with the role "dialog" and name "New company"`. Reverted with
a targeted edit, leaving no content change. That is the exact failure this task
risked introducing, and it is caught.

The deliberate bad call was performed on `NewMenu.tsx:38`, giving the Company
menu item back its old second positional argument:
`error TS2554: Expected 1-2 arguments, but got 3`.

`typecheck`, `lint`, `--project=renderer` (51 files, 451 tests) and
`--project=runtime-boot-renderer` (2 files, 21 tests) all passed on the branch —
both projects, because `--project=renderer` does not include the runtime-boot
pool, which is what caused this run's one cross-branch failure earlier.
`grep -rn "sheetTitle" electron/` returns nothing.

**Two comment-only fixes made at merge.** `CompanySheet.tsx:52` and
`TodoSheet.tsx:35` documented the call as `openSheet(title, trigger, 'company')`
/ `openSheet(title, trigger, 'todo')`. Those were already stale before this task
— T-260829-08 reordered the parameters and did not update them — and this task
made them wrong a second way. The builder correctly left them alone, since this
scope's "Out" section forbids touching the four sheets. Corrected here rather
than filed, because a doc comment naming a signature that has never existed in
either of its two forms is a smaller thing to fix than to track.

**Deferred:** nothing.
