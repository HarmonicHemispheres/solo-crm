import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The focus ring in the create sheets, checked the way the reviewer proved it
 * broken (T-260828-53): by resolving the cascade across both stylesheets, not
 * by asserting a class name.
 *
 * `.inp { outline: none }` and base.css's global
 * `:focus-visible { outline: 2px solid var(--verdigris) }` have identical
 * specificity (0,1,0), so which one a focused field actually gets is decided
 * by source order alone — and fields.css is applied after base.css. A test
 * that asserted `<input className="inp">`, or even that base.css still
 * contains its `:focus-visible` rule, passes happily while every field in
 * four sheets renders with no visible focus at all. So this file does what a
 * browser does: collect every rule that declares an outline property from
 * both files in load order, keep the ones whose selector matches a `.inp`
 * field in a given focus state, and let specificity-then-order pick the
 * winner.
 *
 * Load order is base.css first (main.tsx imports it as the renderer entry's
 * global stylesheet) then fields.css (imported by Field.tsx, mounted inside
 * the app) — the same order the built bundle showed the reviewer.
 */

/**
 * Read from disk, not imported: Vitest stubs a CSS import to the empty string
 * unless `css` is enabled (`?raw` included), so an import here would resolve
 * every cascade against nothing and pass no matter what the stylesheets say.
 * `styles/base.test.ts` and `styles/tokens.test.ts` read their sources the
 * same way, and this file joins them in tsconfig.node.json for the Node types
 * that needs.
 */
const stylesheets = [
  { name: 'styles/base.css', css: readFileSync(join(import.meta.dirname, '../../styles/base.css'), 'utf8') },
  { name: 'sheets/fields.css', css: readFileSync(join(import.meta.dirname, './fields.css'), 'utf8') }
]

interface Declaration {
  sheet: string
  selector: string
  property: string
  value: string
  /** Position in the concatenated stylesheets — the tiebreak when specificity ties. */
  order: number
  specificity: readonly [number, number, number]
}

/** Everything a `.inp` field's state can be, as far as these selectors care. */
interface ElementState {
  tag: string
  classes: readonly string[]
  pseudoClasses: readonly string[]
}

const KEYBOARD_FOCUS: ElementState = { tag: 'input', classes: ['inp'], pseudoClasses: ['focus', 'focus-visible'] }
const POINTER_FOCUS: ElementState = { tag: 'input', classes: ['inp'], pseudoClasses: ['focus'] }

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Removes at-rule blocks (`@media`, `@supports`) wholesale, brace-balanced.
 * Nothing inside one of them declares an outline today; if that changes, the
 * rules below would need to know the at-rule's condition to resolve honestly,
 * so `assertNoOutlineInsideAtRules` fails the suite rather than letting this
 * simplification quietly start lying.
 */
function stripAtRuleBlocks(css: string): { rest: string; removed: string } {
  let rest = ''
  let removed = ''
  let index = 0
  while (index < css.length) {
    const at = css.indexOf('@', index)
    if (at === -1) {
      rest += css.slice(index)
      break
    }
    const open = css.indexOf('{', at)
    if (open === -1) {
      rest += css.slice(index)
      break
    }
    rest += css.slice(index, at)
    let depth = 0
    let cursor = open
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    removed += css.slice(at, cursor + 1)
    index = cursor + 1
  }
  return { rest, removed }
}

/** `[a, b, c]` — ids, then classes/attributes/pseudo-classes, then elements. */
function specificityOf(selector: string): [number, number, number] {
  const spec: [number, number, number] = [0, 0, 0]
  for (const part of compoundParts(selector)) {
    if (part.startsWith('#')) spec[0] += 1
    else if (part.startsWith(':not(')) {
      const inner = specificityOf(part.slice(5, -1))
      spec[0] += inner[0]
      spec[1] += inner[1]
      spec[2] += inner[2]
    } else if (part.startsWith('.') || part.startsWith('[') || part.startsWith(':')) spec[1] += 1
    else if (part !== '*') spec[2] += 1
  }
  return spec
}

/**
 * Splits one compound selector (`.inp:focus:not(:focus-visible)`) into its
 * simple parts. Throws on a combinator or a pseudo-element: this file only
 * needs to reason about the single element under test, and a selector it
 * cannot reason about must fail loudly rather than be silently treated as
 * non-matching — that silent path is how the original defect would sneak
 * back past this test.
 */
