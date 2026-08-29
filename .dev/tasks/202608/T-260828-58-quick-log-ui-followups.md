---
id: T-260828-58
title: Make the quick log’s keyboard selection visible and keep it in view
status: done
category: ui
plan_ref: P1-09
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged as `20c6088`. Built by a subagent under the build-only process; reviewed
and verified by the orchestrator at merge.

**Changed:** `electron/renderer/components/shell/QuickLog.{tsx,css,test.tsx}`.

Four changes, each one named in this task's Scope:

1. **The selected row steps one surface *up*, not down.** `.qlog-opt.sel` was
   `--surface` sitting on a `--surface-2` list — the darkest thing in the list
   and the same colour as the sheet behind it. It is now `--surface-3`, which is
   the mockup's own relationship (`.pal-i.sel` steps up from what it sits on),
   plus an inset `--verdigris` bar so the highlight is not carried by colour
   alone.
2. **`scrollIntoView({ block: 'nearest' })` on the active option.** `.qlog-list`
   is `max-height: 168px; overflow: auto`, so past about five matches the arrow
   keys drove a highlight that had left the viewport. `nearest` scrolls only when
   the row is actually out of view, so the list does not jump under a highlight
   that was already visible.
3. **The confirmation no longer waits on three refetches.** `onSuccess` awaited
   `invalidateQueries` for companies, people and activity before raising the
   toast and closing. The write is already settled when `onSuccess` runs, so
   nothing here is optimistic — what stopped being awaited is only the reading
   back of three lists, which held the overlay open for a full round trip.
4. **Two keyboard and ARIA corrections.** ArrowDown on a closed list now reopens
   it where it was left instead of opening *and* stepping past the last row the
   user saw; `aria-controls` is set only while the list is rendered, since an
   IDREF pointing at an absent element resolves to nothing.

**Verified at merge:** the whole `renderer` project, 44 files / 338 tests, green
on the merged tree. Run at `SOLOCRM_TEST_WORKERS=2` because two builders were
still working — sizing my own run, not changing any budget.

**Reviewed at merge.** The unawaited invalidation is the one change that looks
like scope creep and is not: this task's *Saving waits on invalidation* section
asks for it in as many words. Checked directly.

## Known limits, recorded deliberately

**The token-value assertion could not be written the way the acceptance asked.**
"The selected row is measurably lighter than the list background, asserted
against the token values" cannot read `QuickLog.css` from a renderer test:
Vitest's css-disable plugin replaces every `.css` import with an empty string and
matches on the extension, so even `?raw` arrives blank (the builder measured
this), and a renderer file may not import `node:fs` under
`local/no-renderer-node-access`. What ships instead imports the mockup's HTML
(an `.html` import comes through intact), resolves `--surface-2` and
`--surface-3` from its `:root`, and asserts the luminance ordering, with a DOM
test pinning that the highlighted row alone carries `qlog-opt sel`.

**The residual gap is real:** an edit changing *which* token `.qlog-opt.sel` uses
would not fail this test. Closing it properly is either a one-line
`css: { include: [/QuickLog\.css$/] }` on the renderer project or moving the
assertion into a node-project file — both outside this task's Touches, and both
touching `vitest.config.ts`, which T-260828-54 had just stabilised. Left as a
known limit rather than widened into here.

`scrollIntoView` is called through a `typeof === 'function'` guard because jsdom
implements no layout and no `scrollIntoView`; the test spies on it and asserts
the element and `{ block: 'nearest' }`. The geometry itself is the browser's, and
T-260828-15's real-window QA pass is where it gets looked at.
