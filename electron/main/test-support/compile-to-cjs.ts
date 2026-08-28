import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import ts from 'typescript'

/**
 * Recursively transpiles `entrySourcePath` and every local (relative-path)
 * module it transitively `import`s to CommonJS, writing each `.cjs` sibling
 * beside its own `.ts` source, so a spawned real-Electron test process's
 * `require('better-sqlite3')` / `require('electron')` / `require('zod')`
 * resolve through the ordinary `node_modules` walk from each file's real
 * location — the spawned process runs the real modules under test rather
 * than a hand-reimplementation of their logic.
 *
 * Extracted from `db/connection.test.ts` (originally `compileConnectionModule`,
 * T-260828-07) so `electron/main/ipc`'s own real-Electron boot test
 * (T-260828-09) can compile a different entry point (`electron/main/ipc/index.ts`)
 * with the identical technique instead of duplicating it. See that test file's
 * header comment for the fuller "why not just run the real build" rationale;
 * nothing about the technique itself changed in the extraction.
 *
 * Vite's `?raw` suffix (used by `electron/main/db/migrations/index.ts` to
 * bundle `0001_init.sql`'s text) is a bundler feature `ts.transpileModule`
 * knows nothing about — `inlineRawSqlImports` below turns that one import
 * line into a plain `const` on the *source* text before transpilation,
 * simpler and more robust than pattern-matching whatever esModuleInterop's
 * CJS output would otherwise emit for an import specifier it cannot resolve.
 *
 * Every compiled file's own output still contains a bare
 * `require("./whatever")` (transpileModule rewrites the `import` keyword but
 * not the module specifier). Two problems with resolving that literally:
 * Node's default extensionless `require` resolution tries `.js`/`.json`/`.node`,
 * never `.cjs`; and this project's package.json sets `"type": "module"`, so a
 * same-named `.js` file would be loaded as an ES module and crash on the
 * transpiled output's `exports.x = ...`. So every dependency is written out
 * as `.cjs` — always unambiguous CommonJS to Node regardless of `"type"` —
 * and every local `require` in a compiled file's output is rewritten to name
 * the matching `.cjs` path explicitly, sidestepping extension-guessing
 * altogether. Each generated filename carries a run-specific suffix so a
 * shared dependency (e.g. `electron/shared/format.ts`) compiled by two
 * overlapping harness runs cannot collide; `.gitignore` backstops every
 * generated name in case a run is interrupted before its caller's cleanup
 * runs — see that file's own comment for the exact pattern
 * (`electron/**\/*.compiled.*.cjs`), which covers this module's output too.
 *
 * `import type` (a whole-statement type-only import, as used by e.g.
 * `electron/shared/ipc-types.ts` for `Registry` from `electron/main/ipc/registry.ts`)
 * is erased by `ts.transpileModule` on a per-file basis — TypeScript doesn't
 * need cross-file information to know an explicitly-`type`-tagged import
 * produces no runtime code, so the emitted output contains no `require(...)`
 * for it at all, and this function never attempts to recurse into it.
 */
export function compileToCommonJs(entrySourcePath: string): {
  entryPath: string
  generatedPaths: string[]
  /**
   * Absolute source `.ts` path -> the `.cjs` path it was compiled to. Lets a
   * caller `require()` a *specific* transitive dependency directly (e.g.
   * `electron/main/ipc`'s real-Electron boot test opens the database
   * through the same compiled `connection.ts` module its compiled
   * `registry.ts` reaches through `getDatabase()` — two separate
   * `compileToCommonJs()` calls for the same source would produce two
   * distinct `.cjs` files with two independent copies of connection.ts's
   * module-level `handle` state, and `getDatabase()` would throw "before
   * openDatabase" against the wrong copy).
   */
  compiledPathFor: ReadonlyMap<string, string>
} {
  const runId = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  const compiledFor = new Map<string, string>() // source .ts absolute path -> written .cjs absolute path
  const generatedPaths: string[] = []

  function compile(sourcePath: string): string {
    const already = compiledFor.get(sourcePath)
    if (already) return already

    const sourceDir = dirname(sourcePath)
    const cjsPath = sourcePath.replace(/\.ts$/, `.compiled.${runId}.cjs`)
    // Reserved before recursing so a (currently nonexistent, but not worth
    // assuming away) dependency cycle terminates instead of looping.
    compiledFor.set(sourcePath, cjsPath)

    const source = inlineRawSqlImports(readFileSync(sourcePath, 'utf-8'), sourceDir)
    const rawOutput = transpileSourceToCommonJs(source, sourcePath)

    const output = rawOutput.replace(
      /require\((['"])(\.\.?\/[^'"]+)\1\)/g,
      (_match, _quote: string, specifier: string) => {
        const depSourcePath = resolveLocalTsFile(sourceDir, specifier)
        const depCjsPath = compile(depSourcePath)
        const relativeSpecifier = relative(sourceDir, depCjsPath).split(sep).join('/')
        const normalised = relativeSpecifier.startsWith('.') ? relativeSpecifier : `./${relativeSpecifier}`
        return `require(${JSON.stringify(normalised)})`
      }
    )

    writeFileSync(cjsPath, output, 'utf-8')
    generatedPaths.push(cjsPath)
    return cjsPath
  }

  const entryPath = compile(entrySourcePath)
  return { entryPath, generatedPaths, compiledPathFor: compiledFor }
}

function inlineRawSqlImports(source: string, sourceDir: string): string {
  return source.replace(
    /import\s+(\w+)\s+from\s+(['"])(\.\/[^'"]+\.sql)\?raw\2/g,
    (_match, bindingName: string, _quote: string, relativeSqlPath: string) => {
      const sqlContent = readFileSync(join(sourceDir, relativeSqlPath), 'utf-8')
      return `const ${bindingName} = ${JSON.stringify(sqlContent)}`
    }
  )
}

function transpileSourceToCommonJs(source: string, fileName: string): string {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName
  })
  return outputText
}

/** Resolves a relative import specifier to the `.ts` source file it names, Node-style (a bare file, or a directory's `index.ts`). */
function resolveLocalTsFile(fromDir: string, specifier: string): string {
  const direct = `${join(fromDir, specifier)}.ts`
  if (existsSync(direct)) return direct
  const asIndex = join(fromDir, specifier, 'index.ts')
  if (existsSync(asIndex)) return asIndex
  throw new Error(
    `compileToCommonJs cannot resolve local import "${specifier}" from ${fromDir} — ` +
      'the source or the transpiler output shape must have changed; update this harness to match.'
  )
}
