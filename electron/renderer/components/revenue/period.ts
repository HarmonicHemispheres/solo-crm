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
 * A mode names the size of the window, and the window is exactly that size —
 * Monthly is a month, Annual is a year. It did not always read that way:
 * Monthly used to mean "one bar per month across a whole calendar year" and
 * Annual "one bar per year across five", so picking Annual in 2026 landed the
 * operator on `2022 – 2026` and picking Monthly never showed a single month's
 * money at all. Both were deliberate — a steppable window wants an obvious
 * name — but the names on the control are `Monthly` and `Annual`, and a
 * control that reads as a granularity has to select the period it names.
 *
 * - **Monthly** — one month. The totals are that month's, and ‹ › step a
 *   month at a time.
 * - **Annual** — one calendar year, drawn as its twelve months (`bucket` is
 *   `month`, not `year`). ‹ › step a year at a time. This is the window the
 *   revenue surfaces open on, so the default landing view is unchanged.
 * - **Custom** — any two months, including a multi-year span: five years is
 *   still reachable, it is just no longer what "Annual" means.
 *
 * `bucket` is carried on the period and sent with the request rather than
 * applied to the response, because folding months into a coarser period is an
 * attribution and so belongs in main (ADR-003). No mode asks for `year`
 * bucketing today; the channel still supports it.
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

/** Just `month` — the window a "Monthly" control ought to select. */
export function monthlyPeriod(month: PeriodMonth): Period {
  return { mode: 'monthly', from: month, to: month, bucket: 'month' }
}

/** The calendar year `month` falls in, drawn as its twelve months. */
export function annualPeriod(month: PeriodMonth): Period {
  const year = yearOf(month)
  return { mode: 'annual', from: january(year), to: december(year), bucket: 'month' }
}

/** Two months, in whichever order they arrive — a range typed backwards is read as the range, not as nothing. */
export function customPeriod(from: PeriodMonth, to: PeriodMonth): Period {
  return from <= to ? { mode: 'custom', from, to, bucket: 'month' } : { mode: 'custom', from: to, to: from, bucket: 'month' }
}

/**
 * The period a surface opens on: this calendar year, one bar per month —
 * which is `annual` now that a mode selects the window it names. Deliberately
 * still the year and not the month: landing on a single month would put one
 * bar on the chart and read as an empty report in a quiet month, and the
 * default view of Revenue and Today is not what the operator asked to change.
 */
export function defaultPeriod(now: Date): Period {
  return annualPeriod(localPeriodMonth(now))
}

/**
 * The same shape of window, `direction` places along. Monthly steps a year,
 * annual steps its whole span, custom steps its own length — so pressing ‹
 * twice never lands inside the window it started in, whatever the mode.
 */
export function stepPeriod(period: Period, direction: 1 | -1): Period {
  switch (period.mode) {
    case 'monthly':
      return monthlyPeriod(addMonths(period.from, direction))
    case 'annual':
      return annualPeriod(january(yearOf(period.to) + direction))
    case 'custom': {
      const span = monthsBetween(period.from, period.to) + 1
      return customPeriod(addMonths(period.from, span * direction), addMonths(period.to, span * direction))
    }
  }
}

/**
 * Switching mode keeps where you are, not where you started: the new window
 * is built around the current one's end.
 *
 * `anchor` — the month the operator is actually living in — is the one
 * refinement. Narrowing a window to a single month picks the anchor when the
 * window contains it, so switching to Monthly during 2026 lands on this month
 * rather than on December, which is where "the current one's end" alone would
 * put it. Narrowing a window that does not contain the anchor still lands on
 * its end: leaving 2019, Monthly means December 2019, not a jump back to now.
 * Omitted, the rule is exactly "the current one's end" as before.
 */
export function withMode(period: Period, mode: PeriodMode, anchor?: PeriodMonth): Period {
  const within = anchor !== undefined && anchor >= period.from && anchor <= period.to
  switch (mode) {
    case 'monthly':
      return monthlyPeriod(within ? anchor : period.to)
    case 'annual':
      return annualPeriod(within ? anchor : period.to)
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
      return formatPeriodMonth(period.from)
    case 'annual':
      return String(yearOf(period.from))
    case 'custom':
      return period.from === period.to ? formatPeriodMonth(period.from) : `${formatPeriodMonth(period.from)} – ${formatPeriodMonth(period.to)}`
  }
}

/** The scope a period contributes to a query key — the three fields that change the answer. */
export function periodScope(period: Period): { from: string; to: string; bucket: string } {
  return { from: period.from, to: period.to, bucket: period.bucket }
}
