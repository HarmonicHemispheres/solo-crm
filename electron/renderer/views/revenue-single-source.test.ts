import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every revenue figure comes from `revenue:summary`, enforced (T-260902-05,
 * -06; ADR-003).
 *
 * The rendering tests prove the Revenue view and Today draw the payload
 * they are given. This proves the other half structurally: that neither
 * page, nor the chart they share, names an engagement's price column at
 * all — so there is no `mrr()`-shaped fold over `engagements` to drift
 * into, however the fixtures happen to be shaped. The mockup's `revMonths`
 * array, the hardcoded chart series, must appear nowhere.
 *
 * Reading source off disk from a renderer-adjacent test is this project's
 * established shape — `cadence-single-source.test.ts`'s header names the
 * three carve-outs it needs, which this file joins.
 */

const VIEWS_DIR = import.meta.dirname
const CHART_DIR = join(VIEWS_DIR, '..', 'components', 'revenue')

/** Comments stripped before matching (LESSONS.md line 3) — these files talk about the columns they must not read. */
function stripped(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The engagement columns a revenue figure could be computed from. `hoursIncluded` too: hours x rate is the retainer price. */
const PRICE_COLUMNS = ['billingModel', 'agreedRateCents', 'contractValueCents', 'hourlyRateCents', 'monthlyAmountCents', 'hoursIncluded', 'estimatedHours', 'notToExceedCents']

describe('revenue figures are read from revenue:summary and computed nowhere in the renderer', () => {
  it('Revenue.tsx names no engagement price column', () => {
    const source = stripped(join(VIEWS_DIR, 'Revenue.tsx'))
    for (const column of PRICE_COLUMNS) expect(source, column).not.toContain(column)
  })

  it('Today.tsx names no engagement price column', () => {
    const source = stripped(join(VIEWS_DIR, 'Today.tsx'))
    for (const column of PRICE_COLUMNS) expect(source, column).not.toContain(column)
  })

  it('the chart names no engagement column and reads only the series it is handed', () => {
    for (const name of readdirSync(CHART_DIR).filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))) {
      const source = stripped(join(CHART_DIR, name))
      for (const column of PRICE_COLUMNS) expect(source, `${name}: ${column}`).not.toContain(column)
      expect(source, name).not.toContain('engagements:')
      expect(source, name).not.toContain('window.crm')
    }
  })

  it('the mockup’s hardcoded revMonths series appears nowhere under electron/', () => {
    const root = join(VIEWS_DIR, '..', '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx|css)$/.test(entry.name) && !entry.name.includes('.test.') && stripped(path).includes('revMonths')) offenders.push(path)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
