import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf-8')) as {
  scripts: Record<string, string>
}

describe('toolchain scripts', () => {
  it('declares the commands verify depends on, each doing real work', () => {
    const required = ['dev', 'build', 'typecheck', 'lint', 'test']

    for (const name of required) {
      expect(pkg.scripts).toHaveProperty(name)
      // Guards against a script stubbed to `exit 0` just to make the set
      // look complete — verify would then report a check that never ran.
      expect(pkg.scripts[name]).not.toMatch(/^exit\s+0$/)
    }
  })

  it('typechecks main/preload and the renderer through separate tsconfigs', () => {
    expect(pkg.scripts.typecheck).toContain('tsconfig.node.json')
    expect(pkg.scripts.typecheck).toContain('tsconfig.web.json')
  })
})
