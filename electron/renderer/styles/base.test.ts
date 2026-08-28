import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const basePath = join(import.meta.dirname, './base.css')
const base = readFileSync(basePath, 'utf8')

describe('base.css', () => {
  it('handles prefers-reduced-motion once, centrally: kills animation/transition everywhere', () => {
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(base).toMatch(/animation: none !important/)
    expect(base).toMatch(/transition: none !important/)
  })

  it('pins the decay meter fill to its final width instead of its 0% start state', () => {
    const reducedMotionBlock = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reducedMotionBlock).toMatch(/\.decay \.fill\s*{\s*width: var\(--w\) !important/)
  })

  it('sets a visible, token-driven focus ring globally rather than per component', () => {
    expect(base).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--verdigris\)/)
  })
})
