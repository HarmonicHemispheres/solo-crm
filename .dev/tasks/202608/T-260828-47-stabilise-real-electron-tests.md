---
id: T-260828-47
title: Stop the real-Electron tests timing out under parallel load
status: open
category: build
plan_ref:
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The verify gate is not trustworthy under load, and R-260828-02 is the second run
to hit it.

Five test files boot a real Electron instance or a real jsdom environment and
time out when the full suite runs while other agents are working the same
machine. Every one passes in isolation in a few seconds:

- `electron/main/db/schema.test.ts` — spawns `drizzle-kit generate` as a child
  process against vitest's fixed 5000ms default
- `electron/main/csp-enforcement.test.ts`
- `electron/main/renderer-globals.test.ts`
- `electron/main/ipc/bridge.test.ts`
- `electron/renderer/routes.test.tsx`

Measured on T-260828-22's fix pass: five consecutive full-suite runs gave four
green and one red, with three of these files timing out together in the red run.
T-260828-16's builder independently hit two of them with system CPU pinned at
100% by a sibling agent. R-260828-01 recorded the same class of failure and
"fixed with a readiness handshake instead of sleeps" — the handshake helped, the
contention did not go away.

The cost is not the flake itself, it is what it does to judgement. A subagent
that sees red has to decide whether it is real, and the honest ones burn a
re-run in isolation to find out while the careless ones would just call the
branch broken — or, worse, quietly raise a timeout, which `verify` explicitly
forbids. This run had to hand every subagent a written list of known-flaky files
so they could tell a flake from a failure. That list is a workaround, and it
will rot.

## Scope

**In:**

- Make the real-Electron and real-jsdom tests not compete with the rest of the
  suite. The likely shape is a vitest project or workspace split — a fast pool
  for pure unit tests and a serial pool (`singleThread` / `fileParallelism:
  false`) for the ones that boot a runtime — run one after the other by
  `npm test`. R-260828-01 already concluded "run boot-real tests serially"; this
  makes that structural rather than advisory.
- Give the child-process and runtime-boot tests a timeout that reflects what
  they actually do. `schema.test.ts` spawning `drizzle-kit` against a 5000ms
  default is a mis-set budget, not a slow test. **This is a deliberate,
  reviewed change to a check** — which is exactly why it needs its own task
  rather than being done under pressure inside another one, where `verify`
  rightly forbids it.
- A `npm run test:unit` that excludes the runtime-boot files, so an agent
  iterating on a repository gets a fast signal without touching the slow pool.
- Delete the hand-maintained known-flake list from the orchestration prompts
  once the split makes it unnecessary.

**Out:** Weakening any assertion. Deleting or skipping any test — every one of
these covers something real (CSP enforcement, renderer globals, the preload
bridge, the route table, migration drift), and losing them to make the suite
quiet would be a much worse outcome than the flake. Rewriting the tests to stop
using a real Electron instance; the whole point of those five is that they
exercise the real runtime.

## Touches

- `vitest.config.ts` — likely becomes a projects/workspace config
- `package.json` — `test`, plus a new `test:unit`
- Possibly per-file `testTimeout` on the runtime-boot tests

## Acceptance

- [ ] Ten consecutive `npm test` runs are green with a second CPU-saturating
      process running alongside — the condition that actually reproduces this,
      stated with the load used
- [ ] No assertion is weakened and no test is skipped or deleted — the diff
      shows only configuration and timeout changes
- [ ] `npm run test:unit` excludes all five runtime-boot files and finishes
      substantially faster than the full suite
- [ ] Each raised timeout is justified in a comment naming what the test waits
      on, so the number is a budget rather than a guess
- [ ] The full suite still reports the same test count as before the split — no
      file silently dropped out of a pool

## Risks

- **Raising timeouts until it goes quiet.** That converts a flaky test into a
  slow test that fails later and more confusingly. The serial pool is the actual
  fix; timeouts only correct budgets that were never right.
- **A file that belongs to neither pool, or both.** The acceptance criterion
  about the total test count exists because a projects config makes it easy to
  lose a file silently.
- **Masking a genuine deadlock.** If one of these tests is timing out because it
  never resolves rather than because it is slow, serialising it hides a real
  bug. Confirm each one actually completes, and how long it takes, before
  choosing its budget.
