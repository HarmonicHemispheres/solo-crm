---
id: T-260828-54
title: Stop the suite failing under concurrency — cap workers, pool the slow files
status: open
category: build
plan_ref: 
created: 2026-08-28
closed:
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
