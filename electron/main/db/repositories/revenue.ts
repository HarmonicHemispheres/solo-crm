import type Database from 'better-sqlite3'
import { addMonths, localPeriodMonth, nowTimestamp } from '../../../shared/format'
import { periodMonthSchema } from '../../../shared/types'
import type { PeriodMonth } from '../../../shared/types'
import type { BillingModel } from '../../../shared/engagements'
import {
  listRevenueLinesInputSchema,
  revenueSummaryRequestSchema,
  setRevenueLineStatusInputSchema,
  type RevenueBucket,
  type RevenueLine,
  type RevenueLineKind,
  type RevenueLineStatus,
  type RevenueRollup,
  type RevenueRollupRow,
  type RevenueSeriesPoint,
  type RevenueSummary
} from '../../../shared/revenue'
import { NotFoundError } from './errors'
import { getSetting } from './settings'
import { parseInput } from './input'

/**
 * The revenue rollups (T-260902-04, P3-06): §6.7's four metrics, the
 * chart's series and the rollup table, every one of them a
 * `SUM(amount_cents)` over `revenue_lines` (ADR-003) with a different
 * filter or `GROUP BY` key. Nothing here reads a rate, a contract value or
 * an hours column off `engagements`; the join to that table is for its two
 * company columns and its `billing_model`, and the model is used as a group
 * key only — there is no `CASE billing_model` anywhere in this file, and
 * `revenue-generator.test.ts`'s source scan keeps it that way.
 *
 * The three rollups are one query, `rollupRows`, differing in the
 * expression it groups by, and the summary carries all three: they are
 * three cheap `GROUP BY`s over the same lines, and one payload means the
 * view's toggle and Today's tiles share a single cache entry. That one
 * query is what makes "same totals, different attribution" true by
 * construction rather than by care: every line belongs to exactly one
 * group under each key (a NULL company or model is its own group,
 * `'none'`), so the column sums cannot differ between rollups.
 * `revenue.test.ts` asserts it anyway.
 *
 * "This month", "the fiscal year to date" and the chart's window are all
 * derived from one instant, `now`, read once per call as the operator's
 * local calendar month (`localPeriodMonth`) — the renderer never sends it;
 * a test pins it through the request's optional field.
 *
 * `revenue_lines.engagement_id` is nullable, so the join to `engagements`
 * is a `LEFT JOIN`: a line with no engagement (an operator's expense row,
 * one day) groups under `'none'` in every rollup rather than dropping out
 * of the table while staying in the tiles above it. The four metrics, the
 * series and the rows are then all sums over the same set of lines, which
 * is what lets the footer claim to be the same money as the tiles.
 */

/** Months the chart shows before the current one. With `CHART_MONTHS`, this puts the current month a third of the way in: what landed, then what is coming. */
const CHART_MONTHS_BEFORE = 3
/** The chart's width in months, the current month included. */
const CHART_MONTHS = 12
/** The recurring "next year" metric: the current month and the eleven after it — the same span the generator projects a rolling retainer over. */
const NEXT_YEAR_MONTHS = 12

interface SumRow {
  readonly cents: number | null
  readonly count: number
}

interface SeriesRow {
  readonly period_month: string
  readonly kind: string
  readonly status: 'projected' | 'actual'
  readonly cents: number
}

interface RollupRow {
  readonly key: string | null
  readonly name: string | null
  readonly via: string | null
  readonly engagement_count: number
  readonly monthly_cents: number | null
  readonly backlog_cents: number | null
  readonly ytd_cents: number | null
}

const MODEL_LABEL: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed scope',
  tm: 'Time & materials',
  equity: 'Equity',
  none: 'Unpriced'
}

