import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { RevenueChart } from './RevenueChart'
import type { RevenueSeriesPoint } from '../../../shared/revenue'
import type { PeriodMonth } from '../../../shared/types'

/**
 * The chart's own arithmetic is one thing — cents to bar heights — and
 * `scale.test.ts` covers the scale. What is worth pinning here is the axis
 * the bucket introduced: a year bucket arrives keyed by that year's January
 * (main groups it; ADR-003 keeps the fold out of the renderer), and this
 * component has to lay it out as one column per year rather than one per
 * month, or a five-year window would draw sixty empty columns and put every
 * bar in the first of them.
 *
 * jsdom computes no layout, so nothing here measures a width. These assert
 * the columns the component decided on — how many, keyed by what, labelled
 * what — which is exactly what it decides and the stylesheet does not.
 */

function month(value: string): PeriodMonth {
  return value as PeriodMonth
}

const YEARLY: readonly RevenueSeriesPoint[] = [
  { periodMonth: month('2024-01-01'), kind: 'retainer', status: 'actual', cents: 100_000 },
  { periodMonth: month('2025-01-01'), kind: 'retainer', status: 'actual', cents: 200_000 },
  { periodMonth: month('2026-01-01'), kind: 'retainer', status: 'projected', cents: 300_000 }
]

const YEARLY_TOTALS = [
  { periodMonth: month('2024-01-01'), cents: 100_000 },
  { periodMonth: month('2025-01-01'), cents: 200_000 },
  { periodMonth: month('2026-01-01'), cents: 300_000 }
]

describe('RevenueChart — the month bucket', () => {
  it('draws one column per month of the window, whether or not the series has a point for it', () => {
    // A month with no lines is an empty column, not a missing one: the
    // window says how many months there are.
    const { container } = render(
      <RevenueChart
        window={{ from: month('2026-01-01'), to: month('2026-06-01') }}
        series={[{ periodMonth: month('2026-03-01'), kind: 'retainer', status: 'projected', cents: 500_000 }]}
        months={[{ periodMonth: month('2026-03-01'), cents: 500_000 }]}
        currentMonth={month('2026-03-01')}
      />
    )
    expect(container.querySelectorAll('svg > g')).toHaveLength(6)
    expect(container.querySelector('g[data-month="2026-01-01"] rect')).toBeNull()
    expect(container.querySelector('g[data-month="2026-03-01"] rect')).not.toBeNull()
  })
})

describe('RevenueChart — the year bucket', () => {
  function renderYears() {
    return render(
      <RevenueChart
        window={{ from: month('2024-01-01'), to: month('2026-12-01') }}
        series={YEARLY}
        months={YEARLY_TOTALS}
        currentMonth={month('2026-09-01')}
        bucket="year"
      />
    )
  }

  it('draws one column per year, keyed by that year’s January — not one per month', () => {
    // The failure this exists to catch: laying a three-year window out by
    // month gives 36 columns and every bar in the first of each year.
    const { container } = renderYears()
    const groups = [...container.querySelectorAll('svg > g')].map((group) => group.getAttribute('data-month'))
    expect(groups).toEqual(['2024-01-01', '2025-01-01', '2026-01-01'])
  })

  it('labels a year column with the year, not with January', () => {
    const { container } = renderYears()
    expect([...container.querySelectorAll('.revchart-axis span')].map((span) => span.textContent)).toEqual(['2024', '2025', '2026'])
    expect(container.querySelector('g[data-month="2025-01-01"] title')?.textContent).toBe('2025: $2,000')
  })

  it('marks the year holding today, not the month — the divider has to speak the column’s language', () => {
    // `currentMonth` is 2026-09; in a year-bucketed chart the column it
    // falls in is 2026. Comparing the raw month against a January key would
    // mark nothing and draw the past/future divider in the wrong place.
    const { container } = renderYears()
    const marked = [...container.querySelectorAll('.revchart-axis span')].filter((span) => span.className.includes('now'))
    expect(marked.map((span) => span.textContent)).toEqual(['2026'])
    expect([...container.querySelectorAll('.revchart-axis span.ahead')]).toHaveLength(0)
  })

  it('still distinguishes projected from actual, so folding the period axis folds only that one', () => {
    const { container } = renderYears()
    expect(container.querySelector('g[data-month="2025-01-01"] rect')?.getAttribute('data-status')).toBe('actual')
    expect(container.querySelector('g[data-month="2026-01-01"] rect')?.getAttribute('data-status')).toBe('projected')
  })

  it('names the bucket in its accessible label, so the chart says what a bar is', () => {
    const { container } = renderYears()
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toContain('Revenue by year')
  })
})
