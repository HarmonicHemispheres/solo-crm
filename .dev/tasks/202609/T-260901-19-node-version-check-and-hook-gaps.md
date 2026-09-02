---
id: T-260901-19
title: Turn the Node-version lesson into a check, and close the Stop hook's and tsconfig's coverage gaps
status: done
category: build
created: 2026-09-01
closed: 2026-09-01
---

## Why

`npm test` on the machine's default Node 22.12 killed 25 vitest workers with
"Worker exited unexpectedly" and no test names, because better-sqlite3
segfaults there; the only defence was LESSONS.md line 10. Separately, the
Stop hook's idea of "source" missed `eslint-rules/`, `tests/`, the
electron-vite and drizzle configs and `vitest-pools.test.ts`, and two test
files ran without ever being typechecked.

## Story

As the operator, I run the suite on the wrong Node and get one sentence
telling me which Node to use, not a wall of worker crashes; and a turn that
edits any linted or typechecked file is gated.

## Constraints

- `.dev/README.md`: a lesson a check can enforce becomes the check and
  leaves LESSONS.md.
- The guard must not touch `npm install` or the Electron runtime — only the
  vitest host process is affected.

## Acceptance

- [x] `node_modules/.bin/vitest run …` under Node 22.12 exits with a message
      naming 22.22 before any worker starts.
- [x] `package.json` carries `engines.node`.
- [x] LESSONS.md no longer carries the Node line, and is renumbered.
- [x] `stop-gate.mjs` treats `eslint-rules/`, `tests/`, `electron.vite.config.ts`,
      `drizzle.config.ts` and `vitest-pools.test.ts` as source.
- [x] `npm run typecheck` covers `eslint-rules/*.test.ts` and `vitest-pools.test.ts`.

## Related

`vitest.config.ts`, `scripts/hooks/stop-gate.mjs`, `tsconfig.node.json`,
`.dev/LESSONS.md`, `eslint-rules/no-renderer-node-access.test.ts`.

---

## Outcome

**Changed:** `vitest.config.ts` throws under Node < 22.22 with the fix in the
message; `package.json` `engines`; LESSONS.md line 10 removed and the list
renumbered (13 lines); `stop-gate.mjs` `isSource` widened;
`tsconfig.node.json` includes `eslint-rules/**/*.ts` and
`vitest-pools.test.ts`, with a new `eslint-rules/no-renderer-node-access.d.ts`
so the JavaScript rule's test typechecks.

**Departed from scope:** Nothing.

**Not verified:** The Stop hook was not exercised against a turn that
dirties only `eslint-rules/` — the pattern change is a regex and was read,
not run.

**Elapsed:** ~15 minutes.
