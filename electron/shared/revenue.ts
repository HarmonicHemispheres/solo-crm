import { z } from 'zod'
import { BILLING_MODELS } from './engagements'
import { centsSchema, periodMonthSchema, timestampSchema } from './types'

/**
 * `revenue_lines`' wire contract (ADR-007): the line vocabulary the
 * generator writes (T-260902-03) and the shape `revenue:summary` answers
 * with (T-260902-04). Pure zod, no Node imports — typechecked under both
 * tsconfigs like every `electron/shared/**` module.
 *
 * Every number here is a `SUM(amount_cents)` over `revenue_lines` grouped
 * one way or another (ADR-003). Nothing in this shape is computed from an
 * engagement's own columns, and the view that reads it (`views/Revenue.tsx`)
 * computes nothing further: the rollup toggle changes which `rows` come
 * back, never the arithmetic, and the four metrics are the same query with a
 * different filter. That is why the response carries its `totals` — a test
 * asserts the three rollups' totals are equal to the cent, which is the
 * property §6.7 promises ("same totals, different attribution").
 */

/** `schema.ts`'s comment on `revenue_lines.kind`. The generator writes the first three; `writeTmActual` the fourth; the operator the fifth. */
export const REVENUE_LINE_KINDS = ['retainer', 'milestone', 'tm_estimate', 'tm_actual', 'expense'] as const
export type RevenueLineKind = (typeof REVENUE_LINE_KINDS)[number]

/** `schema.ts`'s comment on `revenue_lines.status`. `projected` is the generator's; the other two are Stripe's (§7). */
export const REVENUE_LINE_STATUSES = ['projected', 'invoiced', 'paid'] as const
export type RevenueLineStatus = (typeof REVENUE_LINE_STATUSES)[number]

/**
 * §6.7's three attributions. `billing` groups by the company on the invoice
 * (`engagements.billing_company_id`), `client` by who the work is for
 * (`client_company_id`), `model` by `engagements.billing_model` — used there
 * as a `GROUP BY` key only, never as a branch (T-260902-04's constraint).
 */
export const REVENUE_ROLLUPS = ['billing', 'client', 'model'] as const
export type RevenueRollup = (typeof REVENUE_ROLLUPS)[number]

/**
 * The chart's stacks. `tm_estimate` and `tm_actual` fold into one `tm`
 * series — a month holds one or the other, never both (ADR-003), and the
 * chart draws "how it is earned", which is the same either way. Whether a
 * month's money is still projected or already invoiced is the *status*
 * axis, carried separately below.
 *
 * `expense` is not a stack: a negative amount has no height. The series
 * is therefore gross of expenses and says so; the four metrics and the
 * rollup's columns are net (their `SUM` has no kind filter). Nothing
 * writes an expense row yet; when something does, the chart's job is
 * still to show what is earned, and the tiles' is to show what is kept.
 */
export const REVENUE_SERIES_KINDS = ['retainer', 'milestone', 'tm'] as const
export type RevenueSeriesKind = (typeof REVENUE_SERIES_KINDS)[number]

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** `writeTmActual`'s input: one T&M month's actual, replacing that month's estimate. */
export const writeTmActualInputSchema = z
  .object({
    engagementId: z.string().min(1, 'engagementId is required'),
    periodMonth: periodMonthSchema,
    amountCents: centsSchema,
    /** Defaults to `projected` — worked, not yet invoiced. */
    status: z.enum(REVENUE_LINE_STATUSES).optional()
  })
  .strict()
export type WriteTmActualInput = z.infer<typeof writeTmActualInputSchema>

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/**
 * `revenue:summary`'s request. `now` is the instant "this month" is read
 * from; the renderer never sends it (main reads its own clock) — it exists
 * so a test can pin the month the summary is computed against. There is no
 * rollup here: the response carries all three, so flipping the toggle is a
 * lookup in a payload already held, not a second read.
 */
export const revenueSummaryRequestSchema = z
  .object({
    now: timestampSchema.optional()
  })
  .strict()
export type RevenueSummaryRequest = z.infer<typeof revenueSummaryRequestSchema>

/** One cell of the chart: a month, a stack, projected or actual, and the sum. The canonical `GROUP BY period_month, kind, status` row. */
export const revenueSeriesPointSchema = z.object({
  periodMonth: periodMonthSchema,
  kind: z.enum(REVENUE_SERIES_KINDS),
  /** `actual` is `invoiced` or `paid`; everything else is still a projection. */
  status: z.enum(['projected', 'actual']),
  cents: centsSchema
})
export type RevenueSeriesPoint = z.infer<typeof revenueSeriesPointSchema>

