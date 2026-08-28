---
id: T-260828-04
title: Seal the renderer — contextIsolation, sandbox, CSP, navigation guards
status: in-progress
category: ipc
plan_ref: P0-02
created: 2026-08-28
closed:
---

## Why

AGENTS.md: *the renderer never touches SQLite or the filesystem.* That is not a
convention, it is a property of the window configuration, and it stops holding
the first time someone flips a flag for convenience — with no test failing and
nothing looking broken. The only thing that keeps it true over a year is a test
that fails when it is flipped.

This lands before the IPC bridge, because the bridge's design depends on what
`sandbox: true` allows the preload to do.

## Scope

**In:**

- `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, no `webSecurity` override, no `enableRemoteModule`. Every flag
  set explicitly rather than relying on an Electron default being safe today.
- A CSP with no remote origin — `default-src 'self'`. Dev needs the Vite HMR
  websocket; use a dev-only CSP that is still origin-restricted rather than a
  disabled one.
- `will-navigate` and `setWindowOpenHandler` refuse any navigation away from the
  app and hand external URLs to the system browser instead. Company websites and
  Drive links are pasted into this app by design (§6.10), so this path is
  exercised in normal use, not an edge case.
- A test asserting `window.require`, `window.process` and `window.module` are
  `undefined` in the renderer, running under `npm run test`.

**Out:** The typed IPC bridge and any channels (T-260828-09). Credential storage
(P4-01). Favicon fetching, which is main-process network access and has its own
security gate (P1-19).

## Touches

- `electron/main/index.ts` — window options, `will-navigate`,
  `setWindowOpenHandler`
- `electron/renderer/index.html` — CSP meta, or a main-process header
- `electron/preload/index.ts` — confirm it works under `sandbox: true`
- A test file asserting the renderer globals

## Acceptance

- [ ] A test asserts `window.require`, `window.process` and `window.module` are
      `undefined`, and it runs under `npm run test`
- [ ] Setting `contextIsolation: false` makes that test fail — verified once,
      then reverted, and noted in the outcome
- [ ] The production CSP contains no remote origin; a remote `<script src>` is
      blocked and the violation is logged
- [ ] Navigating the window to an external URL is prevented and the URL opens in
      the system browser instead
- [ ] `npm run dev` still hot-reloads with the dev CSP in place

## Risks

- **`sandbox: true` means the preload cannot require Node built-ins.** If
  T-260828-09's bridge assumes it can, this task gets reopened. Settle the
  pattern here and say in the outcome what the preload is allowed to use.
- **A CSP that blocks HMR makes dev unusable**, and the fastest fix is to disable
  it — permanently, because nobody comes back. Ship a working dev CSP in the same
  change or the constraint will be removed within a week.
- The navigation guard is easy to write in a way that also blocks the app's own
  internal routing. Test an in-app route change, not just an external URL.
- Electron defaults shift between majors; a flag that is safe by default today is
  a flag nobody notices when it changes. Explicit values are the point.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
