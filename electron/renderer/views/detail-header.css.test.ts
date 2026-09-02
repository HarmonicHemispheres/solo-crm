import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The detail header is declared once (T-260901-30).
 *
 * `.back`, `.dhero`, `.dbanner`, `.dhead`, `.dmeta` and `.cmark` were
 * declared identically in `CompanyDetail.css` and `PersonDetail.css`, each
 * file's header explaining that no shared home existed yet. T-260901-29 then
 * had to make the same change in both, in step, and the pair had already
 * begun to drift — the image rules landed in one copy only, which was
 * correct, but nothing in the files distinguished a deliberate addition from
 * a half-applied edit.
 *
 * A rendering test cannot see this: jsdom computes no layout and Vitest runs
 * with `css: false`, so a stylesheet is an empty module there
 * (`Companies.css.test.ts`'s header, and LESSONS.md line 1). Even in a real
 * browser two identical copies and one shared copy look the same — which is
 * the whole problem, and why the check is on the source.
 *
 * `npm run snap -- --routes company,person` at three widths produced
 * byte-identical PNGs across this extraction, which is the evidence the move
 * changed nothing; this is what keeps it moved.
 *
 * Same three carve-outs as `Companies.css.test.ts` — see its header.
 */

const VIEWS_DIR = import.meta.dirname

/**
 * The selectors that belong to the shared header and to nothing else.
 *
 * `.cmark` is deliberately not among them, though it started this: running
 * an earlier draft of this test found it declared in *four* view stylesheets
 * — `Companies.css`, `People.css` and `Today.css` as well as the two detail
 * ones — all unscoped, all identical bar a `.4px` against a `0.4px`. It is
 * not a detail-header rule at all; it is an app-wide one, and it moved to
 * `styles/identity-mark.css`, loaded once from `main.tsx`. `main.tsx` is
 * also where a test would have to look to prove it loads, which the
 * dedicated assertion below does.
 */
const SHARED_SELECTORS = ['.back', '.dhero', '.dbanner', '.dhead', '.dmeta']

/**
 * Every stylesheet under `views/`, comments stripped — LESSONS.md line 3.
 * Both view stylesheets now *mention* these selectors in prose, explaining
 * where they went, and a scan that reads the prose finds the duplication it
 * was written to say no longer exists.
 */
function stylesheets(): { name: string; css: string }[] {
  return readdirSync(VIEWS_DIR)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({
      name,
      css: readFileSync(join(VIEWS_DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    }))
}

/**
 * Whether `css` declares a rule *for* `selector` itself — the base rule, not
 * a modifier or descendant of it. `.cmark` counts; `.cmark.has-image`,
 * `.cmark-img` and `.cmark span` do not, and must not, because those are
 * exactly the company-only additions that are meant to stay where they are.
 */
function declaresBaseRule(css: string, selector: string): boolean {
  const escaped = selector.replace('.', '\\.')
  return new RegExp(`(^|,|\\})\\s*${escaped}\\s*(,|\\{)`, 'm').test(css)
}

describe('the detail-page header lives in one stylesheet', () => {
  it.each(SHARED_SELECTORS)('%s is declared in exactly one file, and it is detail-header.css', (selector) => {
    const owners = stylesheets()
      .filter(({ css }) => declaresBaseRule(css, selector))
      .map(({ name }) => name)

    expect(owners, `${selector} is declared in ${owners.join(' and ') || 'nothing'}`).toEqual(['detail-header.css'])
  })

  it('both detail views load it', () => {
    // Without this the test above passes for a view that simply lost its
    // header styling altogether.
    for (const view of ['CompanyDetail.tsx', 'PersonDetail.tsx']) {
      const source = readFileSync(join(VIEWS_DIR, view), 'utf8')
      expect(source, `${view} must import ./detail-header.css`).toContain("import './detail-header.css'")
    }
  })

  it('the company-only banner and action rules stayed with the company', () => {
    // The other half of the split: these are additions on top of the shared
    // rules, and moving them into the shared file would put a company's
    // banner on the person page's stylesheet for no reason. (The *mark*'s
    // image rules are not here — they are app-wide, see `.cmark` above.)
    const company = stylesheets().find((sheet) => sheet.name === 'CompanyDetail.css')!.css
    const shared = stylesheets().find((sheet) => sheet.name === 'detail-header.css')!.css

    for (const selector of ['.dbanner-img', '.dhead-actions']) {
      expect(company, `${selector} belongs to CompanyDetail.css`).toContain(selector)
      expect(shared, `${selector} does not belong in detail-header.css`).not.toContain(selector)
    }
  })
})

describe('the identity mark is declared once, globally', () => {
  const MARK_SELECTORS = ['.cmark', '.cmark span', '.cmark::after', '.cmark.has-image', '.cmark-img']

  it.each(MARK_SELECTORS)('%s is declared in no view stylesheet', (selector) => {
    // Every one of these was in `Companies.css`, `People.css`, `Today.css`,
    // `CompanyDetail.css` or `PersonDetail.css` — several of them in four at
    // once. They are in `styles/identity-mark.css` now. An unscoped class
    // copied per view is not encapsulation; it is one global rule written
    // five times with only the last one taking effect, which is the shape
    // T-260828-15 already found once ("three stylesheets fighting over one
    // unscoped selector").
    const owners = stylesheets()
      .filter(({ css }) => declaresBaseRule(css, selector))
      .map(({ name }) => name)

    expect(owners, `${selector} is back in ${owners.join(' and ')}`).toEqual([])
  })

  it('the shared stylesheet declares them, and the entry point loads it', () => {
    const shared = readFileSync(join(VIEWS_DIR, '..', 'styles', 'identity-mark.css'), 'utf8')
    for (const selector of MARK_SELECTORS) {
      expect(declaresBaseRule(shared.replace(/\/\*[\s\S]*?\*\//g, ''), selector), `${selector} missing`).toBe(true)
    }

    // A global stylesheet nothing imports is a stylesheet that does not
    // exist — the exact failure `main.tsx`'s own comment warns about for
    // tokens.css and base.css, which no jsdom test would catch either
    // (Vitest runs with `css: false`).
    const entry = readFileSync(join(VIEWS_DIR, '..', 'main.tsx'), 'utf8')
    expect(entry).toContain("import './styles/identity-mark.css'")
  })
})
