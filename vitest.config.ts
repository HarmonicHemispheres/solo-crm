import { sep } from 'node:path'
import { defineConfig } from 'vitest/config'

// T-260828-54: how many workers one `vitest run` may claim.
//
// Vitest sizes its pool from the whole machine, so on these 8 cores a run takes
// about 7 workers. That is right for one run and wrong for several: during
// run-tasks, four build subagents each start their own vitest, 28 workers land
// on 8 cores, and every test that was comfortably inside its timeout stops
// being so. Measured across 112 subagent runs, the median suite run went from
// ~20s at 2-5 concurrent agents to 44s at 6-7 — and three healthy branches were
// reported `verify-failed` for timeouts that did not reproduce afterwards.
//
// The cap is conditional because capping unconditionally taxes the case that
// matters most. Measured on an idle machine, the fast pool (69 files, 859
// tests): default 60s · maxWorkers=4 73s · maxWorkers=2 92s. The orchestrator's
// gate run — the one that decides whether a wave ships — should pay none of
// that.
//
// So: agents get the cap, everyone else does not. A build subagent always runs
// inside `.claude/worktrees/<id>/`, which is a fact about where it lives rather
// than an instruction it has to remember, so this needs no prompt discipline
// and cannot drift. Four agents at 2 workers is 8 on 8 cores. Override with
// SOLOCRM_TEST_WORKERS when measuring, or when running a wave somewhere with a
// different core count.
const IN_AGENT_WORKTREE = process.cwd().includes(`${sep}.claude${sep}worktrees${sep}`)

/**
 * `undefined` means Vitest's own sizing, which is correct for a lone run.
 * A malformed override is refused loudly rather than coerced: `Number('abc')`
 * is `NaN` and `Number('0')` is zero workers, and both would silently produce
 * a run that is either mis-sized or hung, which is the opposite of what this
 * setting exists to prevent.
 */
