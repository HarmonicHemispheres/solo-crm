import { defineConfig } from 'vitest/config'

// Per-glob environment via `projects` (environmentMatchGlobs was removed;
// this is Vitest 3/4's replacement — node_modules/vitest/dist/chunks
// /reporters.d.*.d.ts declares TestProjectInlineConfiguration's `extends`).
// A single global `environment: 'node'` would collect a renderer component
// test under electron/renderer and then fail on `document is not defined`.
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
          environment: 'node'
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['electron/renderer/**/*.test.ts', 'electron/renderer/**/*.test.tsx'],
          environment: 'jsdom'
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
      }
    ]
  }
})
