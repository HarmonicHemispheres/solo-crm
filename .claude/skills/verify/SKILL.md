---
name: verify
description: Run the project's checks — typecheck, lint, tests, screenshots for UI, migrations for db — and report what actually passed. Use before closing a task, before a commit, or when asked whether the tree is green. Reports failures faithfully; never weakens a check to make it pass.
---

# Verify

**A failing check is a result, not an obstacle.** Never delete, skip, `.only`,
`.skip`, loosen an assertion, raise a timeout or add an expected-failure marker
to get a green run. If a check is genuinely wrong, say so and leave it
failing; changing it is its own task.

## Iterating versus gating

While mid-change, run only what covers what you touched:

```
node_modules/.bin/vitest run path/to/thing.test.ts
node_modules/.bin/vitest run electron/main/db
npm run test:unit                    # the fast pool
```

When handing off or closing, run everything once, cheapest first:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. If the diff touches `db/`: migrations apply to a fresh database **and** to
   a copy of an existing one.
5. If the diff touches `renderer/`: `npm run build && npm run snap`, then read
   the screenshots. jsdom computes no layout; a width or overflow assertion
   there passes against broken CSS.
6. `npm run check:index`

The Stop hook already runs 1, 2 and 6 whenever a turn ends with dirty source,
so a failure in those reaches you without asking.

## Environment

System Node 22.12 segfaults better-sqlite3 under vitest. Use 22.22 or later:
`nvm use 22.22.0`, or prepend `%APPDATA%\nvm\v22.22.0` to `PATH`.

Never run bare `npx vitest run`; with no project filter it runs the serial
Electron pools too. Prefer `node_modules/.bin/vitest` over `npx`.

## Reporting

State what you ran, what passed, what failed with the real output. If you ran
a reduced set, say which and why. Never report a check as passing that you did
not run.

A timeout is not a failure until it reproduces alone. Re-run that file by
itself and say whether it reproduced. A pre-existing failure on a clean tree is
not this task's to fix but is this task's to report.
