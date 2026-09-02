import { readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundlePreloadForTest } from '../main/test-support/bundle-preload'

/**
 * What the preload is allowed to weigh, and what it is allowed to contain.
 *
 * `index.ts` needs exactly two things: `electron`, and a list of channel
 * names. For a long stretch it imported that list from
 * `../shared/ipc-types`, whose `CHANNEL_NAMES` was `Object.keys(
 * CHANNEL_CONTRACTS)` — so the bundle carried zod and every entity schema
 * in `electron/shared/`, all of them *constructed* in the sandboxed preload
 * context before each window could load, to produce sixty-eight strings.
 * 204 KB. Nothing failed; it was simply the whole schema layer running in
 * the one process with no use for it (`channel-names.ts`'s header, and
 * `index.ts`'s).
 *
 * Nothing about that was visible from any existing check. `bridge.test.ts`
 * proves the preload *works* end to end in a real Electron window, which it
 * did before and after — a working bridge is exactly what a 204 KB bundle
 * looks like. So the property gets asserted directly, on the same esbuild
 * bundle `bridge.test.ts` boots.
 *
 * The two assertions are deliberately different in kind. The size ceiling is
 * a blunt instrument with a lot of headroom — it catches "something large
 * got pulled in" without anyone having to predict what. The identifier scan
 * is specific: it names the failure mode that actually happened, so a
 * regression reads as "the preload imported ipc-types again", not as "a
 * number went up".
 *
 * If a future change genuinely needs something bigger in here, move the
 * ceiling in the same commit and say why. It is a tripwire, not a budget.
 */
describe('the preload bundle carries the bridge and nothing else', () => {
  const entry = join(import.meta.dirname, 'index.ts')

  /**
   * ~2 KB is the honest size of `buildCrmApi` plus sixty-eight string
   * literals plus the `contextIsolated` guard. 24 KB leaves an order of
   * magnitude of room for the preload to grow on its own terms while still
   * sitting far below anything that has a schema layer in it — zod alone is
   * several times this.
   */
  const CEILING_BYTES = 24 * 1024

  it(`bundles to under ${CEILING_BYTES} bytes`, () => {
    const { bundledPath } = bundlePreloadForTest(entry)
    try {
      const bytes = statSync(bundledPath).size
      expect(bytes, `preload bundle is ${bytes} bytes — see this file's header before raising the ceiling`).toBeLessThan(
        CEILING_BYTES
      )
    } finally {
      rmSync(bundledPath, { force: true })
    }
  })

  it('contains no zod and no entity schema — only channel names reach it from electron/shared', () => {
    const { bundledPath } = bundlePreloadForTest(entry)
    try {
      const source = readFileSync(bundledPath, 'utf8')

      // Identifiers zod's own bundle defines, and one schema name from
      // `CHANNEL_CONTRACTS`'s import list. Any of them appearing means a
      // value import of ipc-types (or of a schema module) is back.
      for (const forbidden of ['ZodObject', '_zod', 'companySchema', 'CHANNEL_CONTRACTS']) {
        expect(source, `"${forbidden}" is in the preload bundle — it imported more than ../shared/channel-names`).not.toContain(
          forbidden
        )
      }

      // The positive half: the names it does need are actually in there, so
      // this test cannot pass against an empty or broken bundle.
      expect(source).toContain('companies:list')
      expect(source).toContain('settings:reset')
    } finally {
      rmSync(bundledPath, { force: true })
    }
  })

  /**
   * The same claim as the two above, made one level earlier — at the source
   * of `channel-names.ts` rather than at the output of bundling it. Worth
   * both: the bundle tests say "the preload is small", this one says why,
   * and it is the one that names the file a careless `import` would go into.
   *
   * It lives here rather than beside `channel-names.test.ts` because it
   * needs `node:fs`, and `electron/shared/**` compiles under
   * tsconfig.web.json too (see `shared/types.ts`'s header on that
   * directory's no-Node-no-DOM rule).
   */
  it('reads channel-names.ts, which itself imports nothing', () => {
    // Comments stripped before matching — LESSONS.md line 3. That file's
    // header uses the words "import" and "from" in prose repeatedly, and a
    // scan that reads them is asserting against documentation.
    const source = readFileSync(join(import.meta.dirname, '..', 'shared', 'channel-names.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const imports = source.match(/^\s*(?:import|export)\s.*\sfrom\s.*$/gm) ?? []
    expect(imports, `channel-names.ts must import nothing — found: ${imports.join(' | ')}`).toEqual([])
  })
})