/** The first month of the fiscal year containing `month`, given the year's first month number (1-12). */
export function fiscalYearStart(month: PeriodMonth, fiscalYearStartMonth: number): PeriodMonth {
  const [year, monthNumber] = month.split('-').map(Number)
  const startYear = monthNumber >= fiscalYearStartMonth ? year : year - 1
  return periodMonthSchema.parse(`${startYear}-${String(fiscalYearStartMonth).padStart(2, '0')}-01`)
}

function sum(db: Database.Database, where: string, params: readonly unknown[]): SumRow {
  return db
    .prepare(`SELECT SUM(amount_cents) AS cents, COUNT(*) AS count FROM revenue_lines WHERE ${where}`)
    .get(...params) as SumRow
}

/**
 * A part over a whole, kept inside `[0, 1]`. Expense lines are negative
 * (ADR-003), so a group's part can exceed the total or the total can be
 * zero or negative; the wire schema bounds every share, and a share the
 * schema rejects would take the whole page down with it.
 */
function shareOf(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, part / total))
}

/**
 * The rollup table. `groupKey` and the name/via columns are the only
 * things that change between the three rollups; the four aggregates are
 * identical, which is the point.
 *
 * `backlog` is a filter on the *line's* kind (`milestone`, still
 * `projected`), which ADR-003 permits — it is what remains to be billed of
 * every fixed scope, read off the lines the generator wrote from the
 * milestones, not recomputed from them.
 */
function rollupRows(db: Database.Database, rollup: RevenueRollup, currentMonth: PeriodMonth, yearStart: PeriodMonth): RevenueRollupRow[] {
  const grouping =
    rollup === 'model'
      ? {
          key: 'e.billing_model',
          name: 'NULL',
          via: 'NULL',
          join: ''
        }
      : rollup === 'billing'
        ? {
            key: 'e.billing_company_id',
            name: 'c.name',
            via: 'v.name',
            join: 'LEFT JOIN companies c ON c.id = e.billing_company_id LEFT JOIN companies v ON v.id = c.billed_via_company_id'
          }
        : {
            key: 'e.client_company_id',
            name: 'c.name',
            via: 'NULL',
            join: 'LEFT JOIN companies c ON c.id = e.client_company_id'
          }

  const rows = db
    .prepare(
      `SELECT ${grouping.key} AS key,
              ${grouping.name} AS name,
              ${grouping.via} AS via,
              COUNT(DISTINCT e.id) AS engagement_count,
              SUM(CASE WHEN r.period_month = ? THEN r.amount_cents ELSE 0 END) AS monthly_cents,
              SUM(CASE WHEN r.kind = 'milestone' AND r.status = 'projected' THEN r.amount_cents ELSE 0 END) AS backlog_cents,
              SUM(CASE WHEN r.period_month BETWEEN ? AND ? THEN r.amount_cents ELSE 0 END) AS ytd_cents
       FROM revenue_lines r
       LEFT JOIN engagements e ON e.id = r.engagement_id
       ${grouping.join}
       GROUP BY ${grouping.key}`
    )
    .all(currentMonth, yearStart, currentMonth) as RollupRow[]

  const ytdTotal = rows.reduce((total, row) => total + (row.ytd_cents ?? 0), 0)

  return rows
    .map((row): RevenueRollupRow => {
      const model = rollup === 'model' ? (row.key as BillingModel | null) : null
      const name = rollup === 'model' ? (model ? MODEL_LABEL[model] : 'No billing model') : (row.name ?? 'No company')
      return {
        key: row.key ?? 'none',
        name,
        model,
        companyId: rollup === 'model' ? null : row.key,
        via: row.via,
        engagementCount: row.engagement_count,
        monthlyCents: row.monthly_cents ?? 0,
        backlogCents: row.backlog_cents ?? 0,
        ytdCents: row.ytd_cents ?? 0,
        ytdShare: shareOf(row.ytd_cents ?? 0, ytdTotal)
      }
    })
    .sort((a, b) => b.ytdCents - a.ytdCents || a.name.localeCompare(b.name))
}