/** One row of the rollup table. Which entity a row names depends on the rollup; the money columns never do. */
export const revenueRollupRowSchema = z.object({
  /** The group key: a company id, a billing model, or `'none'` for lines whose engagement names no company / no model. */
  key: z.string(),
  name: z.string(),
  /** Set on the `model` rollup only — what `ModelTag` draws. */
  model: z.enum(BILLING_MODELS).nullable(),
  /** Set on the two company rollups when the row is a real company, so the row can navigate to it. */
  companyId: z.string().nullable(),
  /** The `billing` rollup only: the company this one is billed through, when it is (`companies.billed_via_company_id`). */
  via: z.string().nullable(),
  /** Engagements with at least one line in this group. */
  engagementCount: z.number().int().nonnegative(),
  /** This month's lines. */
  monthlyCents: centsSchema,
  /** Milestone lines not yet invoiced — what a fixed scope still has to bill. */
  backlogCents: centsSchema,
  /** Lines from the fiscal year's first month through this one. */
  ytdCents: centsSchema,
  /** `ytdCents` over the rollup's YTD total; `0` when the total is zero. */
  ytdShare: z.number().min(0).max(1)
})
export type RevenueRollupRow = z.infer<typeof revenueRollupRowSchema>

export const revenuePayerSchema = z.object({
  name: z.string(),
  cents: centsSchema,
  share: z.number().min(0).max(1)
})
export type RevenuePayer = z.infer<typeof revenuePayerSchema>

/** §6.7's four metrics, each one `SUM` with one filter. */
export const revenueMetricsSchema = z.object({
  /** `retainer` lines in the current month. */
  recurringMonthCents: centsSchema,
  /** Engagements with a `retainer` line this month — the mockup's "2 retainers signed". */
  recurringEngagements: z.number().int().nonnegative(),
  /** `retainer` lines over the next twelve months, this one included — the annual figure ADR-003 routes through this table. */
  recurringNextYearCents: centsSchema,
  /** `milestone` lines still `projected`. */
  backlogCents: centsSchema,
  backlogMilestones: z.number().int().nonnegative(),
  /** `tm_estimate` + `tm_actual` lines in the current month. */
  tmMonthCents: centsSchema,
  /**
   * The largest billing party's share of the fiscal year to date — by
   * billing party whatever `rollup` was asked for, so the number does not
   * move when the toggle does (T-260902-04's acceptance). `share` is `null`
   * when the year has no revenue yet.
   */
  concentration: z.object({
    share: z.number().min(0).max(1).nullable(),
    name: z.string().nullable(),
    /** Every payer with YTD revenue, largest first — the segments of the concentration bar. */
    payers: z.array(revenuePayerSchema).readonly()
  })
})
export type RevenueMetrics = z.infer<typeof revenueMetricsSchema>

const revenueRollupRowsSchema = z.array(revenueRollupRowSchema).readonly()

export const revenueSummarySchema = z.object({
  currentMonth: periodMonthSchema,
  /** The first month of the fiscal year `currentMonth` falls in (`workspace.fiscalYearStartMonth`). */
  yearStart: periodMonthSchema,
  /** Rows in `revenue_lines`, all kinds and statuses. `0` is the view's empty state: nothing has been generated yet, and the four metrics would be zeros that mean nothing. */
  lineCount: z.number().int().nonnegative(),
  metrics: revenueMetricsSchema,
  /** The chart's window, inclusive — twelve months around `currentMonth`. Months with no lines have no point; the chart fills them. */
  window: z.object({ from: periodMonthSchema, to: periodMonthSchema }),
  /** Gross of expense lines — see `REVENUE_SERIES_KINDS`. */
  series: z.array(revenueSeriesPointSchema).readonly(),
  /** Each month of the window's gross total — `GROUP BY period_month` over the same lines as `series` — for the chart's scale and its tooltips, so no total is summed in the renderer. */
  months: z.array(z.object({ periodMonth: periodMonthSchema, cents: centsSchema })).readonly(),
  /** The same money attributed three ways, each largest YTD first. */
  rollups: z.object({ billing: revenueRollupRowsSchema, client: revenueRollupRowsSchema, model: revenueRollupRowsSchema }),
  /** The column sums of any rollup's rows — equal across the three by construction (every line is in exactly one group under each key), and asserted so. */
  totals: z.object({ monthlyCents: centsSchema, backlogCents: centsSchema, ytdCents: centsSchema })
})
export type RevenueSummary = z.infer<typeof revenueSummarySchema>
