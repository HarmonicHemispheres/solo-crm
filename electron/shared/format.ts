import { centsSchema, dateOnlySchema, periodMonthSchema, timestampSchema } from './types'
import type { Cents, DateOnly, PeriodMonth, Timestamp } from './types'

/**
 * Parse and format helpers for the conventions in CONVENTIONS.md, shared by
 * main and renderer. Every Date-facing helper here reads and writes with the
 * UTC accessors (`getUTCFullYear`, `Date.UTC`, `toISOString`) and never the
 * local ones (`getFullYear`, `getDate`, the no-arg local constructor path).
 * Using the local accessors is what makes a date silently shift by a day
 * depending on the machine's timezone — a `dateOnlySchema` string parsed
 * with `new Date(value)` and re-read with `.getDate()` reproduces exactly
 * that bug on a UTC-negative-offset machine. Round-tripping a value through
 * these helpers must return the identical string with no such shift.
 *
 * No Node or DOM types: see the header comment in ./types.ts.
 */

// ---- Dates ------------------------------------------------------------

/** Parse a validated `YYYY-MM-DD` string into a UTC-midnight Date. */
export function parseDateOnly(value: string): Date {
  const validated = dateOnlySchema.parse(value)
  const [year, month, day] = validated.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Format a Date as the `YYYY-MM-DD` CONVENTIONS.md requires, reading UTC
 * fields so the caller's local timezone can never shift the calendar day.
 */
export function formatDateOnly(date: Date): DateOnly {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return dateOnlySchema.parse(`${year}-${month}-${day}`)
}

// ---- Timestamps ---------------------------------------------------------

/** Parse a validated ISO-8601 UTC timestamp string into a Date. */
export function parseTimestamp(value: string): Date {
  return new Date(timestampSchema.parse(value))
}

/**
 * Format a Date as the millisecond-precision ISO-8601 UTC string
 * CONVENTIONS.md requires — `Date#toISOString()`'s own format. A non-finite
 * Date fails loudly here because `toISOString()` itself throws a RangeError
 * before zod is reached; the schema guards the string shape on the way out.
 */
export function formatTimestamp(date: Date): Timestamp {
  return timestampSchema.parse(date.toISOString())
}

/** The current instant, already in the wire format. */
export function nowTimestamp(): Timestamp {
  return formatTimestamp(new Date())
}

// ---- period_month -------------------------------------------------------

/** The first day of the month containing `date`, as a `period_month` value. */
export function startOfMonth(date: Date): PeriodMonth {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return periodMonthSchema.parse(`${year}-${month}-01`)
}

/**
 * The `period_month` of the operator's **local** calendar day at `date` —
 * the one deliberate local read in this module, and the answer to "what is
 * this month?" everywhere revenue is recognised (the generator's rolling
 * horizon, the summary's "this month" and its chart divider). The UTC rule
 * above exists to stop a *stored* date shifting between machines; this is
 * a different question, the same one `seed/index.ts`'s `localDateOnly` and
 * the renderer's `localToday` answer locally for the same reason: at 17:00
 * on the 30th in California, UTC is already the 1st, and a Revenue page
 * that rolled over to next month before dinner would be wrong on the wall
 * clock the operator invoices by (LESSONS.md 12).
 */
export function localPeriodMonth(date: Date): PeriodMonth {
  return periodMonthSchema.parse(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`)
}

/** The `period_month` a `YYYY-MM-DD` date falls in — `2026-09-17` -> `2026-09-01`. */
export function periodMonthOf(value: string): PeriodMonth {
  const validated = dateOnlySchema.parse(value)
  return periodMonthSchema.parse(`${validated.slice(0, 7)}-01`)
}

/**
 * `period_month` arithmetic on the string itself, never through a `Date` —
 * a Date would need a timezone to say which month it is in, and a month
 * has none. `addMonths('2026-11-01', 3)` is `2027-02-01`; negative `count`
 * walks backwards. This is what the revenue generator (T-260902-03) walks
 * a term with and what the chart labels its axis from, so both agree on
 * what "the next month" is.
 */
export function addMonths(period: string, count: number): PeriodMonth {
  const validated = periodMonthSchema.parse(period)
  const [year, month] = validated.split('-').map(Number)
  // Zero-based total months, so the division below floors cleanly for
  // negative results too (`Math.floor(-1 / 12)` is -1, which is right).
  const total = year * 12 + (month - 1) + count
  const outYear = Math.floor(total / 12)
  const outMonth = total - outYear * 12 + 1
  return periodMonthSchema.parse(`${outYear}-${String(outMonth).padStart(2, '0')}-01`)
}

/** Whole months from `from` to `to`, as a signed count — `0` for the same month, `1` for the next. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = periodMonthSchema.parse(from).split('-').map(Number)
  const [toYear, toMonth] = periodMonthSchema.parse(to).split('-').map(Number)
  return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

/** Every month from `from` to `to`, both inclusive; empty when `to` is before `from`. The generator walks a term with this and the chart lays out its window with it, so both sides of IPC agree on what a twelve-month span holds. */
export function eachMonth(from: string, to: string): PeriodMonth[] {
  const months: PeriodMonth[] = []
  for (let i = 0; i <= monthsBetween(from, to); i += 1) months.push(addMonths(from, i))
  return months
}

// ---- Money --------------------------------------------------------------
//
// No currency symbol and no locale formatting below — both are P2-01's job
// (§6.11 identity settings), out of this task's scope. These convert
// between integer cents and a plain decimal string only.

/** Integer cents to a plain decimal string, e.g. `1999` -> `"19.99"`. */
export function centsToDecimalString(cents: number): string {
  const validated: Cents = centsSchema.parse(cents)
  const negative = validated < 0
  const absolute = Math.abs(validated)
  const wholePart = Math.floor(absolute / 100)
  const centsPart = String(absolute % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${wholePart}.${centsPart}`
}

/**
 * A decimal string, e.g. `"19.99"` or `"-4.5"`, to integer cents. Throws if
 * the string is not a plain decimal amount with at most two decimal places
 * — a third decimal digit is more precision than a cent can hold, not
 * something to silently round.
 */
export function decimalStringToCents(value: string): Cents {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) {
    throw new Error(`"${value}" is not a decimal amount with at most two decimal places`)
  }
  const [, sign, whole, fraction = ''] = match
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return centsSchema.parse(sign === '-' ? -cents : cents)
}
