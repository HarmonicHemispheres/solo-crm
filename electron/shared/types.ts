import { z } from 'zod'

/**
 * Zod primitives enforcing the date, timestamp, money and duration
 * conventions in CONVENTIONS.md (repo root). This file is the enforcement;
 * the document is the explanation — compose these schemas rather than
 * redefining a date, timestamp or cents check elsewhere. T-260828-09's
 * channel registry imports from here for its IPC validation.
 *
 * No Node or DOM types: this module is imported by both the main and
 * renderer processes (see the `electron/shared/**\/*` entry in both
 * tsconfig.node.json and tsconfig.web.json), so it may only use the
 * ES2022 lib both tsconfigs share.
 */

const dateInstanceMessage =
  'A Date object may not cross this boundary — serialise it first with ' +
  'formatDateOnly()/formatTimestamp() (see CONVENTIONS.md and electron/shared/format.ts)'

/**
 * A calendar date with no time or timezone component: `YYYY-MM-DD`.
 * Rejects an invalid calendar date (e.g. `2026-02-30`) as well as the wrong
 * shape.
 */
export const dateOnlySchema = z.iso.date({
  error: (issue) => (issue.input instanceof Date ? dateInstanceMessage : 'Expected a YYYY-MM-DD date string')
})
export type DateOnly = z.infer<typeof dateOnlySchema>

/**
 * An instant in time: ISO-8601, always UTC, millisecond precision — the
 * exact format `Date#toISOString()` produces (`2026-08-28T10:15:00.000Z`).
 * An offset other than `Z` (e.g. `+02:00`) is rejected; convert to UTC
 * before formatting.
 */
export const timestampSchema = z.iso.datetime({
  precision: 3,
  error: (issue) => (issue.input instanceof Date ? dateInstanceMessage : 'Expected an ISO-8601 UTC timestamp string')
})
export type Timestamp = z.infer<typeof timestampSchema>

/**
 * `period_month`: the first day of the month, as a date. Any valid date that
 * is not itself the first of its month fails — `2026-08-15` is rejected even
 * though it is a valid `dateOnlySchema` value.
 */
export const periodMonthSchema = dateOnlySchema.refine((value) => value.endsWith('-01'), {
  error: 'period_month must be the first day of the month (e.g. 2026-08-01)'
})
export type PeriodMonth = z.infer<typeof periodMonthSchema>

/**
 * Money, always integer cents. Negative is legal — `revenue_lines` expense
 * rows carry a negative `amount_cents` by design (ADR-003) so the canonical
 * `SUM` nets them without a `kind` filter. A float (`19.99`) fails: money
 * columns end `_cents` precisely so a bare float is visibly wrong.
 */
export const centsSchema = z.int({
  error: (issue) =>
    typeof issue.input === 'number' && Number.isFinite(issue.input) && !Number.isInteger(issue.input)
      ? 'Money must be integer cents, not a float — see CONVENTIONS.md'
      : issue.input instanceof Date
        ? dateInstanceMessage
        : 'Expected an integer number of cents'
})
export type Cents = z.infer<typeof centsSchema>

/**
 * Hours and other durations: `numeric`, i.e. floating point — SQLite `REAL`,
 * per §5's `time_entries.hours`. Deliberately asymmetric with `centsSchema`;
 * see CONVENTIONS.md for why that is not a bug to "fix".
 */
export const hoursSchema = z.number().finite().nonnegative({
  error: 'Hours must be a finite number, zero or greater'
})
export type Hours = z.infer<typeof hoursSchema>
