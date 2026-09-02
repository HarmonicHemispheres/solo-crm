import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Companies stylesheet's own contract — the half of T-260901-15 that
 * `Companies.test.tsx` cannot reach.
 *
 * A company's banner sits behind its card as a wash under a gradient, and the
 * gradient is the *whole* legibility argument: "Legibility is a requirement,
 * not an outcome" (the task), and the card's text has to hold up over a fully
 * white banner and a fully black one alike. jsdom paints nothing — Vitest
 * runs with `css: false`, so an imported stylesheet is an empty module and
 * `getComputedStyle` never sees a rule from this file — which makes a
 * rendered assertion impossible and, as it happens, weaker than what is here:
 * these read the rule and do the WCAG arithmetic on its actual stops, so they
 * fail when the *guarantee* is lost rather than when one fixture happens to
 * look wrong.
 *
 * Reading a checked-in stylesheet off disk is this project's established
 * shape for that (`styles/tokens.test.ts`, `styles/base.test.ts`,
 * `components/sheets/fields.test.ts`, `components/shell/Rail.test.ts`), and
 * this file joins them in the same three carve-outs: `tsconfig.web.json`'s
 * exclude, `tsconfig.node.json`'s include, and `eslint.config.js`'s renderer
 * `ignores` for `local/no-renderer-node-access`. It is test tooling that
 * happens to live beside the stylesheet it verifies, not renderer code.
 */

const companiesCss = readFileSync(join(import.meta.dirname, 'Companies.css'), 'utf8')
const tokensCss = readFileSync(join(import.meta.dirname, '../styles/tokens.css'), 'utf8')
/**
 * The identity mark's own rules — `.cmark`, its image variant and
 * `.cmark-img` — moved out of this stylesheet in T-260901-30, into a global
 * one loaded from `main.tsx`. They were declared in four view stylesheets at
 * once, all unscoped, so only one copy was ever governing anything. The card
 * still renders the mark, so the assertions about it stay here and read the
 * file that now owns them.
 */
const identityMarkCss = readFileSync(join(import.meta.dirname, '../styles/identity-mark.css'), 'utf8')

interface CssRule {
  selector: string
  body: string
}

/**
 * Flat rule list. `Companies.css` has no `@media` and no nesting, so a
 * single-depth split is exact rather than approximate — a nested block would
 * surface as an unparsable selector and fail the lookups below loudly instead
 * of being silently mis-attributed.
 */
function parseRules(css: string): CssRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(withoutComments))) {
    rules.push({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2].trim().replace(/\s+/g, ' ') })
  }
  return rules
}

const RULES = parseRules(companiesCss)
const IDENTITY_MARK_RULES = parseRules(identityMarkCss)

function ruleFor(selector: string): CssRule | undefined {
  return RULES.find((rule) => rule.selector === selector)
}

/** The same lookup against the shared identity-mark stylesheet. */
function markRuleFor(selector: string): CssRule | undefined {
  return IDENTITY_MARK_RULES.find((rule) => rule.selector === selector)
}

/** Every rule in the file whose body declares the given property. */
function rulesSetting(property: string): CssRule[] {
  return RULES.filter((rule) => new RegExp(`(^|;)\\s*${property}\\s*:`).test(rule.body))
}

type Rgb = readonly [number, number, number]

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

/** A `tokens.css` colour, by name — read rather than restated, so a token edit moves these assertions with it (and so this file holds no colour literal of its own). */
function token(name: string): Rgb {
  const match = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss)
  if (!match) throw new Error(`no --${name} in tokens.css`)
  const hex = match[1]
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ]
}

/**
 * Every `color-mix(in srgb, var(--surface) N%, transparent)` stop in a
 * gradient, as its N — how much of the ground is the card's own surface, and
 * so how much of the banner shows through. A bare `var(--surface)` stop is
 * total coverage and counts as 100.
 */
function surfaceCoverageStops(body: string): number[] {
  const stops: number[] = []
  const mixed = /color-mix\(in srgb, var\(--surface\) (\d+(?:\.\d+)?)%, transparent\)/g
  let match: RegExpExecArray | null
  while ((match = mixed.exec(body))) stops.push(Number(match[1]))
  const bare = /var\(--surface\)\s+\d+(?:\.\d+)?%/g
  while (bare.exec(body)) stops.push(100)
  return stops
}

