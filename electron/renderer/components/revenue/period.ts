import { addMonths, localPeriodMonth, monthsBetween } from '../../../shared/format'
import { periodMonthSchema, type PeriodMonth } from '../../../shared/types'
import type { RevenueBucket } from '../../../shared/revenue'

/**
 * The reporting period every revenue surface is read through — the window
 * `revenue:summary` is asked for, and the label the picker prints.
 *
 * A pure module: no IPC, no React, no `Date.now()` inside. Every entry point
 * takes the anchor instant as a parameter, so a test states a fixed clock
 * instead of building fixtures relative to whenever it runs — the same
 * discipline `lib/decay.ts` follows, and for the same reason.
 *
 * **Three modes, and what each one actually is.**
 *
 * - **Monthly** — one bar per month across a calendar year. The window is a
 *   whole year, not a rolling twelve, because a steppable window has to have
 *   an obvious name: "2026" is one, "Oct 2025 – Sep 2026" is not, and an
 *   operator pressing ‹ needs to know where they have arrived.
 * - **Annual** — one bar per year, five years ending at the anchor's. The
 *   bucketing happens in main (ADR-003: folding months into a year is an
 *   attribution to a period), which is why `bucket` is carried on the period
 *   and sent with the request rather than applied to the response here.
 * - **Custom** — any two months. Stepping moves by the window's own length,
 *   so ‹ on a six-month window shows the six months before it.
 *
 * The step is always "the same shape of window, adjacent to this one",
 * which is what makes ‹ and › mean one thing across all three.
 */

export const PERIOD_MODES = ['monthly', 'annual', 'custom'] as const
export type PeriodMode = (typeof PERIOD_MODES)[number]

export const PERIOD_MODE_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'custom', label: 'Custom' }
] as const satisfies ReadonlyArray<{ value: PeriodMode; label: string }>

/** How many years an `annual` window spans. Five is enough to see a trend and few enough to read a label. */
export const ANNUAL_YEARS = 5

export interface Period {
  readonly mode: PeriodMode
  /** Inclusive, as every month range in this codebase is. */
  readonly from: PeriodMonth
  readonly to: PeriodMonth
  readonly bucket: RevenueBucket
}

function january(year: number): PeriodMonth {
  return periodMonthSchema.parse(`${year}-01-01`)
}

function december(year: number): PeriodMonth {
  return periodMonthSchema.parse(`${year}-12-01`)
}

function yearOf(month: PeriodMonth): number {
  return Number(month.slice(0, 4))
}

/** The calendar year `month` falls in, one bar per month. */
export function monthlyPeriod(month: PeriodMonth): Period {
  const year = yearOf(month)
  return { mode: 'monthly', from: january(year), to: december(year), bucket: 'month' }
}

/** The five calendar years ending with `month`'s, one bar per year. */
export function annualPeriod(month: PeriodMonth): Period {
  const year = yearOf(month)
  return { mode: 'annual', from: january(year - (ANNUAL_YEARS - 1)), to: december(year), bucket: 'year' }
}

/** Two months, in whichever order they arrive — a range typed backwards is read as the range, not as nothing. */
export function customPeriod(from: PeriodMonth, to: PeriodMonth): Period {
  return from <= to ? { mode: 'custom', from, to, bucket: 'month' } : { mode: 'custom', from: to, to: from, bucket: 'month' }
}

/** The period a surface opens on: this calendar year, one bar per month. */
export function defaultPeriod(now: Date): Period {
  return monthlyPeriod(localPeriodMonth(now))
}

/**
 * The same shape of window, `direction` places along. Monthly steps a year,
 * annual steps its whole span, custom steps its own length — so pressing ‹
 * twice never lands inside the window it started in, whatever the mode.
 */
export function stepPeriod(period: Period, direction: 1 | -1): Period {
  switch (period.mode) {
    case 'monthly':
      return monthlyPeriod(january(yearOf(period.from) + direction))
    case 'annual':
      return annualPeriod(december(yearOf(period.to) + ANNUAL_YEARS * direction))
    case 'custom': {
      const span = monthsBetween(period.from, period.to) + 1
      return customPeriod(addMonths(period.from, span * direction), addMonths(period.to, span * direction))
    }
  }
}

/** Switching mode keeps where you are, not where you started: the new window is built around the current one's end. */
export function withMode(period: Period, mode: PeriodMode): Period {
  switch (mode) {
    case 'monthly':
      return monthlyPeriod(period.to)
    case 'annual':
      return annualPeriod(period.to)
    case 'custom':
      return customPeriod(period.from, period.to)
  }
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** `2026-03-01` as "Mar 2026". UTC, because a `PeriodMonth` is a calendar label and not an instant (CONVENTIONS.md). */
export function formatPeriodMonth(month: PeriodMonth): string {
  return MONTH_YEAR.format(new Date(`${month}T00:00:00.000Z`))
}

/** What the picker prints between its arrows — a name for the window, in the vocabulary of the mode that made it. */
export function periodLabel(period: Period): string {
  switch (period.mode) {
    case 'monthly':
      return String(yearOf(period.from))
    case 'annual':
      return `${yearOf(period.from)} – ${yearOf(period.to)}`
    case 'custom':
      return period.from === period.to ? formatPeriodMonth(period.from) : `${formatPeriodMonth(period.from)} – ${formatPeriodMonth(period.to)}`
  }
}

/** The scope a period contributes to a query key — the three fields that change the answer. */
export function periodScope(period: Period): { from: string; to: string; bucket: string } {
  return { from: period.from, to: period.to, bucket: period.bucket }
}
