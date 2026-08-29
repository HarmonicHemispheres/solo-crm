import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The off-canvas rail below 900px (T-260828-15).
 *
 * `left: -250px` moves the rail out of sight and does nothing else: it stays
 * in the document and stays focusable, so Tab walked straight into an
 * invisible menu — eleven nav items and a footer, off-screen, with focus rings
 * landing on nothing the user can see. X-06 requires focus visible on every
 * stop, and a stop that cannot be seen at all fails that harder than a missing
 * outline does.
 *
 * **This cannot be asserted from a jsdom render.** jsdom applies no media
 * queries and computes no layout, so a `render()` at any viewport shows the
 * rail as focusable regardless of what the stylesheet says — a DOM test here
 * would pass identically before and after the fix. So this reads the
 * stylesheet, the same technique and for the same reason as
 * `components/sheets/fields.test.ts`.
 *
 * Read from disk rather than imported: Vitest stubs a CSS import to the empty
 * string unless `css` is enabled — `?raw` included, measured in T-260828-58 —
 * so an import would resolve every assertion against nothing and pass no
 * matter what the file contains. Reading from disk is why this file is one of
 * the carve-outs in `eslint.config.js`, `tsconfig.web.json` and
 * `tsconfig.node.json`: it is renderer-adjacent by location but a node-project
 * test by nature, exactly like `styles/tokens.test.ts`, `styles/base.test.ts`
 * and `components/sheets/fields.test.ts` before it.
 */
/**
 * Comments are stripped before anything is matched.
 *
 * Not defensive tidiness — measured. The first version of this file asserted
 * against the raw stylesheet, and the mutation check *passed with the fix
 * removed*: the rule's own explanatory comment contains the words
 * `visibility: hidden`, so every assertion here was matching prose rather than
 * a declaration.
 *
 * A test that reads source must never be able to satisfy itself from a
 * comment. This project has now hit that trap three times — a doc comment
 * tripping `connection.test.ts`'s Database-owner walk, the ADR-003 money guard
 * needing the same strip, and this.
 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const RAIL_CSS = withoutComments(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Rail.css'), 'utf8'))

/** The body of the `@media (max-width: 900px)` block, which is where the off-canvas behaviour lives. */
function offCanvasBlock(): string {
  const start = RAIL_CSS.indexOf('@media (max-width: 900px)')
  expect(
    start,
    'Rail.css no longer has an `@media (max-width: 900px)` block — if the breakpoint moved, this test must move with it rather than silently checking nothing'
  ).toBeGreaterThan(-1)

  // Brace-match from the `{` that opens the media block, so a nested rule's
  // closing brace does not end the slice early.
  const open = RAIL_CSS.indexOf('{', start)
  let depth = 0
  for (let i = open; i < RAIL_CSS.length; i += 1) {
    if (RAIL_CSS[i] === '{') depth += 1
    else if (RAIL_CSS[i] === '}') {
      depth -= 1
      if (depth === 0) return RAIL_CSS.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced braces in Rail.css')
}

/** Declarations inside one selector's rule, within the off-canvas block. */
function rule(selector: string): string {
  const block = offCanvasBlock()
  const at = block.indexOf(`${selector} {`)
  expect(at, `${selector} is not declared inside the max-width: 900px block`).toBeGreaterThan(-1)
  return block.slice(at, block.indexOf('}', at))
}

describe('the off-canvas rail is not in the tab order while it is off-screen', () => {
  it('hides the closed rail from focus and assistive technology, not just from view', () => {
    // `visibility: hidden` is what removes a subtree from the tab order. Moving
    // it off-screen does not: that is the defect this test exists for, and it
    // is why asserting `left: -250px` alone would be asserting the bug.
    expect(rule('.rail')).toMatch(/visibility:\s*hidden/)
  })

  it('makes the open rail visible again', () => {
    expect(rule('.rail.open')).toMatch(/visibility:\s*visible/)
  })

  it('still slides — the closed rail animates `left` and only delays `visibility`', () => {
    // The reason this is `visibility` and not `inert` or `display: none`:
    // visibility is animatable, so the slide survives. If the delay were
    // dropped the rail would vanish on frame one of the closing animation and
    // the transition would be pointless; if `left` fell out of the transition
    // there would be no animation left to protect.
    const closed = rule('.rail')
    expect(closed).toMatch(/left\s+var\(--motion-rail\)/)
    expect(closed).toMatch(/visibility\s+0s\s+linear\s+var\(--motion-rail\)/)
  })

  it('opens without the delay — a rail sliding in is focusable from the first frame', () => {
    expect(rule('.rail.open')).toMatch(/visibility\s+0s\s+linear\s+0s/)
  })

  it('keeps the rail off-screen when closed, which is what made it invisible in the first place', () => {
    // Pinned so a future edit cannot "fix" the tab order by leaving the rail
    // on screen — the two properties are a pair and neither alone is correct.
    expect(rule('.rail')).toMatch(/left:\s*-250px/)
    expect(rule('.rail.open')).toMatch(/left:\s*0/)
  })
})
