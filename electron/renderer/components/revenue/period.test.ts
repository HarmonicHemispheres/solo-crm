import { describe, expect, it } from 'vitest'
import { periodMonthSchema } from '../../../shared/types'
import {
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
  it('makes Monthly the one month it is anchored on', () => {
    // The operator's report: "monthly doesn't seem to show revenue for a
    // single month". A control labelled Monthly selects a month.
    expect(monthlyPeriod(MARCH)).toEqual({ mode: 'monthly', from: '2026-03-01', to: '2026-03-01', bucket: 'month' })
  })

  it('makes Annual the one calendar year the anchor falls in, drawn as its twelve months', () => {
    // The operator's other report: picking Annual in 2026 used to land on
    // 2022 – 2026. One year, and the bucket stays `month` so the year is
    // still read as twelve bars rather than one.
    expect(annualPeriod(MARCH)).toEqual({ mode: 'annual', from: '2026-01-01', to: '2026-12-01', bucket: 'month' })
    expect(annualPeriod(periodMonthSchema.parse('2026-12-01')).from).toBe('2026-01-01')
  })

  it('reads a Custom range typed backwards as the range, not as nothing', () => {
    const forwards = customPeriod(periodMonthSchema.parse('2026-03-01'), periodMonthSchema.parse('2026-08-01'))
    const backwards = customPeriod(periodMonthSchema.parse('2026-08-01'), periodMonthSchema.parse('2026-03-01'))
    expect(backwards).toEqual(forwards)
  })

  it('draws months in every mode — no mode quietly asks for year buckets', () => {
    // The bucket is sent to main, where the folding happens (ADR-003). A
    // mode that asked for year buckets would show one bar where the operator
    // asked for twelve. The channel still supports `year`; nothing picks it.
    for (const period of [monthlyPeriod(MARCH), annualPeriod(MARCH), customPeriod(MARCH, MARCH)]) {
      expect(period.bucket, `${period.mode} does not draw months`).toBe('month')
    }
  })

  it('still reaches a five-year span, through Custom', () => {
    // What Annual used to be is not gone, it is just no longer what Annual
    // means.
    const fiveYears = customPeriod(periodMonthSchema.parse('2022-01-01'), periodMonthSchema.parse('2026-12-01'))
    expect(periodLabel(fiveYears)).toBe('Jan 2022 – Dec 2026')
  })
})

describe('stepping', () => {
  it('moves Monthly one month at a time', () => {
    const back = stepPeriod(monthlyPeriod(MARCH), -1)
    expect(back).toEqual({ mode: 'monthly', from: '2026-02-01', to: '2026-02-01', bucket: 'month' })
    expect(stepPeriod(back, 1)).toEqual(monthlyPeriod(MARCH))
  })

  it('steps Monthly across a year boundary', () => {
    // January back one is December of the year before, not month zero.
    const january = monthlyPeriod(periodMonthSchema.parse('2026-01-01'))
    expect(stepPeriod(january, -1).from).toBe('2025-12-01')
  })

  it('moves Annual one year at a time', () => {
    const back = stepPeriod(annualPeriod(MARCH), -1)
    expect(back.from).toBe('2025-01-01')
    expect(back.to).toBe('2025-12-01')
    expect(stepPeriod(back, 1)).toEqual(annualPeriod(MARCH))
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
    // Stepping back to 2023 and then choosing Monthly must stay in 2023 —
    // landing on today's month would silently undo three presses.
    const twentyThree = stepPeriod(stepPeriod(stepPeriod(annualPeriod(MARCH), -1), -1), -1)
    expect(twentyThree.from).toBe('2023-01-01')
    expect(withMode(twentyThree, 'monthly')).toEqual(monthlyPeriod(periodMonthSchema.parse('2023-12-01')))
  })

  it('narrows to the month the operator is living in, when the window holds it', () => {
    // Opening on 2026 in March and pressing Monthly means March, not
    // December — "the window's end" alone would give the wrong month for
    // eleven months of the year.
    expect(withMode(annualPeriod(MARCH), 'monthly', MARCH)).toEqual(monthlyPeriod(MARCH))
  })

  it('ignores an anchor outside the window, so leaving 2019 does not jump back to now', () => {
    const nineteen = annualPeriod(periodMonthSchema.parse('2019-06-01'))
    expect(withMode(nineteen, 'monthly', MARCH)).toEqual(monthlyPeriod(periodMonthSchema.parse('2019-12-01')))
  })

  it('widens a month back to its own year', () => {
    expect(withMode(monthlyPeriod(MARCH), 'annual', MARCH)).toEqual(annualPeriod(MARCH))
  })

  it('is defined for every declared mode', () => {
    for (const mode of PERIOD_MODES) {
      expect(withMode(monthlyPeriod(MARCH), mode).mode, `${mode} is not handled`).toBe(mode)
    }
  })
})

describe('labels', () => {
  it('names each window in the vocabulary of the mode that made it', () => {
    expect(periodLabel(monthlyPeriod(MARCH))).toBe('Mar 2026')
    expect(periodLabel(annualPeriod(MARCH))).toBe('2026')
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
    expect(periodScope(annualPeriod(MARCH))).toEqual({ from: '2026-01-01', to: '2026-12-01', bucket: 'month' })
  })

  it('separates two windows that differ only in bucket', () => {
    // Jan–Dec by month and Jan–Dec by year are the same months and two
    // different charts; sharing a cache entry would hand one the other's data.
    const byMonth = periodScope({ mode: 'custom', from: '2026-01-01', to: '2026-12-01', bucket: 'month' })
    const byYear = periodScope({ mode: 'annual', from: '2026-01-01', to: '2026-12-01', bucket: 'year' })
    expect(byMonth).not.toEqual(byYear)
  })

  it('separates one month from the year around it', () => {
    // The bug this replaces: Monthly and Annual anchored on the same instant
    // used to differ, and a Monthly window that spanned the whole year meant
    // the single-month question could not be asked at all.
    expect(periodScope(monthlyPeriod(MARCH))).not.toEqual(periodScope(annualPeriod(MARCH)))
  })
})

describe('the default', () => {
  it('opens on the calendar year the given instant falls in, one bar per month', () => {
    // Deliberately the year and not the month: the landing view of Revenue
    // and Today is unchanged by the mode rework.
    const now = new Date('2026-09-03T12:00:00.000Z')
    expect(defaultPeriod(now)).toMatchObject({ mode: 'annual', bucket: 'month' })
    expect(defaultPeriod(now).from.slice(0, 4)).toBe(String(now.getFullYear()))
    expect(defaultPeriod(now).to.slice(0, 4)).toBe(String(now.getFullYear()))
  })
})
