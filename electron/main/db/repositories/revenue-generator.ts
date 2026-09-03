import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { addMonths, eachMonth, localPeriodMonth, monthsBetween, nowTimestamp, periodMonthOf } from '../../../shared/format'
import { periodMonthSchema } from '../../../shared/types'
import type { PeriodMonth } from '../../../shared/types'
import { isSigned, type BillingModel, type EngagementStatus, type RetainerBasis } from '../../../shared/engagements'
import { writeTmActualInputSchema, type WriteTmActualInput } from '../../../shared/revenue'
import { NotFoundError, RefusalError } from './errors'
import { parseInput } from './input'

/**
 * The revenue line generator (T-260902-03, P3-05) — **the one place in the
 * codebase that may branch on `billing_model` to produce a revenue figure**
 * (ADR-003). It reads an engagement's own terms and its milestones and
 * writes `revenue_lines`, one row per expected amount per month, so that
 * every revenue question anywhere else is a `SUM(amount_cents) ... GROUP BY`
 * over that table and nothing else.
 *
 * It runs inside the write that changed the terms — `createEngagement`,
 * `updateEngagement`, and every milestone write through
 * `afterMilestoneWrite` — so the table can never be stale by a forgotten
 * call from the renderer. `npm run seed` runs it once per fixture engagement
 * for the same reason.
 *
 * ## What each model generates
 *
 * The enumeration below is exhaustive over `BILLING_MODELS`; an unlisted
 * model would be improvised at a call site, which is the failure ADR-003
 * names. `switch` with no default and an `assertNever` makes adding a sixth
 * model a compile error here.
 *
 * - **retainer** — one `retainer` row per month of its term, priced by its
 *   basis (migration 0008): the flat `monthly_amount_cents`, or
 *   `hours_included x hourly_rate_cents`. A retainer with no basis, or a
 *   basis with no numbers, generates nothing: nobody has stated its price,
 *   and a forecast must not contain a figure no one entered.
 * - **fixed** — one `milestone` row per milestone, at that milestone's
 *   `expected_month`, for its `amount_cents`. A milestone missing either
 *   (pre-T-260902-02 data) generates nothing. **Until an engagement has
 *   any milestone**, its `contract_value_cents` is spread evenly across
 *   its term as `milestone` rows (odd cents on the last month; a fixed
 *   scope with no end date puts the whole value in its first month): the
 *   operator has told the app what the work is worth and when it runs,
 *   and a forecast that showed nothing for a signed $18,000 build until
 *   its milestones were typed in would be the less honest reading. The
 *   first milestone entered replaces the spread with the plan.
 * - **tm** — `tm_estimate` rows at `estimated_hours x hourly_rate_cents`,
 *   never more in total than `not_to_exceed_cents`. A bounded term spreads
 *   the estimate evenly across its months (the odd cents land on the last
 *   month, so the rows sum to the estimate exactly); a rolling one has no
 *   total to spread, so the estimate is read as the expected work *per
 *   month* — "~30 hrs at $165" of ongoing advisory — until the horizon or
 *   the cap, whichever comes first. `writeTmActual` replaces a month's
 *   estimate with what was actually worked.
 * - **equity** and **none** — no rows at all. They are excluded by absence,
 *   not by a filter every consumer would have to remember.
 *
 * ## The term
 *
 * `started_on`'s month through `ends_on`'s month, inclusive. Where `ends_on`
 * is NULL the engagement is rolling (`shared/engagements.ts`'s header) and
 * runs to `ROLLING_HORIZON_MONTHS` from the current month — a parameter of
 * this module, not a judgement per engagement — regenerated as months
 * pass. A `delivered` engagement with no `ends_on` stops at the current
 * month: the work is finished, and projecting it forward would be a
 * forecast of nothing.
 *
 * ## Which engagements generate
 *
 * A forecast is of work that is signed — `SIGNED_STATUSES` in
 * `shared/engagements.ts`, which says why each status is in or out — so the
 * Revenue page never counts a proposal as recurring revenue. This is a
 * filter on `status`, which ADR-003 does not restrict; the model branch is
 * the thing it confines to this file.
 *
 * ## Idempotent and non-destructive (ADR-003's three rules)
 *
 * Regeneration diffs the rows it owns — `retainer`, `milestone` and
 * `tm_estimate` rows still `projected` — against what the terms now say:
 * a row that already matches by (month, kind, amount) is kept, id and
 * timestamps intact; the rest are deleted; what is missing is inserted.
 * Running it twice therefore changes no row, which `revenue-generator.test.ts`
 * asserts on the raw table.
 *
 * Three kinds of row are never touched here: rows already `invoiced` or
 * `paid` (Stripe's, §7 — and a month that holds one gets no new projected
 * row of the same kind beside it, or the invoice and the projection would
 * both count); `tm_actual` rows (facts, written by `writeTmActual`, which
 * also stops an estimate being regenerated into a month that has one); and
 * `expense` rows (operator-entered, the table's one other writer).
 */

