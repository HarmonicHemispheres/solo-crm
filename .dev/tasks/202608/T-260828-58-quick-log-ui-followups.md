---
id: T-260828-58
title: Make the quick log’s keyboard selection visible and keep it in view
status: open
category: ui
plan_ref: P1-09
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->
## Why

Deferred from T-260828-35's review. The quick log is the feature §2's fourth goal
rests on — a log that takes under five seconds — and it is keyboard-only by
design. Two of the findings sit directly on that path.

**The keyboard target is the least visible row.** `.qlog-opt.sel` sets
`background: var(--surface)` inside a `.qlog-list` of `var(--surface-2)`, which
itself sits inside a `.sheet` painted `var(--surface)`. So the highlighted row
is the same colour as the panel behind the list and *darker* than its
unhighlighted neighbours — roughly a 1.06:1 step against its own container. The
mockup's `.pal-i.sel` runs the other way: selected is one step lighter. In a
flow with no mouse, the one state that must read does not.

**The highlight can leave the viewport.** `.qlog-list` is
`max-height: 168px; overflow: auto`, and Arrow keys move the highlight without
scrolling it into view, so past roughly five matches the user is driving a
selection they cannot see.

**Saving waits on invalidation.** `logTouch.onSuccess` awaits three
`invalidateQueries` calls before `onSaved()` and `onClose()`. Those resolve only
once the active queries have refetched, so the overlay stays up and the
confirmation is withheld for a companies + people + activity round trip —
against a goal measured in felt seconds.

## Scope

**In:**

- Selected row one step *lighter* than the list, per the mockup — `--surface-3`.
- `scrollIntoView({ block: 'nearest' })` on the active option when the highlight
  changes.
- Close the overlay and raise the toast first; let invalidation settle behind it.
- Fix the two test weaknesses review named: per-character keystrokes are modelled
  from `text.length` rather than dispatched, and the exact-count assertion
  baselines on a counter read at runtime, so a two-press open would still pass.
  Use `userEvent.type` (or a per-character loop) and a literal for the chord.
- ArrowDown currently reopens a closed list one row further down than where it
  was; and `aria-controls` is a dangling IDREF while the list is closed.

**Out:** The command palette (T-260828-37), which shares `LayerManager` but is
its own task. Any change to what the quick log writes.

## Touches

- `electron/renderer/components/shell/QuickLog.css`
- `electron/renderer/components/shell/QuickLog.tsx`
- `electron/renderer/components/shell/QuickLog.test.tsx`

## Acceptance

- [ ] The selected row is measurably lighter than the list background, asserted
      against the token values rather than by eye
- [ ] With more matches than fit, arrowing to the last one leaves it inside the
      scroll viewport — asserted, not observed
- [ ] The overlay closes and the toast appears without waiting on refetches,
      asserted with a deliberately slow query
- [ ] Every keystroke counted by the five-second test corresponds to an event
      the test dispatched
- [ ] Making the overlay cost two presses to open fails the keystroke assertion
- [ ] No `aria-controls` points at an element that is not rendered

## Risks

- **Closing before the write settles.** The overlay may close early, but only
  after `activity:log` has succeeded — an optimistic close that hides a failed
  write is much worse than a slow one.
- **Fixing the contrast by adding a border instead.** `.claude/rules/ui-design.md`
  forbids colour as the only signal, and a border is a legitimate second signal,
  but the background step is the thing that is currently backwards.
