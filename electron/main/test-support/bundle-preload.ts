import * as esbuild from 'esbuild'

/**
 * Bundles `entrySourcePath` (electron/preload/index.ts) into a single,
 * self-contained CommonJS file — everything it imports inlined — for the
 * real-Electron sandboxed-preload proof (T-260828-09's bridge.test.ts), and
 * for `preload-weight.test.ts`, which measures the result.
 *
 * "Everything it imports" is, deliberately, now very little: the preload
 * reads `../shared/channel-names`, which imports nothing, so this produces
 * a couple of kilobytes rather than the 204 KB it produced while the names
 * came from `ipc-types.ts` and dragged zod behind them. The single-file
 * requirement below is unchanged and is why this function still exists —
 * it was never about size.
 *
 * This is deliberately a *different* technique from
 * `compile-to-cjs.ts`'s per-file transpile-and-require-graph, and the
 * difference is the point, discovered while building this task: the
 * sandboxed preload's `require()` (`sandbox: true`, T-260828-04) is not
 * plain Node `require` — it refuses to resolve *any* sibling file by
 * relative path (`Error: module not found: ../shared/ipc-types...cjs`,
 * observed directly against a per-file-compiled preload before this
 * function existed), and it cannot resolve `node_modules` either
 * (T-260828-04's outcome: "no node_modules resolution at runtime"). A
 * multi-file `require()` graph — exactly what `compile-to-cjs.ts` produces,
 * and exactly right for testing main-process code, which has no such
 * restriction — cannot run there at all. Only a single, fully self-contained
 * file can, which is the concrete meaning behind T-260828-08's handoff to
 * this task: "if [the preload] imports zod or shared modules you must
 * configure noExternal ... and verify the built index.cjs is
 * self-contained." `electron.vite.config.ts`'s real preload build satisfies
 * this the same way (Rollup, `externalizeDeps` left off `zod` — see that
 * file); esbuild here is a faithful, much cheaper stand-in for a test that
 * needs a fresh bundle on every run rather than depending on `npm run
 * build` having happened first.
 *
 * `electron` is left external — the one specifier the sandboxed preload
 * *does* resolve natively (`contextBridge`/`ipcRenderer` are provided
 * through Electron's own preload-context binding, not `node_modules`
 * resolution).
 */
export function bundlePreloadForTest(entrySourcePath: string): { bundledPath: string } {
  const runId = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  // Written beside the source, like compile-to-cjs.ts's output — matches
  // the .gitignore backstop pattern (electron/**/*.compiled.*.cjs doesn't
  // cover this file's different naming, so .gitignore gets its own
  // electron/**/*.bundled.*.cjs entry alongside it) rather than the OS
  // tmpdir or the repo root.
  const bundledPath = entrySourcePath.replace(/\.ts$/, `.bundled.${runId}.cjs`)

  esbuild.buildSync({
    entryPoints: [entrySourcePath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    external: ['electron'],
    outfile: bundledPath,
    logLevel: 'silent'
  })

  return { bundledPath }
}