/** `base` painted at `alpha` over `backdrop` — the ground under the card's text where the gradient covers the banner by that fraction. */
function coverage(base: Rgb, backdrop: Rgb, alpha: number): Rgb {
  return [base[0] * alpha + backdrop[0] * (1 - alpha), base[1] * alpha + backdrop[1] * (1 - alpha), base[2] * alpha + backdrop[2] * (1 - alpha)]
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio, 1–21. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WASH_GRADIENT = '.ccard.has-banner .ccard-wash::after'

describe('Companies.css — the banner wash', () => {
  it('keeps the card\'s text legible over a fully white banner and a fully black one, by the gradient\'s own stops', () => {
    const rule = ruleFor(WASH_GRADIENT)
    if (!rule) throw new Error(`no gradient rule for ${WASH_GRADIENT}`)

    const stops = surfaceCoverageStops(rule.body)
    expect(stops.length).toBeGreaterThanOrEqual(2)

    // The card's lower half — tags, decay meter, cadence figure — stands on
    // fully opaque `--surface`, i.e. on exactly the ground an un-bannered
    // card gives it, so the banner cannot touch its contrast at all. A
    // gradient that never reached 100% would leave all of it over an image.
    expect(rule.body).toContain('var(--surface) 100%')

    const surface = token('surface')
    const papyrus = token('papyrus')
    const mute = token('mute')
    // The weakest stop is where the most banner shows through — the top edge
    // of the card, behind the name and its metadata line, and the only place
    // in the card where the image affects anything.
    const weakest = Math.min(...stops)

    for (const banner of [WHITE, BLACK]) {
      const ground = coverage(surface, banner, weakest / 100)
      // `.nm`, the company name — `--papyrus`, inherited from the body.
      expect(contrastRatio(papyrus, ground)).toBeGreaterThanOrEqual(4.5)
      // `.meta`, the website line under it.
      expect(contrastRatio(mute, ground)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('steps the metadata line up to --mute under a banner, which is the colour the contrast check above assumes', () => {
    // `.meta` is `--faint` globally (styles/base.css) and measures 3.0:1 even
    // on a bare card; under a white banner's bleed it would fall below 2:1.
    // The check above is only worth anything if this rule is what actually
    // paints that line, so the two are asserted together rather than one
    // trusting a comment about the other.
    expect(ruleFor('.ccard.has-banner .top .meta')?.body).toContain('color: var(--mute)')
    expect(tokensCss).toMatch(/--faint\s*:/)
  })

  it('reaches no card that has no banner — the wash is gated on classes an un-bannered card never carries', () => {
    // The stylesheet half of "renders exactly as it does today". The view
    // only emits `has-banner`/`ccard-wash` when a banner really exists
    // (asserted in Companies.test.tsx), so a rule that needs one of those
    // cannot match an ordinary card — and this says no *other* rule puts an
    // image behind one either.
    expect(rulesSetting('background-image').map((rule) => rule.selector)).toEqual([WASH_GRADIENT])

    // `.ccard` itself is untouched: still the flat surface panel, with no
    // background image and no positioning of its own (the stacking context
    // the wash needs is on `.has-banner`, not here).
    const card = ruleFor('.ccard')
    expect(card?.body).toContain('background: var(--surface)')
    expect(card?.body).not.toContain('background-image')
    expect(card?.body).not.toContain('position:')
    expect(ruleFor('.ccard.has-banner')?.body).toContain('isolation: isolate')
  })

  it('puts the wash behind every one of the card\'s children, including its focus ring, and lets the click through', () => {
    // The two risks the task names. `z-index: -1` inside the card's own
    // stacking context puts the layer above the card's background and below
    // all of its content — a layer that painted over the button would swallow
    // `:focus-visible`'s outline, which `ui-design.md` makes a v1
    // requirement. `pointer-events: none` keeps `.ccard` one clickable
    // button rather than a button with a dead rectangle on it.
    const wash = ruleFor('.ccard .ccard-wash')
    expect(wash?.body).toContain('z-index: -1')
    expect(wash?.body).toContain('pointer-events: none')
    expect(wash?.body).toContain('position: absolute')
  })

  it('adds no animation, so prefers-reduced-motion has nothing new to turn off', () => {
    for (const selector of [WASH_GRADIENT, '.ccard .ccard-wash', '.ccard.has-banner', '.cmark-img']) {
      const rule = ruleFor(selector)
      expect(rule?.body ?? '').not.toMatch(/\banimation\b|\btransition\b/)
    }
    // The card's existing hover `translateY` is the only motion here and is
    // unchanged — it is covered where it always was.
    expect(ruleFor('.ccard')?.body).toContain('transition: border-color var(--motion-fade), transform var(--motion-fade)')
  })

  it('lets a real logo show without the identity tint painted over it', () => {
    // `.cmark::after` is the `identityColor` film that gives derived initials
    // a background to read against. Over someone's actual mark it is a
    // coloured wash across their logo, so it is switched off — and the image
    // is `contain`, not `cover`, because a wordmark cropped through its own
    // letters is worse than a letterboxed one.
    //
    // The class is `has-image`, not the `has-logo` this stylesheet used
    // until T-260901-30: the company *detail* page's mark called the same
    // state `has-image` and additionally gave it a `--surface-2` ground, so
    // the same transparent PNG sat on a surface there and on the page itself
    // here. One class now, with the detail page's behaviour, in one file.
    expect(markRuleFor('.cmark.has-image::after')?.body).toContain('content: none')
    expect(markRuleFor('.cmark.has-image')?.body).toContain('background: var(--surface-2)')
    expect(markRuleFor('.cmark-img')?.body).toContain('object-fit: contain')
  })
})
