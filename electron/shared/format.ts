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
 * CONVENTIONS.md requires — `Date#toISOString()`'s own format, validated
 * back through `timestampSchema` so a non-finite Date fails loudly here
 * rather than silently producing `"Invalid Date"`.
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