function resolveMaxWorkers(): number | undefined {
  const raw = process.env.SOLOCRM_TEST_WORKERS
  if (raw === undefined || raw === '') return IN_AGENT_WORKTREE ? 2 : undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`SOLOCRM_TEST_WORKERS must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return n
}

const maxWorkers = resolveMaxWorkers()

// Per-glob environment via `projects` (environmentMatchGlobs was removed;
// this is Vitest 3/4's replacement — node_modules/vitest/dist/chunks
// /reporters.d.*.d.ts declares TestProjectInlineConfiguration's `extends`).
// A single global `environment: 'node'` would collect a renderer component
// test under electron/renderer and then fail on `document is not defined`.
//
// T-260828-47: five files in here boot a real Electron instance (or a real
// jsdom render tree heavy enough to behave like one) rather than mocking the
// runtime. Collected into the fast `node`/`renderer` pools they compete for
// CPU with every other test file running in parallel and time out under
// load without being wrong — see that task file for the measurements. They
// are carved out into their own `runtime-boot-*` projects below, and
// `package.json`'s `test` script runs those as a second, separate
// `vitest run` invocation *after* the fast pools finish (`fileParallelism:
// false` only forces serial execution of files within one project — it
// does not stop Vitest running a different project's pool at the same
// time, so the two invocations, not this file alone, are what guarantees
// the boot tests never share CPU with the rest of the suite).
export const RUNTIME_BOOT_NODE_FILES = [
  // Spawns `drizzle-kit generate` as a child process — see the file's own
  // testTimeout comment for the measured duration this budgets for.
  'electron/main/db/schema.test.ts',
  // Spawns a real, throwaway Electron process per test.
  'electron/main/csp-enforcement.test.ts',
  'electron/main/renderer-globals.test.ts',
  'electron/main/ipc/bridge.test.ts',
  // T-260828-54: missed by T-260828-47's sweep, and found by measurement rather
  // than by reading — with the other fixes in place it was the only file still
  // failing under six concurrent runs. It belongs here by the same rule as its
  // neighbours: its own header says it "boots a real, throwaway Electron app",
  // and it spawns a second plain-Node process for the kill-mid-transaction
  // case. Solo it is 1.95s for 24 tests; under six concurrent runs one test
  // reached 31.9s against a 30000ms budget. Moving it costs about two seconds
  // of serial time and removes the last contention failure.
  'electron/main/db/connection.test.ts',
  // T-260901-08: spawns a real, throwaway Electron so the *actual*
  // `nativeImage` deriver runs — every other test of the company-images path
  // injects a fake, because `electron` under plain Node resolves to a string
  // path rather than the API. Belongs here by the same rule as its
  // neighbours: it is a real runtime boot, and it compiles a module graph
  // before it starts one.
  'electron/main/images/derive.electron.test.ts'
]

export const RUNTIME_BOOT_RENDERER_FILES = [
  // Not a child-process spawn, but a real jsdom render of the whole route
  // table (ten views + two detail routes, mounted and unmounted in a loop)
  // — heavy enough to be the fifth file R-260828-02 caught timing out
  // alongside the Electron-boot ones under load.
  'electron/renderer/routes.test.tsx',
  // T-260828-54: same weight class, and by construction — it renders `<App />`,
  // which mounts the whole route tree, so it pulls in every view exactly as
  // routes.test.tsx does. Measured on an idle machine it is nowhere near its
  // budget (test body 1.25-1.49s over five runs against the 5000ms default),
  // which is why it looked fine for weeks. Under load it is the single most
  // disruptive file in the suite: it failed four separate tasks at their gate,
  // and the timeouts did not reproduce once the machine was quiet. A file whose
  // pass/fail depends on what else is running does not belong in a parallel
  // pool. No timeout is raised here — it does not need one at 1.3s; it needs to
  // stop sharing CPU.
  'electron/renderer/App.test.tsx',
  // T-260829-14 / R-260829-03, and the clearest case in this list: its
  // `Today at 10x data volume` block does not merely render heavily, it
  // *measures* — §8's 100ms budget, as the median of five renders of 100
  // companies, 1,000 people and 500 engagements each. A wall-clock budget
  // asserted while eight workers compete for CPU measures the machine's
  // load rather than the view. Solo it is 58ms; in the fast pool alongside
  // 95 other files it read 198ms and failed the gate, having passed every
  // check on its own branch. Nothing here is weakened to accommodate that
  // — the budget is still 100 and the fixture still asserts its own shape
  // (40 late rows of 100) so the measurement cannot go vacuous. The file
  // moves whole rather than being split, matching `routes.test.tsx` and
  // `App.test.tsx` above; the seventeen behavioural tests it carries along
  // cost about three seconds of serial time, which is cheaper than a
  // shared fixture module extracted at merge.
  'electron/renderer/views/Today.test.tsx'
]

export default defineConfig({
  test: {
    // Inherited by every project below via `extends: true`. The two
    // runtime-boot pools set `fileParallelism: false`, which pins them to one
    // worker regardless, so this only governs the fast pools.
    maxWorkers,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: [
            'electron/main/**/*.test.ts',
            'electron/preload/**/*.test.ts',
            'electron/shared/**/*.test.ts'
          ],
          exclude: ['**/node_modules/**', '**/.git/**', ...RUNTIME_BOOT_NODE_FILES],
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['electron/renderer/**/*.test.ts', 'electron/renderer/**/*.test.tsx'],
          exclude: ['**/node_modules/**', '**/.git/**', ...RUNTIME_BOOT_RENDERER_FILES],
          environment: 'jsdom',
          setupFiles: ['electron/renderer/test-setup.ts']
        }
      },
      // `projects` is opt-in per glob: a test file that lands outside all
      // three trees above (a new top-level module, a renamed directory) is
      // silently not run at all rather than failing loudly, since it never
      // matches any project's `include`. This catches that gap by running
      // anything the named projects didn't claim, under the same default
      // 'node' environment the toolchain checks already use.
      {
        extends: true,
        test: {
          name: 'catch-all',
          include: ['**/*.test.{ts,tsx}'],
          exclude: [
            '**/node_modules/**',
            // Agent worktrees carry whole checkouts, tests included — the
            // normal state mid run-tasks. Collecting them runs foreign tests
            // in the wrong environment against stale code.
            '.claude/**',
            'electron/main/**/*.test.ts',
            'electron/preload/**/*.test.ts',
            'electron/shared/**/*.test.ts',
            'electron/renderer/**/*.test.ts',
            'electron/renderer/**/*.test.tsx'
          ],
          environment: 'node'
        }
      },
      // The serial pool (T-260828-47). `fileParallelism: false` overrides
      // `maxWorkers` to 1 for this project, so its files run one after
      // another rather than racing each other for CPU too — five real
      // runtime boots in parallel would just relocate the contention
      // instead of removing it.
      {
        extends: true,
        test: {
          name: 'runtime-boot-node',
          include: RUNTIME_BOOT_NODE_FILES,
          environment: 'node',
          fileParallelism: false
        }
      },
      {
        extends: true,
        test: {
          name: 'runtime-boot-renderer',
          include: RUNTIME_BOOT_RENDERER_FILES,
          environment: 'jsdom',
          setupFiles: ['electron/renderer/test-setup.ts'],
          fileParallelism: false
        }
      }
    ]
  }
})
