---
id: T-260828-38
title: Build the Workspace Settings view — identity, cadence defaults, integrations, appearance, shortcuts
status: done
category: ui
plan_ref:
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/workspace/settings` renders an `<h1>` and nothing else, which is what the user
found first in the installed build. **The plan has no task for the settings
surface itself** — §6.11 maps to P2-01 (the repository), P2-03, P4-08, X-04 and
X-06, each of which adds *one panel* to a page nobody was asked to build. That
gap is why this task has no `plan_ref`: it is a real omission in
`planning/solo-crm-taskplan.md`, not a duplicate of an existing entry, and the
plan should gain a `P2-0x · Settings view` line when this closes.

Without it, every setting P2-01 can store is unreachable, and the per-view
card/list persistence §6.13 promises has no surface to be changed from.

## Scope

**In:** The Settings view body, reading and writing through the T-260828-25
settings repository over its IPC channels:

- **Identity** — workspace name, operator, currency, fiscal year start.
- **Cadence** — default cadence days per company kind. The panel **states which
  companies a change will move before it is made**; the behaviour that actually
  moves them is P2-02, so until that lands this panel stores the values and says
  so plainly rather than implying an effect it does not have.
- **Integrations** — per-source toggles with status, and a standing statement
  that every integration is **pull-only** — §7 and AGENTS.md both make this a
  constraint rather than a current limitation, and the UI must say so.
- **Backup** — nightly JSON export toggle and target folder. The folder picker
  goes through main; the renderer never touches the filesystem (AGENTS.md).
  The backup job itself is X-04.
- **Appearance** — interface motion and compact density, both honouring
  `prefers-reduced-motion`.
- **Keyboard shortcut reference** — a read-only list, generated from
  `useGlobalShortcuts.ts` rather than hand-typed, so it cannot go stale.
- Panels for settings whose behaviour has not landed yet are shown with their
  state stated, never hidden — a blank page is what caused this task.

**Out:** The settings repository (T-260828-25). Cadence inheritance behaviour
(P2-02). Decay bands (P2-03). The backup job (X-04). Credential entry for Stripe
or Google — ADR-004 puts those in `safeStorage` and P4-01 owns the flow;
**no credential field appears on this page**.

## Touches

- `electron/renderer/views/WorkspaceSettings.tsx` — new
- `electron/renderer/routes.tsx` — replace the `/workspace/settings` placeholder
- `electron/renderer/components/primitives/Toggle.tsx`, `Card.tsx` — consumed
- `planning/solo-crm-taskplan.md` — add the missing plan entry

## Acceptance

- [ ] Every key §6.11 lists has a control, checked against that section by name
- [ ] A setting changed, the app restarted, and the change still in effect
- [ ] The integrations panel states pull-only in the interface, not only in a
      comment — asserted in a test over the rendered output
- [ ] No credential field exists anywhere on this page (ADR-004, G7)
- [ ] The backup folder is chosen through a main-process dialog; the renderer
      issues no filesystem call
- [ ] The shortcut reference is derived from the shortcut registration, and a
      test fails if a bound shortcut is missing from it
- [ ] Turning interface motion off removes animation without removing meaning —
      decay bars keep their width (X-06)
- [ ] Panels whose behaviour is not yet built say so; none is silently inert
- [ ] Keyboard operable throughout, correct roles and labels on every switch

## Risks

- **A settings page that appears to work and does not.** A cadence default that
  stores a number while P2-02 is unbuilt is worse than one that says the
  behaviour is coming; silent inertness is the failure mode this whole task
  exists to fix.
- **A credential field added "just for Stripe".** ADR-004 keeps secrets out of
  the `settings` table entirely so the nightly JSON backup can never leak one.
  The page is where that rule gets tested.
- **A renderer-side folder picker.** `contextIsolation` is on and the renderer
  touches no filesystem; the path must come back over IPC.
- **Hand-typing the shortcut list.** It is stale the first time a binding
  changes.


---

## Outcome

Merged as `418cec7`, resolving a one-line `routes.tsx`
conflict **and a cross-branch integration failure**. Review **blocking**; fixed
before merge.

**Changed:** `views/WorkspaceSettings.tsx`, its CSS and test,
`hooks/useGlobalShortcuts.ts`, `components/shell/Shell.tsx`, one line of
`routes.tsx`.

1. *(blocking)* **The motion setting was inert outside this page.**
   `useMotionAttribute` was the only writer of `data-motion` in the app and ran
   only while Settings was mounted, so turning Interface motion off and
   restarting left everything animating while the switch still read "off" —
   verbatim the failure this task's own Risks section names. `ShellLayout` now
   reads `appearance.motion` at boot, proven by a test that never visits
   `/workspace/settings`.
2. *(blocking)* Setting keys were composed at call sites — `cadenceKey()` and
   `integrationKey()` — which **ADR-002 rule 3 states verbatim as a defect**
   ("a key composed at a call site makes 'what settings exist' unanswerable by
   grep"). The `as SettingKey` casts were load-bearing in the wrong direction:
   rename a registry key and it still compiled, `snapshot[key]` went
   `undefined`, and `settings:set` wrote a key the repository rejects.
3. A second **global** `.inp` declaration would have fought the one the create
   sheets already use, with the bundler's emit order deciding padding for every
   input in the app.
4. Two surviving mutants of the same shape: nothing asserted a control reflects
   its **stored** value, so every integration switch could have rendered
   permanently on.
5. The shortcut card hardcoded the Cmd glyph on a Windows-only build.

**Cross-branch failure caught by verify on the merged tree:** T-260828-33 added
a `view.todos.groupBy` key, and this task's exhaustiveness test — "no key in the
settings registry is missing a control" — correctly failed. Both branches were
green alone. Resolved by adding the key to both fixtures and documenting why
`view.*` keys are listed without controls: they are per-view presentation state
(§6.13) set from each view's own header, so the assertion means "no key is
unaccounted for".

**Deferred:** no `dialog:selectFolder` channel exists, so the backup folder
button ships disabled with an honest caption — main-process work outside this ui
task. Also `KIND_LABEL`/`KIND_VARIANT` now have four copies across views, and
`.field` styles live in `CompanyDetail.css` where this page borrows them.
