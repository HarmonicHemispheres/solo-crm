import { describe, expect, it } from 'vitest'
import { periodMonthSchema } from '../../../shared/types'
import {
  ANNUAL_YEARS,
  PERIOD_MODES,
  annualPeriod,
  customPeriod,
  defaultPeriod,
  formatPeriodMonth,
  monthlyPeriod,
  periodLabel,
  periodScope,
  stepPeriod,
  withMode,
  type Period
} from './period'

/**
 * The reporting period's arithmetic, pinned to a fixed anchor. Nothing here
 * reads the wall clock — `period.ts` takes its anchor as a parameter for
 * exactly that reason — so these say the same thing in June as in December.
 */
const MARCH = periodMonthSchema.parse('2026-03-01')

describe('the three modes', () => {
  it('makes Monthly a whole calendar year, whatever month it is anchored on', () => {
    // Not a rolling twelve: a steppable window has to have a name, and
    // "2026" is one where "Apr 2025 – Mar 2026" is not.
    expect(monthlyPeriod(MARCH)).toEqual({ mode: 'monthly', from: '2026-01-01', to: '2026-12-01', bucket: 'month' })
    expect(monthlyPeriod(periodMonthSchema.parse('2026-12-01')).from).toBe('2026-01-01')
  })

  it('makes Annual five whole years ending with the anchor’s, bucketed by year', () => {
    const period = annualPeriod(MARCH)
    expect(period).toEqual({ mode: 'annual', from: '2022-01-01', to: '2026-12-01', bucket: 'year' })
    expect(Number(period.to.slice(0, 4)) - Number(period.from.slice(0, 4)) + 1).toBe(ANNUAL_YEARS)
  })

  it('reads a Custom range typed backwards as the range, not as nothing', () => {
    const forwards = customPeriod(periodMonthSchema.parse('2026-03-01'), periodMonthSchema.parse('2026-08-01'))
    const backwards = customPeriod(periodMonthSchema.parse('2026-08-01'), periodMonthSchema.parse('2026-03-01'))
    expect(backwards).toEqual(forwards)
  })

  it('only ever buckets by year in Annual — every other mode draws months', () => {
    // The bucket is sent to main, where the folding happens (ADR-003). A
    // mode that quietly asked for year buckets would show one bar where the
    // operator asked for twelve.
    expect(monthlyPeriod(MARCH).bucket).toBe('month')
    expect(customPeriod(MARCH, MARCH).bucket).toBe('month')
    expect(annualPeriod(MARCH).bucket).toBe('year')
  })
})

describe('stepping', () => {
  it('moves Monthly one year at a time', () => {
    const back = stepPeriod(monthlyPeriod(MARCH), -1)
    expect(back.from).toBe('2025-01-01')
    expect(back.to).toBe('2025-12-01')
    expect(stepPeriod(back, 1)).toEqual(monthlyPeriod(MARCH))
  })

  it('moves Annual by its whole span, so two presses never overlap one window', () => {
    const back = stepPeriod(annualPeriod(MARCH), -1)
    expect(back.to).toBe('2021-12-01')
    expect(back.from).toBe('2017-01-01')
  })

  it('moves Custom by its own length, inclusive of both ends', () => {
    // Six months: Mar–Aug. One step back must be Sep–Feb, not Feb–Jul —
    // an off-by-one here shows the last month of the window again.
    const period = customPeriod(periodMonthSchema.parse('2026-03-01'), periodMonthSchema.parse('2026-08-01'))
    const back = stepPeriod(period, -1)
    expect(back).toEqual({ mode: 'custom', from: '2025-09-01', to: '2026-02-01', bucket: 'month' })
    expect(stepPeriod(back, 1)).toEqual(period)
  })

  it('never lands inside the window it stepped out of, in any mode', () => {
    const periods: Period[] = [monthlyPeriod(MARCH), annualPeriod(MARCH), customPeriod(MARCH, periodMonthSchema.parse('2026-05-01'))]
    for (const period of periods) {
      expect(stepPeriod(period, -1).to < period.from, `${period.mode} overlaps going back`).toBe(true)
      expect(stepPeriod(period, 1).from > period.to, `${period.mode} overlaps going forward`).toBe(true)
    }
  })
})

describe('switching mode', () => {
  it('keeps where you are, not where you started', () => {
    // Stepping back to 2023 and then choosing Annual must show the five
    // years ending 2023 — not the five ending now, which would silently
    // undo four presses.
    const twentyThree = stepPeriod(stepPeriod(stepPeriod(monthlyPeriod(MARCH), -1), -1), -1)
    expect(twentyThree.from).toBe('2023-01-01')
    expect(withMode(twentyThree, 'annual').to).toBe('2023-12-01')
  })

  it('is defined for every declared mode', () => {
    for (const mode of PERIOD_MODES) {
      expect(withMode(monthlyPeriod(MARCH), mode).mode, `${mode} is not handled`).toBe(mode)
    }
  })
})

describe('labels', () => {
  it('names each window in the vocabulary of the mode that made it', () => {
    expect(periodLabel(monthlyPeriod(MARCH))).toBe('2026')
    expect(periodLabel(annualPeriod(MARCH))).toBe('2022 – 2026')
    expect(periodLabel(customPeriod(MARCH, periodMonthSchema.parse('2026-08-01')))).toBe('Mar 2026 – Aug 2026')
  })

  it('says a one-month custom window once, not twice', () => {
    expect(periodLabel(customPeriod(MARCH, MARCH))).toBe('Mar 2026')
  })

  it('formats a period month in UTC — it is a calendar label, not an instant', () => {
    // Read locally, `2026-03-01T00:00` west of UTC is February. A
    // `PeriodMonth` names a month (CONVENTIONS.md), so the formatter is
    // pinned to UTC and this holds in every timezone the app runs in.
    expect(formatPeriodMonth(periodMonthSchema.parse('2026-01-01'))).toBe('Jan 2026')
  })
})

describe('the query scope', () => {
  it('carries exactly the three fields that change the answer', () => {
    expect(periodScope(annualPeriod(MARCH))).toEqual({ from: '2022-01-01', to: '2026-12-01', bucket: 'year' })
  })

  it('separates two windows that differ only in bucket', () => {
    // Jan–Dec by month and Jan–Dec by year are the same months and two
    // different charts; sharing a cache entry would hand one the other's data.
    const byMonth = periodScope({ mode: 'custom', from: '2026-01-01', to: '2026-12-01', bucket: 'month' })
    const byYear = periodScope({ mode: 'annual', from: '2026-01-01', to: '2026-12-01', bucket: 'year' })
    expect(byMonth).not.toEqual(byYear)
  })
})

describe('the default', () => {
  it('opens on the calendar year the given instant falls in', () => {
    expect(defaultPeriod(new Date('2026-09-03T12:00:00.000Z'))).toMatchObject({ mode: 'monthly', bucket: 'month' })
    expect(defaultPeriod(new Date('2026-09-03T12:00:00.000Z')).from.slice(0, 4)).toBe(String(new Date('2026-09-03T12:00:00.000Z').getFullYear()))
  })
})