/**
 * The SQL expression a bucketed `GROUP BY` uses for `period_month`.
 *
 * `period_month` is stored as a `YYYY-MM-DD` first-of-month string
 * (CONVENTIONS.md), so a year bucket is that string's first four characters
 * with `-01-01` after them — string arithmetic on a value whose format the
 * schema fixes, and no date parsing in SQLite. The `month` bucket is the
 * column itself, so the two paths are one query with a different key rather
 * than a branch producing two different shapes.
 *
 * **This lives here, not in the renderer.** Folding twelve months into a
 * year is an attribution of money to a period, which ADR-003 puts in one
 * `SUM … GROUP BY` in main — the same rule that keeps `× 12` out of the
 * view.
 */
function bucketExpression(bucket: RevenueBucket): string {
  return bucket === 'year' ? "substr(period_month, 1, 4) || '-01-01'" : 'period_month'
}

export function revenueSummary(db: Database.Database, input: unknown): RevenueSummary {
  const parsed = parseInput(revenueSummaryRequestSchema, input)
  const currentMonth = localPeriodMonth(parsed.now ? new Date(parsed.now) : new Date())
  const yearStart = fiscalYearStart(currentMonth, getSetting(db, 'workspace.fiscalYearStartMonth'))
  const nextYearEnd = addMonths(currentMonth, NEXT_YEAR_MONTHS - 1)
  const bucket: RevenueBucket = parsed.bucket ?? 'month'
  const bucketKey = bucketExpression(bucket)
  // The default window is what this channel has always answered with, so a
  // caller that sends none gets the same twelve months it did before the
  // request grew a window. A window sent backwards (`to` before `from`) is
  // read as the single month `from`, rather than as an empty chart with no
  // explanation: `eachMonth` in the renderer would yield nothing for it.
  const windowFrom = parsed.window?.from ?? addMonths(currentMonth, -CHART_MONTHS_BEFORE)
  const windowTo = parsed.window ? (parsed.window.to < windowFrom ? windowFrom : parsed.window.to) : addMonths(windowFrom, CHART_MONTHS - 1)

  const lineCount = (db.prepare('SELECT COUNT(*) AS count FROM revenue_lines').get() as { count: number }).count

  const recurring = db
    .prepare(
      "SELECT SUM(amount_cents) AS cents, COUNT(DISTINCT engagement_id) AS count FROM revenue_lines WHERE kind = 'retainer' AND period_month = ?"
    )
    .get(currentMonth) as SumRow
  const recurringNextYear = sum(db, "kind = 'retainer' AND period_month BETWEEN ? AND ?", [currentMonth, nextYearEnd])
  const backlog = sum(db, "kind = 'milestone' AND status = 'projected'", [])
  const tmMonth = sum(db, "kind IN ('tm_estimate', 'tm_actual') AND period_month = ?", [currentMonth])

  const rollups = {
    billing: rollupRows(db, 'billing', currentMonth, yearStart),
    client: rollupRows(db, 'client', currentMonth, yearStart),
    model: rollupRows(db, 'model', currentMonth, yearStart)
  }
  // Concentration is by billing party whatever rollup is on screen — the
  // `billing` rollup's own YTD column, largest first, which `rollupRows`
  // already sorts by. One definition of a payer's share, not two.
  const payerRows = rollups.billing.filter((row) => row.ytdCents > 0).map((row) => ({ name: row.name, cents: row.ytdCents, share: row.ytdShare }))
  const largest = payerRows[0]

  const series: RevenueSeriesPoint[] = []
  const seriesRows = db
    .prepare(
      `SELECT ${bucketKey} AS period_month,
              CASE kind WHEN 'tm_estimate' THEN 'tm' WHEN 'tm_actual' THEN 'tm' ELSE kind END AS kind,
              CASE WHEN status IN ('invoiced', 'paid') THEN 'actual' ELSE 'projected' END AS status,
              SUM(amount_cents) AS cents
       FROM revenue_lines
       WHERE period_month BETWEEN ? AND ? AND kind <> 'expense'
       GROUP BY 1, 2, 3
       ORDER BY 1, 2, 3`
    )
    .all(windowFrom, windowTo) as SeriesRow[]
  for (const row of seriesRows) {
    // A row the chart cannot place — a NULL or unknown `kind`, or a
    // `period_month` that is not a first-of-month (nothing in the schema
    // forbids one; only the generator's writes are validated) — is left
    // out of the chart, not out of the totals, and never takes the page
    // down: Today folds this channel's error into its own, so a throw
    // here would blank the dashboard over one hand-edited row.
    const kind = row.kind === 'retainer' || row.kind === 'milestone' || row.kind === 'tm' ? row.kind : null
    const periodMonth = periodMonthSchema.safeParse(row.period_month)
    if (kind === null || !periodMonth.success) continue
    series.push({ periodMonth: periodMonth.data, kind, status: row.status, cents: row.cents })
  }

  const months: RevenueSummary['months'][number][] = []
  const monthRows = db
    .prepare(
      `SELECT ${bucketKey} AS period_month, SUM(amount_cents) AS cents FROM revenue_lines
       WHERE period_month BETWEEN ? AND ? AND kind <> 'expense' AND kind IS NOT NULL
       GROUP BY 1 ORDER BY 1`
    )
    .all(windowFrom, windowTo) as { period_month: string; cents: number }[]
  for (const row of monthRows) {
    const periodMonth = periodMonthSchema.safeParse(row.period_month)
    if (periodMonth.success) months.push({ periodMonth: periodMonth.data, cents: row.cents })
  }

  // The window's own total — every line in it, expenses included, so it is
  // net the way the rollup's columns are net rather than gross the way the
  // chart is. One `SUM`, not a fold over `months`.
  const windowTotal = sum(db, 'period_month BETWEEN ? AND ?', [windowFrom, windowTo])
  // What has happened of that forecast, and how many engagements it rests
  // on: the same window, one status filter, one `COUNT(DISTINCT)`.
  const windowActual = sum(db, "period_month BETWEEN ? AND ? AND status IN ('invoiced', 'paid')", [windowFrom, windowTo])
  const windowEngagements = (
    db
      .prepare('SELECT COUNT(DISTINCT engagement_id) AS count FROM revenue_lines WHERE period_month BETWEEN ? AND ? AND engagement_id IS NOT NULL')
      .get(windowFrom, windowTo) as { count: number }
  ).count

  return {
    currentMonth,
    yearStart,
    lineCount,
    metrics: {
      recurringMonthCents: recurring.cents ?? 0,
      recurringEngagements: recurring.count,
      recurringNextYearCents: recurringNextYear.cents ?? 0,
      backlogCents: backlog.cents ?? 0,
      backlogMilestones: backlog.count,
      tmMonthCents: tmMonth.cents ?? 0,
      concentration: {
        share: largest ? largest.share : null,
        name: largest ? largest.name : null,
        payers: payerRows
      }
    },
    window: { from: windowFrom, to: windowTo },
    bucket,
    windowTotalCents: windowTotal.cents ?? 0,
    windowActualCents: windowActual.cents ?? 0,
    windowEngagements,
    series,
    months,
    rollups,
    totals: {
      monthlyCents: rollups.billing.reduce((total, row) => total + row.monthlyCents, 0),
      backlogCents: rollups.billing.reduce((total, row) => total + row.backlogCents, 0),
      ytdCents: rollups.billing.reduce((total, row) => total + row.ytdCents, 0)
    }
  }
}

