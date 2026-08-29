---
id: T-260829-11
title: Delete the sheet title nothing reads, and the openSheet parameter that feeds it
status: in-progress
category: ui
created: 2026-08-29
closed:
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

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
