---
id: T-260828-04
title: Seal the renderer — contextIsolation, sandbox, CSP, navigation guards
status: done
category: ipc
plan_ref: P0-02
created: 2026-08-28
closed: 2026-08-28
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

Merged to main in run R-260828-01. `electron/main/security.ts` owns the
baseline: `SECURE_WEB_PREFERENCES` (contextIsolation, sandbox, nodeIntegration,
webSecurity — all explicit), CSP installed as a response header via
`onHeadersReceived` (covers both dev http and packaged `file://`; a `<meta>`
tag could not vary dev/prod), navigation guards, plus real-Electron boot tests
for the renderer globals and CSP enforcement — both proven failable.

**What the preload may use under `sandbox: true`** (T-260828-09 builds on
this): `contextBridge.exposeInMainWorld`, `ipcRenderer`, the trimmed `process`
(no `stdout`/`stderr`), `console`, and web APIs. No Node built-ins, no
`node_modules` resolution at runtime — anything imported must be bundled into
the CJS preload (`out/preload/index.cjs`).

**The contextIsolation acceptance step, corrected by evidence:** with
`sandbox: true` pinned, flipping `contextIsolation` alone cannot leak Node
globals — Electron 44 never loads Node in the renderer at all. The empirical
truth table (verified independently by builder and reviewer): only
`sandbox: false` + `nodeIntegration: true` + `contextIsolation: false` leaks.
The globals test was proven failable via that combination instead, and a
source-text test now pins `index.ts` to the spread of `SECURE_WEB_PREFERENCES`
with no flag overridden beside it.

Review (combined code-review + security-review): 1 blocking + 4 should-fix,
all applied at merge — vitest catch-all no longer collects `.claude/**` agent
worktrees (was breaking `npm run test` on main whenever a worktree existed)
nor double-collects shared tests; `isInternalUrl` rejects `file://` URLs with
a remote host (UNC/SMB fetch → NTLM leak); `shell.openExternal` is gated by an
http/https/mailto allowlist (`ms-msdt:`, `smb:`, `file:` are dropped, since
§6.10 makes hostile URLs expected input). Verify after fixes: typecheck, lint,
68/68 tests, build — all green (one transient Electron-boot flake observed
under load, passed clean on re-run).

Follow-ups recorded, not blocking:
- **P1-19 (favicons):** `onHeadersReceived` keeps one listener per session —
  a second `webRequest` listener would silently replace the CSP. Nothing
  enforces this yet; the favicon fetcher must use a separate session or
  re-install the CSP.
- `webviewTag` / `nodeIntegrationInSubFrames` left to Electron defaults;
  could be added to `SECURE_WEB_PREFERENCES` for full explicitness.
- `devServerUrl()` uses `??` while the load path uses truthiness — an empty
  `ELECTRON_RENDERER_URL` would misroute in-app navigation.