// ---------------------------------------------------------------------------
// The lines themselves, and the operator's one column
// ---------------------------------------------------------------------------

interface RevenueLineRow {
  readonly id: string
  readonly engagement_id: string | null
  readonly engagement_name: string | null
  readonly billing_company_name: string | null
  readonly period_month: string
  readonly kind: string | null
  readonly status: string
  readonly amount_cents: number
}

/**
 * Every line in a window, newest month first, with the two names needed to
 * say which engagement it belongs to.
 *
 * This is a *list of rows*, not a figure: it sums nothing and attributes
 * nothing, so ADR-003 has no quarrel with it — the decision is about where
 * revenue is computed, and reading back the rows it was computed from is
 * how the operator sees what there is to mark. Every total on the page
 * still comes from `revenueSummary` above.
 *
 * A line whose `period_month` or `status` the schema rejects (nothing in
 * SQLite forbids a hand-edited one) is skipped rather than thrown on, for
 * the reason `revenueSummary`'s series loop gives: one bad row must not
 * blank a page.
 */
export function listRevenueLines(db: Database.Database, input: unknown): readonly RevenueLine[] {
  const { from, to } = parseInput(listRevenueLinesInputSchema, input)
  const rows = db
    .prepare(
      `SELECT r.id, r.engagement_id, e.name AS engagement_name, c.name AS billing_company_name,
              r.period_month, r.kind, r.status, r.amount_cents
       FROM revenue_lines r
       LEFT JOIN engagements e ON e.id = r.engagement_id
       LEFT JOIN companies c ON c.id = e.billing_company_id
       WHERE r.period_month BETWEEN ? AND ?
       ORDER BY r.period_month DESC, e.name COLLATE NOCASE, r.kind`
    )
    .all(from, to) as RevenueLineRow[]

  const lines: RevenueLine[] = []
  for (const row of rows) {
    const periodMonth = periodMonthSchema.safeParse(row.period_month)
    if (!periodMonth.success) continue
    if (row.status !== 'projected' && row.status !== 'invoiced' && row.status !== 'paid') continue
    lines.push({
      id: row.id,
      engagementId: row.engagement_id,
      engagementName: row.engagement_name,
      billingCompanyName: row.billing_company_name,
      periodMonth: periodMonth.data,
      kind: (row.kind as RevenueLineKind | null) ?? null,
      status: row.status as RevenueLineStatus,
      amountCents: row.amount_cents
    })
  }
  return lines
}

