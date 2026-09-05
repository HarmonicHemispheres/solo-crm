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

/**
 * How wide a bar is. `month` is one bar per calendar month; `year` is one
 * per calendar year, and the bucketing happens **in main**, in the same
 * `GROUP BY` that produced the months (ADR-003: attributing money to a
 * period is an aggregation, and summing twelve monthly figures into a year
 * in the renderer would be exactly the arithmetic that decision moves into
 * SQL). A bucketed point's `periodMonth` is the first month of its bucket —
 * `YYYY-01-01` for a year — so one field carries both shapes and the chart
 * only has to know how to label it.
 */
export const REVENUE_BUCKETS = ['month', 'year'] as const
export type RevenueBucket = (typeof REVENUE_BUCKETS)[number]

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * **Marking a line invoiced or paid.**
 *
 * `status` was written by exactly one thing in the plan — the Stripe adapter
 * (§7, P4-02) — and until that exists every row in the table is `projected`.
 * The consequence on screen was the whole chart drawn dashed, months into
 * the past included, with nowhere to say otherwise: the operator had
 * invoiced the work and the software had no way to be told.
 *
 * So the operator is the second writer, and the vocabulary is the one that
 * was already there (`REVENUE_LINE_STATUSES`) rather than a parallel
 * "confirmed" flag Stripe would later have to be reconciled against.
 *
 * This is *not* a way to write a revenue figure by hand. `amount_cents`,
 * `period_month`, `kind` and `engagement_id` are the generator's, read from
 * the engagement's terms (ADR-003); this channel changes one column, on a
 * row that already exists, to say what has happened to money already
 * recognised. A generated row marked `invoiced` or `paid` also stops being
 * regenerated (the generator owns `projected` rows only), which is what
 * makes the mark survive the next edit to the engagement.
 */
export const setRevenueLineStatusInputSchema = z
  .object({
    id: z.string().min(1, 'id is required'),
    status: z.enum(REVENUE_LINE_STATUSES)
  })
  .strict()
export type SetRevenueLineStatusInput = z.infer<typeof setRevenueLineStatusInputSchema>

/**
 * Every line the operator wants to see what they are marking on — asked for
 * by window, by engagement, or by both.
 *
 * The window is inclusive at both ends, like every other month range here,
 * and both ends travel together: half a window is a question with no answer,
 * not a request for everything from January. The engagement filter is what
 * lets the engagement form show one engagement's whole schedule without
 * naming a window it would have to invent — a retainer's lines run as far as
 * its term does, which the form does not know.
 *
 * At least one of the two must be present. An empty object would be "every
 * line ever", which is the one read this channel should not offer: the table
 * grows with the timelog (§8's 20k target) and nothing in the UI wants it.
 */
export const listRevenueLinesInputSchema = z
  .object({
    from: periodMonthSchema.optional(),
    to: periodMonthSchema.optional(),
    engagementId: z.string().optional()
  })
  .strict()
  .refine((input) => (input.from === undefined) === (input.to === undefined), {
    error: 'A window needs both ends'
  })
  .refine((input) => input.from !== undefined || input.engagementId !== undefined, {
    error: 'Ask for a window, an engagement, or both'
  })
export type ListRevenueLinesInput = z.infer<typeof listRevenueLinesInputSchema>

/**
 * One row of the lines list: the stored line, plus the names needed to say
 * which engagement it belongs to. The names are joined in main and carried
 * here so the view does not hold a second copy of the engagements list to
 * resolve them against.
 */
export const revenueLineSchema = z.object({
  id: z.string(),
  engagementId: z.string().nullable(),
  engagementName: z.string().nullable(),
  billingCompanyName: z.string().nullable(),
  periodMonth: periodMonthSchema,
  kind: z.enum(REVENUE_LINE_KINDS).nullable(),
  status: z.enum(REVENUE_LINE_STATUSES),
  amountCents: centsSchema
})
export type RevenueLine = z.infer<typeof revenueLineSchema>

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
    now: timestampSchema.optional(),
    /**
     * The reported window, inclusive, and what the chart draws. Omitted, it
     * is the twelve months around `now` that this channel has always
     * answered with — so every existing caller keeps its answer.
     *
     * It is a *window*, not a filter on the four metrics: "recurring per
     * month" and "T&M run rate" are statements about now, and moving the
     * chart back a year must not silently restate them about last year.
     * What the window does carry is `windowTotalCents` in the response —
     * the one figure that is *of* the range.
     */
    window: z.object({ from: periodMonthSchema, to: periodMonthSchema }).strict().optional(),
    bucket: z.enum(REVENUE_BUCKETS).optional()
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
  /** The chart's window, inclusive — the request's, or twelve months around `currentMonth`. Buckets with no lines have no point; the chart fills them. */
  window: z.object({ from: periodMonthSchema, to: periodMonthSchema }),
  /** How `series` and `months` are bucketed — the request's, defaulting to `month`. */
  bucket: z.enum(REVENUE_BUCKETS),
  /**
   * **The period forecast.** Every line in the window, summed — invoiced,
   * paid and still projected alike. The generator writes lines only for
   * signed engagements (`SIGNED_STATUSES`: active, pending, delivered) and
   * removes its projected rows the moment one stops being signed, so this
   * is what those engagements are expected to bring in over the period,
   * read off the lines rather than recomputed from their terms (ADR-003).
   * The one figure that is *of* the range rather than of now.
   */
  windowTotalCents: centsSchema,
  /** The part of `windowTotalCents` already `invoiced` or `paid` — what has actually happened of the forecast. */
  windowActualCents: centsSchema,
  /** Distinct engagements with at least one line in the window — how many pieces of work the forecast rests on. */
  windowEngagements: z.number().int().nonnegative(),
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