function compoundParts(selector: string): string[] {
  const trimmed = selector.trim()
  if (/[\s>+~]/.test(trimmed)) throw new Error(`unsupported combinator in outline selector: ${selector}`)
  if (trimmed.includes('::')) throw new Error(`unsupported pseudo-element in outline selector: ${selector}`)
  const parts: string[] = []
  let index = 0
  while (index < trimmed.length) {
    const char = trimmed[index]
    let end = index + 1
    if (char === ':' && trimmed.slice(index).startsWith(':not(')) {
      end = trimmed.indexOf(')', index) + 1
      if (end === 0) throw new Error(`unbalanced :not() in outline selector: ${selector}`)
    } else {
      while (end < trimmed.length && !'.:#['.includes(trimmed[end])) end += 1
    }
    parts.push(trimmed.slice(index, end))
    index = end
  }
  return parts
}

function matches(selector: string, state: ElementState): boolean {
  return compoundParts(selector).every((part) => {
    if (part === '*') return true
    if (part.startsWith('.')) return state.classes.includes(part.slice(1))
    if (part.startsWith(':not(')) return !matches(part.slice(5, -1), state)
    if (part.startsWith(':')) return state.pseudoClasses.includes(part.slice(1))
    if (part.startsWith('#') || part.startsWith('[')) return false
    return part.toLowerCase() === state.tag
  })
}

function outlineDeclarations(): Declaration[] {
  const declarations: Declaration[] = []
  let order = 0
  for (const sheet of stylesheets) {
    const { rest } = stripAtRuleBlocks(stripComments(sheet.css))
    for (const [, selectorList, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const declaration of body.split(';')) {
        const [rawProperty, ...rawValue] = declaration.split(':')
        const property = rawProperty.trim()
        if (!property.startsWith('outline') || property === 'outline-offset') continue
        for (const selector of selectorList.split(',')) {
          order += 1
          declarations.push({
            sheet: sheet.name,
            selector: selector.trim(),
            property,
            value: rawValue.join(':').trim(),
            order,
            specificity: specificityOf(selector)
          })
        }
      }
    }
  }
  return declarations
}

/** The declaration a browser would apply for `property` in `state`, or undefined. */
function winner(state: ElementState, property: string): Declaration | undefined {
  const applicable = outlineDeclarations()
    .filter((declaration) => declaration.property === property && matches(declaration.selector, state))
    .sort((a, b) => {
      for (let index = 0; index < 3; index += 1) {
        if (a.specificity[index] !== b.specificity[index]) return a.specificity[index] - b.specificity[index]
      }
      return a.order - b.order
    })
  return applicable.at(-1)
}

describe('the create sheets’ focus ring', () => {
  it('has no outline rule hidden inside an at-rule block, where this file could not resolve it', () => {
    for (const sheet of stylesheets) {
      const { removed } = stripAtRuleBlocks(stripComments(sheet.css))
      expect(removed, `${sheet.name} moved an outline declaration inside an at-rule`).not.toMatch(/outline/)
    }
  })

  it('resolves to base.css’s visible ring on a keyboard-focused .inp field, across both stylesheets', () => {
    const applied = winner(KEYBOARD_FOCUS, 'outline')
    expect(applied).toBeDefined()
    // The exact failure this task exists to close: `.inp { outline: none }`
    // ties base.css on specificity and wins on source order.
    expect(`${applied?.sheet} { ${applied?.selector} }`).toBe('styles/base.css { :focus-visible }')
    expect(applied?.value).toBe('2px solid var(--verdigris)')
  })

  it('lets no outline longhand suppress that ring either', () => {
    for (const property of ['outline-style', 'outline-width', 'outline-color']) {
      const applied = winner(KEYBOARD_FOCUS, property)
      expect(applied?.value ?? '', `${property} suppresses the keyboard focus ring`).not.toMatch(/^(none|0\w*)$/)
    }
  })

  it('still hides the ring a pointer focus would leave behind — what the mockup’s rule was for', () => {
    const applied = winner(POINTER_FOCUS, 'outline')
    expect(`${applied?.sheet} { ${applied?.selector} }`).toBe('sheets/fields.css { .inp:focus:not(:focus-visible) }')
    expect(applied?.value).toBe('none')
  })
})
