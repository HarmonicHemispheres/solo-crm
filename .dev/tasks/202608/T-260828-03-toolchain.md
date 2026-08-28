---
id: T-260828-03
title: Stand up the electron-vite + React + TypeScript toolchain
status: open
category: build
plan_ref: P0-01
created: 2026-08-28
closed:
---

## Why

There is no application code. Every other task assumes a main / preload /
renderer split, a working dev loop, and the four commands `verify` runs. Nothing
can start until this exists, and `verify` currently cannot report honestly
because there is nothing to run.

## Scope

**In:**

- electron-vite + React + TypeScript. `electron-builder` configured as a
  dependency and given a minimal config, but producing no distributables yet.
- The directory layout from requirements §4, created on disk so later tasks land
  in the right place instead of inventing one: `electron/main/{db,sync,ipc,favicons}`,
  `electron/preload/`, `electron/renderer/{routes,components,hooks}`. Empty
  directories get a `.gitkeep`.
- `package.json` scripts: `dev`, `build`, `typecheck` (`tsc --noEmit`), `lint`,
  `test`.
- **Separate tsconfigs per process.** Main and preload get Node libs; the
  renderer gets DOM and no Node types. One shared config would let renderer code
  `import fs` and typecheck cleanly — the exact thing AGENTS.md forbids, made
  invisible.
- Vitest with one real test, so `npm run test` exits zero because something
  passed rather than because nothing ran.
- better-sqlite3 declared as an external in the electron-vite main config, so it
  is not bundled. It is not used yet; the config is set now because getting it
  wrong surfaces in T-260828-05 as a confusing native-module error.

**Out:** BrowserWindow security flags and CSP (T-260828-04). Any database code
(T-260828-05). Distributables, icons and signing (X-09). CI configuration.

## Touches

- `package.json`, `electron.vite.config.ts`
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- `electron/main/index.ts`, `electron/preload/index.ts`
- `electron/renderer/index.html`, `main.tsx`, `App.tsx`
- `eslint.config.js`, `vitest.config.ts`
- `.gitignore`

## Acceptance

- [ ] `npm run dev` opens a window; editing a renderer file hot-reloads without
      a restart, and editing a main file restarts the main process
- [ ] `npm run typecheck` exits 0 and covers main, preload and renderer — deleting
      a type annotation in any of the three makes it fail
- [ ] `npm run lint` and `npm run test` both exist and exit 0
- [ ] `npm run build` completes and the built output launches
- [ ] `import fs from 'fs'` in a renderer file fails `npm run typecheck`
- [ ] The §4 directory layout exists on disk

## Risks

- **better-sqlite3 is a native module.** It must be externalised from the main
  bundle and rebuilt against the Electron ABI. Bundling it appears to work until
  the packaged build, which is the most expensive place to find out.
- **`sandbox: true` lands in T-260828-04 and restricts what the preload may
  require.** A preload pattern chosen here that assumes Node built-ins will have
  to be redone. Keep the preload trivial until that task settles the pattern.
- A single permissive tsconfig is the default most templates ship with, and it
  silently removes the compile-time half of the IPC boundary. This is the one
  structural decision in an otherwise mechanical task.
- `verify` reports what it ran. If a script is stubbed to `exit 0` to make the
  set complete, every later run reports a passing check that never executed.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