/** How far a rolling engagement is projected: this many months counting the current one. */
export const ROLLING_HORIZON_MONTHS = 12

/** The kinds this module writes on regeneration. `tm_actual` is `writeTmActual`'s; `expense` is the operator's. */
const GENERATED_KINDS = ['retainer', 'milestone', 'tm_estimate'] as const
type GeneratedKind = (typeof GENERATED_KINDS)[number]

/** The rows this module owns: a generated kind, still projected. The one statement of the rule, used by the reconciliation below and by `deleteGeneratedLines`. */
const OWNED_LINES_SQL = `status = 'projected' AND kind IN (${GENERATED_KINDS.map((kind) => `'${kind}'`).join(', ')})`

export interface GeneratorOptions {
  /** The instant "the current month" is read from. Tests pin it; production reads the clock. */
  readonly now?: Date
}

interface EngagementTermsRow {
  readonly id: string
  readonly billing_model: BillingModel | null
  readonly status: EngagementStatus | null
  readonly started_on: string
  readonly ends_on: string | null
  readonly retainer_basis: RetainerBasis | null
  readonly monthly_amount_cents: number | null
  readonly hours_included: number | null
  readonly contract_value_cents: number | null
  readonly hourly_rate_cents: number | null
  readonly estimated_hours: number | null
  readonly not_to_exceed_cents: number | null
}

interface MilestoneTermsRow {
  readonly amount_cents: number | null
  readonly expected_month: string | null
}

interface DesiredLine {
  readonly periodMonth: PeriodMonth
  readonly kind: GeneratedKind
  readonly amountCents: number
}

interface ExistingLine {
  readonly id: string
  readonly period_month: string
  readonly kind: string | null
  readonly status: string | null
  readonly amount_cents: number
}

function assertNever(value: never): never {
  throw new Error(`revenue generator: unhandled billing model ${String(value)}`)
}

// ---------------------------------------------------------------------------
// What the terms say
// ---------------------------------------------------------------------------

/** First and last month of the term, inclusive, or `null` when the term is empty (ends before it starts, or starts past the horizon). */
function termOf(row: EngagementTermsRow, currentMonth: PeriodMonth): { readonly from: PeriodMonth; readonly to: PeriodMonth } | null {
  const from = periodMonthOf(row.started_on)
  const to =
    row.ends_on !== null
      ? periodMonthOf(row.ends_on)
      : row.status === 'delivered'
        ? currentMonth
        : addMonths(currentMonth, ROLLING_HORIZON_MONTHS - 1)
  return monthsBetween(from, to) < 0 ? null : { from, to }
}

function retainerMonthly(row: EngagementTermsRow): number | null {
  if (row.retainer_basis === 'amount') return row.monthly_amount_cents
  if (row.retainer_basis === 'hours') {
    if (row.hours_included === null || row.hourly_rate_cents === null) return null
    return Math.round(row.hours_included * row.hourly_rate_cents)
  }
  return null
}

function retainerLines(row: EngagementTermsRow, currentMonth: PeriodMonth): DesiredLine[] {
  const monthly = retainerMonthly(row)
  const term = termOf(row, currentMonth)
  if (monthly === null || term === null) return []
  return eachMonth(term.from, term.to).map((periodMonth) => ({ periodMonth, kind: 'retainer', amountCents: monthly }))
}

/** `total` over `months`, evenly, the odd cents on the last month so the rows sum to `total` exactly. */
function spreadEvenly(total: number, months: readonly PeriodMonth[], kind: GeneratedKind): DesiredLine[] {
  if (total <= 0 || months.length === 0) return []
  const share = Math.floor(total / months.length)
  const remainder = total - share * months.length
  return months.map((periodMonth, index) => ({
    periodMonth,
    kind,
    amountCents: index === months.length - 1 ? share + remainder : share
  }))
}

function milestoneLines(db: Database.Database, row: EngagementTermsRow, currentMonth: PeriodMonth): DesiredLine[] {
  const milestones = db
    .prepare('SELECT amount_cents, expected_month FROM milestones WHERE engagement_id = ?')
    .all(row.id) as MilestoneTermsRow[]
  if (milestones.length === 0) {
    // No plan yet: the contract value over the term (header, "fixed").
    if (row.contract_value_cents === null) return []
    const term = termOf(row, currentMonth)
    if (term === null) return []
    const months = row.ends_on === null ? [term.from] : eachMonth(term.from, term.to)
    return spreadEvenly(row.contract_value_cents, months, 'milestone')
  }
  const lines: DesiredLine[] = []
  for (const milestone of milestones) {
    if (milestone.amount_cents === null || milestone.expected_month === null) continue
    const parsed = periodMonthSchema.safeParse(milestone.expected_month)
    if (!parsed.success) continue
    lines.push({ periodMonth: parsed.data, kind: 'milestone', amountCents: milestone.amount_cents })
  }
  return lines
}

