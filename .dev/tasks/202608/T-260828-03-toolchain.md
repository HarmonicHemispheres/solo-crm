---
id: T-260828-03
title: Stand up the electron-vite + React + TypeScript toolchain
status: done
category: build
plan_ref: P0-01
created: 2026-08-28
closed: 2026-08-28
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

Merged to main in `b12ac84` (run R-260828-01). Full electron-vite + React +
TypeScript scaffold: split tsconfigs per process (renderer `import fs` fails
typecheck, asserted by test), eslint, vitest (node/jsdom project split), the §4
directory layout, electron-builder configured but producing nothing. Verify:
typecheck, lint, test (6), build all exit 0.

Findings worth remembering:

- **The preload must be CJS.** `"type": "module"` makes electron-vite emit an
  ESM preload, which Electron's sandboxed renderer silently refuses to load —
  `window.crm` would never exist, invisible until T-260828-09. Review caught it;
  fixed to `format: 'cjs'` / `index.cjs` and proven against the real Electron 44
  binary (`typeof window.crm === 'object'`, renderer `sandboxed: true`).
- **`dev` script needs `electron-vite dev --watch`** — without the flag, main
  edits never rebuild/restart; only the renderer stays live.
- **Version pins:** vite pinned ^7 (electron-vite 5 rejects 8); typescript
  pinned ^6.0.3 (typescript-eslint 8 rejects 7.x, which npm now resolves by
  default). Do not let later tasks float these without checking.
- This environment sets `ELECTRON_RUN_AS_NODE=1` globally — unset it to launch
  the real app.

Follow-ups from the confirmation review, recorded not blocking:

- **N1 → T-260828-04:** preload catch block writes to `process.stderr`, which
  is `undefined` in a sandboxed preload — the log line throws before the
  rethrow, masking the real error. Use `console.error` + `throw`.
- **N2 → T-260828-04:** vitest `projects` split silently collects nothing for
  tests outside main/preload/renderer globs; add a catch-all or coverage assert.
- **N3 → T-260828-04:** rescoped eslint test-override block is now dead config.
- **N4 → T-260828-04:** `toolchain.test.ts` uses `JSON.parse` on tsconfig —
  JSONC comments there would fail the suite with a parse error.
- **N5 (latent, revisit with CI):** `postinstall: electron-builder
  install-app-deps` breaks `npm ci --omit=dev` since electron-builder is a
  devDependency. No CI exists yet.
