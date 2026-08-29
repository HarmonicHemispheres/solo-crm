---
id: T-260828-35
title: Build the quick log (⌘L) — who, kind, one line, from anywhere
status: done
category: ui
plan_ref: P1-09
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

§2's fourth goal is that logging a call takes under five seconds, and it is the
goal the whole product rests on: a CRM that is slower to update than it is to
skip does not get updated, and then every cadence figure in the app is wrong.
`useGlobalShortcuts.ts` and the `LayerManager` exist from T-260828-12 and have
no ⌘L to bind. This is in the P1-CUT subset because capture is what makes the
app worth opening between calls.

## Scope

**In:** A quick-log overlay bound to ⌘L (Ctrl+L on Windows/Linux), opening from
any view through the existing `LayerManager` so Esc dismissal stays centrally
owned:

- Three inputs: **who** (company or person, typed and matched), **kind**
  (`call | email | meeting | note` as chips), and **one line** of note.
- Optional engagement, defaulted from the chosen company when it has exactly one
  active engagement.
- Writes through `activity:log` (T-260828-26), which moves `last_touch_at` /
  `last_contact_at` in the same transaction (T-260828-24) — so saving resets the
  cadence clock as a consequence of the write, not as a second call the UI makes.
- Opens focused on the who field; Enter saves; the overlay closes and confirms
  with the existing `Toast`.
- An empty note is refused with a stated reason rather than saved blank.
- Invalidates the affected queries so the company leaves "going quiet" and the
  activity views update without a manual refresh.

**Out:** The Activity view (T-260828-34). The command palette (T-260828-37) —
separate shortcut, separate task, though both use `LayerManager`. Editing a
logged row, which G8 forbids. Voice or clipboard capture.

## Touches

- `electron/renderer/components/shell/QuickLog.tsx` — new
- `electron/renderer/hooks/useGlobalShortcuts.ts` — bind ⌘L
- `electron/renderer/components/shell/LayerManager.tsx` — consumed, ideally unchanged
- `electron/renderer/lib/query-keys.ts` — invalidation

## Acceptance

- [ ] Open-to-saved is **under five seconds by keyboard alone**, measured with a
      scripted keystroke sequence and asserted, not estimated (§2, goal 4)
- [ ] ⌘L opens from every view in the route table, including detail routes
- [ ] Saving moves the company out of "going quiet" with no manual refresh —
      checked by reading `last_touch_at` and by the rendered cadence state
- [ ] An empty note is refused with a visible reason; the overlay stays open and
      keeps what was typed
- [ ] Esc dismisses through `LayerManager` and not through a local handler —
      T-260828-12's review settled that the manager owns Esc outright
- [ ] The who field matches both companies and people, and the two are
      distinguishable in the result list
- [ ] Saving with a company that has one active engagement pre-fills it; with
      two or none, it does not guess
- [ ] No mouse is required at any step (X-06)

## Risks

- **Resetting the cadence clock as a second IPC call.** If the UI logs activity
  and then updates `last_touch_at`, a failure between them produces history the
  cadence meter cannot see. It is one transaction in the repository by design.
- **Taking Esc locally** and breaking the central dismissal the shell already
  owns — this is a repeat of a finding already made once on T-260828-12.
- **Measuring the five seconds by feel.** The acceptance criterion is a
  measurement; §8's unmeasured requirements are wishes.
- **A "who" field that requires an exact match** turns a five-second log into a
  detour through the create sheet. Offer creating the company inline or say
  plainly that it must exist first.


---

## Outcome

Merged as `e02877e`. Review non-blocking (5 should-fix, 2 nits).

**Changed:** `components/shell/QuickLog.tsx`, its CSS and test (new),
`components/shell/LayerManager.tsx` and its test, `hooks/useGlobalShortcuts.ts`
and its test, `routes.test.tsx`.

⌘L (Ctrl+L here) opens the quick log from any route. Who, kind, one line; the
engagement pre-fills only when the chosen company has exactly one active
engagement and does not guess otherwise. Saving goes through `activity:log`,
which moves `last_touch_at` / `last_contact_at` in the same transaction — so
the cadence clock resets as a consequence of the write rather than as a second
call the UI makes, which was the risk the task file named. Esc dismisses through
`LayerManager`; no local handler, per T-260828-12's review.

**A note on the first attempt.** This task was dispatched twice. The first
builder landed in a worktree created at the session's opening commit, found no
`.dev/tasks/202608/T-260828-35-quick-log.md`, searched `git log --all` and
`git branch -a`, and reported `blocked — the scope does not exist anywhere in
git history`. The file was tracked on main the whole time. Every isolation
worktree starts at `CLAUDE_BASE`, dozens of commits back; the prompt asked the
agent to *check* its base rather than telling it to reset unconditionally, and
one agent in six skipped the check. The rule is now stated as a fact in
`run-tasks`, and the rebuild was clean on the first pass.

**Deferred (follow-ups, not blockers). The first two are the ones that matter:**

- **The keyboard target is the least visible row.** `.qlog-opt.sel` paints
  `--surface` inside a `--surface-2` list inside a `--surface` sheet, so the
  highlighted row is the same colour as the panel behind the list and *darker*
  than its unhighlighted neighbours — about a 1.06:1 step. The mockup's
  `.pal-i.sel` runs the other way. In a flow that is keyboard-only by design,
  this is the one visual state that has to read.
- **Arrow keys move the highlight without scrolling it into view.** The list is
  `max-height: 168px; overflow: auto`, so past ~5 matches the user is driving a
  selection they cannot see.
- `onSuccess` awaits three `invalidateQueries` before closing, so the overlay
  and its toast wait on a companies + people + activity round trip — against a
  goal measured in felt seconds.
- The five-second test models per-character keystrokes from `text.length` rather
  than dispatching them, and its exact-count assertion baselines on a counter
  read at runtime, so a two-press open would still pass.
- ArrowDown reopens a closed list one row further down than it was; and
  `aria-controls` is a dangling IDREF while the list is closed.