function tmLines(row: EngagementTermsRow, currentMonth: PeriodMonth): DesiredLine[] {
  if (row.hourly_rate_cents === null || row.estimated_hours === null) return []
  const term = termOf(row, currentMonth)
  if (term === null) return []
  const estimate = Math.round(row.estimated_hours * row.hourly_rate_cents)
  const cap = row.not_to_exceed_cents
  const months = eachMonth(term.from, term.to)

  if (row.ends_on !== null) {
    // A bounded term: the estimate is the whole of the work, spread evenly.
    return spreadEvenly(cap === null ? estimate : Math.min(estimate, cap), months, 'tm_estimate')
  }

  // Rolling: the estimate is the expected work each month, and the cap — if
  // there is one — bounds the running total, so the lines stop (with a short
  // last one) where the engagement would.
  if (estimate <= 0) return []
  const lines: DesiredLine[] = []
  let remaining = cap ?? Number.POSITIVE_INFINITY
  for (const periodMonth of months) {
    if (remaining <= 0) break
    const amountCents = Math.min(estimate, remaining)
    lines.push({ periodMonth, kind: 'tm_estimate', amountCents })
    remaining -= amountCents
  }
  return lines
}

/** The rows the engagement's terms call for today. The only `billing_model` branch there is. */
function desiredLines(db: Database.Database, row: EngagementTermsRow, currentMonth: PeriodMonth): DesiredLine[] {
  if (!isSigned(row.status)) return []
  const model = row.billing_model
  if (model === null) return []
  switch (model) {
    case 'retainer':
      return retainerLines(row, currentMonth)
    case 'fixed':
      return milestoneLines(db, row, currentMonth)
    case 'tm':
      return tmLines(row, currentMonth)
    case 'equity':
      return []
    case 'none':
      return []
    default:
      return assertNever(model)
  }
}

// ---------------------------------------------------------------------------
// Reconciling with what is there
// ---------------------------------------------------------------------------

function lineKey(periodMonth: string, kind: string | null, amountCents: number): string {
  return `${periodMonth}|${kind ?? ''}|${amountCents}`
}

/**
 * Regenerates one engagement's projected lines from its terms. Safe to call
 * from inside a transaction (every repository write does) or outside one —
 * `better-sqlite3` nests transactions as savepoints.
 */
