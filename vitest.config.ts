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
      }
    ]
  }
})
