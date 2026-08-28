import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The acceptance test for tokens.css is "diffed mechanically, not by eye"
 * (T-260828-11) — this is that diff, kept as a standing test instead of a
 * one-off script, so a future edit to either file that lets them drift
 * apart fails `npm test` instead of waiting to be noticed by eye.
 */

function extractFirstRootBlock(css: string): string {
  const start = css.indexOf(':root')
  if (start === -1) throw new Error('no :root block found')
  const braceOpen = css.indexOf('{', start)
  let depth = 0
  let i = braceOpen
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return css.slice(braceOpen + 1, i)
}

function parseCustomProperties(body: string): Map<string, string> {
  const props = new Map<string, string>()
  // No trailing `;` required — a final declaration without one must not
  // silently vanish from the comparison (T-260828-11 review, S3).
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    props.set(match[1], match[2].trim().replace(/\s+/g, ' '))
  }
  return props
}

const mockupPath = join(import.meta.dirname, '../../../planning/solo-crm-mockup.html')
const tokensPath = join(import.meta.dirname, './tokens.css')

describe('tokens.css vs the mockup\'s :root', () => {
  const html = readFileSync(mockupPath, 'utf8')
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  if (!styleMatch) throw new Error('mockup has no <style> block')
  const mockupProps = parseCustomProperties(extractFirstRootBlock(styleMatch[1]))

  const tokensCss = readFileSync(tokensPath, 'utf8')
  const tokensProps = parseCustomProperties(extractFirstRootBlock(tokensCss))

  it('the mockup actually has custom properties to compare against (guards against the extraction itself silently finding nothing)', () => {
    // The exact count, not just non-zero: an extraction regression that
    // drops half the properties would otherwise still compare "everything
    // it found" and pass.
    expect(mockupProps.size).toBe(23)
  })

  it.each([...mockupProps.entries()])('--%s is lifted verbatim', (name, mockupValue) => {
    expect(tokensProps.get(name)).toBe(mockupValue)
  })
})