export function regenerateRevenueLines(db: Database.Database, engagementId: string, options: GeneratorOptions = {}): void {
  const run = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id, billing_model, status, started_on, ends_on, retainer_basis, monthly_amount_cents, hours_included,
                contract_value_cents, hourly_rate_cents, estimated_hours, not_to_exceed_cents
         FROM engagements WHERE id = ?`
      )
      .get(engagementId) as EngagementTermsRow | undefined
    if (!row) throw new NotFoundError('Engagement', engagementId)

    const currentMonth = localPeriodMonth(options.now ?? new Date())
    const existing = db
      .prepare('SELECT id, period_month, kind, status, amount_cents FROM revenue_lines WHERE engagement_id = ?')
      .all(engagementId) as ExistingLine[]

    // Rows this generator must not write beside stand in for the projection
    // they came from. An invoiced or paid row consumes ONE desired line of
    // its month and kind — the one with its amount if there is one, else
    // any — so a second milestone in the same month keeps its own projected
    // row (the adherence review caught the version that blocked the whole
    // month). A `tm_actual` consumes every estimate of its month: the
    // estimate was for the month, and the month now has a fact.
    const desired = desiredLines(db, row, currentMonth)
    for (const line of existing) {
      if (line.status === 'invoiced' || line.status === 'paid') {
        let index = desired.findIndex(
          (candidate) => candidate.periodMonth === line.period_month && candidate.kind === line.kind && candidate.amountCents === line.amount_cents
        )
        if (index < 0) index = desired.findIndex((candidate) => candidate.periodMonth === line.period_month && candidate.kind === line.kind)
        if (index >= 0) desired.splice(index, 1)
      } else if (line.kind === 'tm_actual') {
        for (let index = desired.length - 1; index >= 0; index -= 1) {
          if (desired[index].periodMonth === line.period_month && desired[index].kind === 'tm_estimate') desired.splice(index, 1)
        }
      }
    }

    // Multiset diff on (month, kind, amount): keep a matching existing row,
    // delete the unmatched ones, insert what is left of `desired`.
    const wanted = new Map<string, number>()
    for (const line of desired) {
      const key = lineKey(line.periodMonth, line.kind, line.amountCents)
      wanted.set(key, (wanted.get(key) ?? 0) + 1)
    }

    const remove = db.prepare('DELETE FROM revenue_lines WHERE id = ?')
    for (const line of existing) {
      const owned = line.status === 'projected' && (GENERATED_KINDS as readonly string[]).includes(line.kind ?? '')
      if (!owned) continue
      const key = lineKey(line.period_month, line.kind, line.amount_cents)
      const count = wanted.get(key) ?? 0
      if (count > 0) {
        wanted.set(key, count - 1)
      } else {
        remove.run(line.id)
      }
    }

    const insert = db.prepare(
      `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'projected', ?, ?)`
    )
    const timestamp = nowTimestamp()
    for (const line of desired) {
      const key = lineKey(line.periodMonth, line.kind, line.amountCents)
      const count = wanted.get(key) ?? 0
      if (count <= 0) continue
      wanted.set(key, count - 1)
      insert.run(randomUUID(), engagementId, line.periodMonth, line.amountCents, line.kind, timestamp, timestamp)
    }
  })
  run()
}

/**
 * Removes every line this module owns for an engagement — `deleteEngagement`'s
 * non-cascade path, which clears the projections derived from the row before
 * its referential guard looks at what is left (invoiced, paid, actual and
 * expense rows, which are facts and block it). Here rather than there so the
 * ownership rule is written once.
 */
export function deleteGeneratedLines(db: Database.Database, engagementId: string): void {
  db.prepare(`DELETE FROM revenue_lines WHERE engagement_id = ? AND ${OWNED_LINES_SQL}`).run(engagementId)
}

/** Every engagement, in one transaction — `npm run seed`'s entry point, and a future "months have passed" pass's. */
export function regenerateAllRevenueLines(db: Database.Database, options: GeneratorOptions = {}): void {
  const run = db.transaction(() => {
    const ids = db.prepare('SELECT id FROM engagements').all() as { id: string }[]
    for (const { id } of ids) regenerateRevenueLines(db, id, options)
  })
  run()
}

/**
 * Records what a T&M month actually came to — the timelog import's (P4-05)
 * and, until it exists, the operator's way of replacing an estimate with a
 * fact. In one transaction: that month's `tm_estimate` rows for the
 * engagement are deleted and one `tm_actual` row is written, so a `SUM`
 * over the month answers the actual and never the estimate plus the actual
 * (ADR-003: "actuals replace estimates; they do not sit beside them").
 * Writing a second actual for the same month replaces the first.
 *
 * `status` is `projected` unless the caller says otherwise: hours worked
 * are recognised, not yet invoiced — invoicing is Stripe's write (§7).
 *
 * A month whose T&M line is already invoiced or paid is refused rather
 * than rewritten: that row is Stripe's record, and neither replacing it
 * nor writing a second, projected actual beside it (which the month's
 * `SUM` would double) is a thing this function may do. No caller reaches
 * this yet — the timelog import (P4-05) is its consumer, and there is
 * deliberately no IPC channel for it until then.
 */
export function writeTmActual(db: Database.Database, input: unknown): void {
  const parsed: WriteTmActualInput = parseInput(writeTmActualInputSchema, input)
  const run = db.transaction(() => {
    const engagement = db.prepare('SELECT id FROM engagements WHERE id = ?').get(parsed.engagementId)
    if (!engagement) throw new NotFoundError('Engagement', parsed.engagementId)
    const settled = db
      .prepare(
        "SELECT COUNT(*) AS count FROM revenue_lines WHERE engagement_id = ? AND period_month = ? AND kind IN ('tm_estimate', 'tm_actual') AND status IN ('invoiced', 'paid')"
      )
      .get(parsed.engagementId, parsed.periodMonth) as { count: number }
    if (settled.count > 0) {
      throw new RefusalError(
        `Cannot record an actual for ${parsed.periodMonth}: that month's T&M line is already invoiced or paid, and that record is not rewritten here.`,
        { reason: 'tm-month-settled', count: settled.count }
      )
    }
    db.prepare(
      "DELETE FROM revenue_lines WHERE engagement_id = ? AND period_month = ? AND kind IN ('tm_estimate', 'tm_actual') AND status = 'projected'"
    ).run(parsed.engagementId, parsed.periodMonth)
    const timestamp = nowTimestamp()
    db.prepare(
      `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tm_actual', ?, ?, ?)`
    ).run(randomUUID(), parsed.engagementId, parsed.periodMonth, parsed.amountCents, parsed.status ?? 'projected', timestamp, timestamp)
  })
  run()
}