/**
 * Move one line between `projected`, `invoiced` and `paid`.
 *
 * One column, on a row that already exists. Nothing here writes an amount, a
 * month, a kind or an engagement — those are the generator's, read from the
 * engagement's terms, and a channel that let the renderer set them would be
 * the second path around ADR-003 that `revenue:summary` was built to avoid.
 *
 * The consequence beyond the chart: the generator owns `projected` rows
 * only, so marking a line `invoiced` also takes it out of the generator's
 * hands — the next edit to the engagement will not overwrite it, and will
 * not put a fresh projection in the same month beside it.
 */
export function setRevenueLineStatus(db: Database.Database, input: unknown): RevenueLine {
  const { id, status } = parseInput(setRevenueLineStatusInputSchema, input)
  const changed = db
    .prepare('UPDATE revenue_lines SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowTimestamp(), id).changes
  if (changed === 0) throw new NotFoundError('revenue line', id)

  const row = db
    .prepare(
      `SELECT r.id, r.engagement_id, e.name AS engagement_name, c.name AS billing_company_name,
              r.period_month, r.kind, r.status, r.amount_cents
       FROM revenue_lines r
       LEFT JOIN engagements e ON e.id = r.engagement_id
       LEFT JOIN companies c ON c.id = e.billing_company_id
       WHERE r.id = ?`
    )
    .get(id) as RevenueLineRow
  return {
    id: row.id,
    engagementId: row.engagement_id,
    engagementName: row.engagement_name,
    billingCompanyName: row.billing_company_name,
    periodMonth: periodMonthSchema.parse(row.period_month),
    kind: (row.kind as RevenueLineKind | null) ?? null,
    status: row.status as RevenueLineStatus,
    amountCents: row.amount_cents
  }
}
