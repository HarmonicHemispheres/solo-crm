import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_BOOT_NODE_FILES, RUNTIME_BOOT_RENDERER_FILES } from './vitest.config'

/**
 * T-260828-54.
 *
 * The two `runtime-boot` pools are opt-in by exact path, and each listed path
 * is *also* subtracted from its fast pool's `exclude`. So a path that is wrong
 * — a typo, a renamed file, a moved directory — removes a test file from the
 * fast pool and matches nothing in the serial pool, and the file then runs
 * **nowhere**. The suite stays green because the tests that would have failed
 * are no longer collected.
 *
 * `catch-all` exists to find files that belong to no project, but it excludes
 * the whole `electron/renderer` and `electron/main` trees by design, so it
 * cannot see this particular hole. This test can.
 *
 * It lives at the repo root rather than beside the config because `catch-all`
 * is the only project whose `include` reaches here, which also means this file
 * is itself proof that the catch-all glob still works.
 */
describe('runtime-boot pool membership', () => {
  const listed = [
    ...RUNTIME_BOOT_NODE_FILES.map((path) => ['runtime-boot-node', path] as const),
    ...RUNTIME_BOOT_RENDERER_FILES.map((path) => ['runtime-boot-renderer', path] as const)
  ]

  it.each(listed)('%s: %s exists on disk', (_pool, path) => {
    expect(existsSync(path), `${path} is listed in a runtime-boot pool but does not exist — it is excluded from its fast pool and collected by nothing, so it runs nowhere`).toBe(true)
  })

  it('lists every path exactly once, across both pools', () => {
    const paths = listed.map(([, path]) => path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('routes node files to the node pool and renderer files to the renderer pool', () => {
    // A .tsx in the node pool would run without jsdom; a renderer path in the
    // node list would fail on `document is not defined` rather than on anything
    // it meant to assert.
    for (const path of RUNTIME_BOOT_NODE_FILES) expect(path.startsWith('electron/renderer/')).toBe(false)
    for (const path of RUNTIME_BOOT_RENDERER_FILES) expect(path.startsWith('electron/renderer/')).toBe(true)
  })
})
