import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * tsconfig files are JSONC (comments and trailing commas allowed), not
 * strict JSON — `JSON.parse` throws the moment either appears. `tsc` itself
 * tolerates both, so a config that typechecks cleanly could still make a
 * plain `JSON.parse` here throw. `parseConfigFileTextToJson` is the same
 * tolerant parser the compiler uses on tsconfig files.
 */
function readJsonc(path: string): unknown {
  const text = readFileSync(path, 'utf-8')
  const { config, error } = ts.parseConfigFileTextToJson(path, text)
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  }
  return config
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>
}

describe('toolchain scripts', () => {
  it('typechecks main/preload and the renderer through separate tsconfigs, via tsc', () => {
    // A stub like `"typecheck": "exit 0"` would satisfy a weaker
    // "not exit 0" check; asserting the real tool is invoked is what makes
    // this catch a stubbed script instead of just an absent one.
    expect(pkg.scripts.typecheck).toMatch(/\btsc\b/)
    expect(pkg.scripts.typecheck).toContain('tsconfig.node.json')
    expect(pkg.scripts.typecheck).toContain('tsconfig.web.json')
  })

  it('lints via eslint', () => {
    expect(pkg.scripts.lint).toMatch(/\beslint\b/)
  })

  it('tests via vitest', () => {
    expect(pkg.scripts.test).toMatch(/\bvitest\b/)
  })

  it('runs dev and build via electron-vite', () => {
    expect(pkg.scripts.dev).toMatch(/\belectron-vite\b/)
    expect(pkg.scripts.build).toMatch(/\belectron-vite\b/)
  })
})

describe('renderer Node boundary', () => {
  // A single permissive tsconfig would let renderer code `import fs` and
  // typecheck cleanly — the exact thing AGENTS.md forbids, made invisible.
  // This asserts the boundary directly instead of only via the scripts'
  // string contents above: tsconfig.web.json must declare no "node" types,
  // so a later edit that adds "node" to fix an unrelated error fails here
  // rather than only showing up the next time someone happens to `import fs`.
  const tsconfigWeb = readJsonc(resolve(root, 'tsconfig.web.json')) as {
    compilerOptions: { types?: string[]; lib?: string[] }
  }

  it('tsconfig.web.json declares no "node" types', () => {
    const types = tsconfigWeb.compilerOptions.types ?? []
    expect(types).not.toContain('node')
  })

  it('tsconfig.web.json declares DOM, not Node, libs', () => {
    const lib = tsconfigWeb.compilerOptions.lib ?? []
    expect(lib).toContain('DOM')
  })
})
