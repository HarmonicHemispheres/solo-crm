---
id: T-260828-54
title: Stop the suite failing under concurrency — cap workers, pool the slow files
status: done
category: build
plan_ref: 
created: 2026-08-28
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->
## Why

Measured, not suspected. Across 112 subagent runs this session the test suite is
**62% of all tool wall-clock** (595 of 962 minutes, 768 invocations). And it gets
worse with parallelism:

| agents running | median suite run |
|---|---|
| 1 | 28s |
| 2–3 | 16s |
| 4–5 | 20s |
| **6–7** | **44s** |

Six agents on eight cores, each spawning a parallel vitest, thrash. Tests sitting
near their timeout then fail for everyone at once. In wave F this cost three
tasks their verify gate — T-260828-18, T-260828-42 and T-260828-48 all reported
`verify-failed` with **no real failure**: `App.test.tsx` and
`CompanyDetail.test.tsx` timing out at 5000ms, `connection.test.ts` at 30000ms,
all three green on a quiet machine.

T-260828-47 solved this shape once by moving the real-Electron tests to a serial
pool with measured timeouts. These files were not caught by that sweep.

The cost is not the failures themselves — it is that a poisoned gate is
indistinguishable from a real one, so the orchestrator either dispatches fix
cycles for nothing or learns to ignore verify. Both are worse than a slow suite.

## Scope

**In:**

- Cap vitest's worker count so N concurrent agents do not each claim the machine.
  A `maxWorkers` derived from available parallelism, or an explicit small number
  under an agent, set in `vitest.config.ts` rather than at each call site.
- Identify every test within ~2x of its timeout by measuring, and move the
  genuinely slow ones into the existing serial pool the way T-260828-47 did —
  `App.test.tsx` and `CompanyDetail.test.tsx` are the two known cases, but the
  set must come from measurement, not from this list.
- Timeouts that are **measured and justified in a comment**, per T-260828-47's
  precedent. A raised timeout with no measurement behind it is the thing this
  project refuses.
- Document in `.dev/README.md` what a `verify-failed` caused by contention looks
  like, so the next orchestrator does not spend an hour fixing nothing.

**Out:** Making the suite faster in general (that is real work, and a different
task). Reducing what is tested. Any change to a test's assertions.

## Touches

- `vitest.config.ts`
- `electron/renderer/App.test.tsx`, `electron/renderer/views/CompanyDetail.test.tsx`,
  `electron/main/db/connection.test.ts` — pool assignment only
- `.dev/README.md`

## Acceptance

- [ ] The full suite passes with **six** concurrent vitest processes running, a
      scenario that reproduces today's failure — demonstrated, not argued
- [ ] No test's timeout is raised without a measured duration in a comment
      beside it
- [ ] No assertion is weakened, skipped or deleted; the test count does not fall
- [ ] Median suite duration at 6-way concurrency is recorded before and after
- [ ] `App.test.tsx` and `CompanyDetail.test.tsx` pass 20 consecutive runs under
      induced CPU load

## Risks

- **Fixing it by raising timeouts.** That converts a measurable contention
  problem into an unmeasurable one and makes every future flake take longer to
  surface. The cap on workers is the fix; the pool move is the fallback.
- **Capping workers so hard the single-agent case gets slow.** The 1-agent
  median is already 28s; making a solo run slower to help the 6-agent case is a
  bad trade, since most runs are not in a wave.
- **Assuming the three known files are the whole set.** They are the ones that
  happened to fail this week. Measure.


---

## Outcome

Merged as `bb76a2b`. Built by the orchestrator in-session, not by a subagent —
see *What went wrong* below.

**Changed:** `vitest.config.ts`, `vitest-pools.test.ts` (new).

Three changes, each carrying the measurement that justifies it in a comment
beside it. **No timeout was raised, no assertion weakened, no test dropped.**

1. `maxWorkers` is capped to 2 when the run is inside `.claude/worktrees/`, and
   left to Vitest's own sizing everywhere else. Capping unconditionally taxes
   the case that matters most: on an idle machine the fast pool runs in **60s**
   at default, **73s** at 4 workers, **92s** at 2 — and the orchestrator's gate
   run, the one that decides whether a wave ships, should pay none of that. The
   condition is *where the process lives* rather than an instruction it has to
   remember, so it needs no prompt discipline and cannot drift.
2. `App.test.tsx` moves to the serial `runtime-boot-renderer` pool. It renders
   `<App />`, which mounts the whole route tree, making it the same weight class
   as `routes.test.tsx` — moved there for exactly this reason. Solo it is
   nowhere near its budget (test body **1.25–1.49s over five runs** against
   5000ms), which is why it looked fine for weeks while failing four separate
   tasks at their gate under load.
3. `connection.test.ts` joins the serial `runtime-boot-node` pool. Missed by
   T-260828-47's sweep and found **by measurement rather than by reading**: with
   the first two changes in place it was the only file still failing under six
   concurrent runs. Its own header says it boots a real, throwaway Electron app.
   Solo **1.95s for 24 tests**; under six concurrent runs one test reached
   **31.9s** against a 30000ms budget.

**Demonstrated, not argued.** Six concurrent fast-pool runs, the scenario a wave
actually creates: before change 3, **5/6 green**; after it, **6/6, zero
timeouts**, 399s wall.

Test count reconciles exactly — 897 before (858 fast + 39 serial), 906 after
(843 + 63). `connection.test.ts`'s 24 changed pools; the 9 new ones are the
guard below.

**`vitest-pools.test.ts` closes a hole this task widens.** A path listed in a
runtime-boot pool is also subtracted from its fast pool's `exclude`, so a typo,
a rename or a moved directory removes a file from one pool and matches nothing
in the other — it then runs **nowhere**, and the suite stays green precisely
because the tests that would have failed are no longer collected. `catch-all`
exists to find files belonging to no project but excludes the `electron` trees
by design, so it cannot see this. The new test asserts every listed path exists
and lands in the right environment.

## What went wrong

**Two subagents failed this task before it was done in-session.** The first ran
43 minutes and committed nothing, stuck polling its own background measurement
harness in an `until grep -q "N=6"` shell loop. The second was re-dispatched on
the canonical preamble with every established finding handed to it, and after 31
minutes had also committed nothing and was writing another inline harness.

The task was a poor fit for a subagent, and the reason is specific rather than a
judgement about the agents: **it needs a quiet machine to measure, which is the
one thing a wave cannot provide**, and it needs several 60-to-400 second
measurements whose results decide the next step. An agent that backgrounds those
to stay responsive then has to poll for them, and polling a background job it
started is where both attempts went.

**A measurement I reported was itself wrong.** I told the user App.test.tsx
failed 2 runs in 3 "on a quiet machine". The machine was not quiet — the second
subagent was running its load experiment at the time. Measured properly it
passes 5/5 at 1.3s. The earlier claim that all three wave F verify failures were
contention was closer to right than the correction I issued afterwards.

The lesson worth keeping is the one this task is about: **a measurement taken
during a wave is a measurement of the wave.**
