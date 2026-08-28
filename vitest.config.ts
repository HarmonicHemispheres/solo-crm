import { defineConfig } from 'vitest/config'

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
const RUNTIME_BOOT_NODE_FILES = [
  // Spawns `drizzle-kit generate` as a child process — see the file's own
  // testTimeout comment for the measured duration this budgets for.
  'electron/main/db/schema.test.ts',
  // Spawns a real, throwaway Electron process per test.
  'electron/main/csp-enforcement.test.ts',
  'electron/main/renderer-globals.test.ts',
  'electron/main/ipc/bridge.test.ts'
]

const RUNTIME_BOOT_RENDERER_FILES = [
  // Not a child-process spawn, but a real jsdom render of the whole route
  // table (ten views + two detail routes, mounted and unmounted in a loop)
  // — heavy enough to be the fifth file R-260828-02 caught timing out
  // alongside the Electron-boot ones under load.
  'electron/renderer/routes.test.tsx'
]

export default defineConfig({
  test: {
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
