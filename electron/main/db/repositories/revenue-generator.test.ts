import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { createCompany } from './companies'
import { createEngagement, updateEngagement } from './engagements'
import { completeMilestone, createMilestone, deleteMilestone, updateMilestone } from './milestones'
import { ROLLING_HORIZON_MONTHS, regenerateRevenueLines, writeTmActual } from './revenue-generator'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import { nowTimestamp, startOfMonth } from '../../../shared/format'
import type { BillingModel, EngagementStatus, RetainerBasis } from '../../../shared/engagements'

/**
 * T-260902-03 (P3-05): the generator, against a real database. Every
 * ADR-003 branch reads its rows back; the three rules — idempotent,
 * non-destructive, actuals replace estimates — are asserted on the raw
 * table, ids and timestamps included.
 *
 * `NOW` is pinned so "the current month" and the rolling horizon are facts
 * here. The repository hooks (`createEngagement` etc.) read the real clock,
 * so the tests that go through them compare against `startOfMonth(new
 * Date())` instead.
 */

afterEach(() => {
  closeDatabase()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-revenue-gen-'))
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** 2026-09-15: the current month is September, the rolling horizon ends August 2027. */
const NOW = new Date('2026-09-15T12:00:00Z')
const OPTS = { now: NOW }

interface Line {
  readonly id: string
  readonly period_month: string
  readonly amount_cents: number
  readonly kind: string | null
  readonly status: string | null
  readonly created_at: string
  readonly updated_at: string
}

function lines(db: Database.Database, engagementId: string): Line[] {
  return db
    .prepare(
      'SELECT id, period_month, amount_cents, kind, status, created_at, updated_at FROM revenue_lines WHERE engagement_id = ? ORDER BY period_month, kind, amount_cents, id'
    )
    .all(engagementId) as Line[]
}

function shape(rows: readonly Line[]): Array<[string, string | null, number]> {
  return rows.map((row) => [row.period_month, row.kind, row.amount_cents])
}

function sumFor(db: Database.Database, engagementId: string, month: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM revenue_lines WHERE engagement_id = ? AND period_month = ?')
    .get(engagementId, month) as { total: number }
  return row.total
}

/** Every column the generator reads, loosely typed on purpose: a test writes whatever combination it means to, the schema's union be damned. */
interface RawEngagement {
  readonly name?: string
  readonly billingModel: BillingModel
  readonly status?: EngagementStatus
  readonly startedOn: string
  readonly endsOn?: string | null
  readonly retainerBasis?: RetainerBasis | null
  readonly monthlyAmountCents?: number | null
  readonly hoursIncluded?: number | null
  readonly contractValueCents?: number | null
  readonly hourlyRateCents?: number | null
  readonly estimatedHours?: number | null
  readonly notToExceedCents?: number | null
}

/** An engagement written straight to the table, so the generator is exercised alone rather than through the repository hooks. */
function rawEngagement(db: Database.Database, input: RawEngagement): string {
  const id = randomUUID()
  const now = nowTimestamp()
  const record = input as unknown as Record<string, unknown>
  db.prepare(
    `INSERT INTO engagements (id, name, billing_model, status, started_on, ends_on, retainer_basis, monthly_amount_cents, hours_included,
                              contract_value_cents, hourly_rate_cents, estimated_hours, not_to_exceed_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name ?? 'Engagement',
    input.billingModel,
    input.status ?? 'active',
    input.startedOn,
    input.endsOn ?? null,
    record.retainerBasis ?? null,
    record.monthlyAmountCents ?? null,
    record.hoursIncluded ?? null,
    record.contractValueCents ?? null,
    record.hourlyRateCents ?? null,
    record.estimatedHours ?? null,
    record.notToExceedCents ?? null,
    now,
    now
  )
  return id
}

function rawMilestone(db: Database.Database, engagementId: string, amountCents: number | null, expectedMonth: string | null): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO milestones (id, engagement_id, name, sort, amount_cents, expected_month, created_at, updated_at) VALUES (?, ?, 'M', 0, ?, ?, ?, ?)`
  ).run(randomUUID(), engagementId, amountCents, expectedMonth, now, now)
}

// ---------------------------------------------------------------------------
// The branches
// ---------------------------------------------------------------------------

describe('retainer', () => {
  it('a flat monthly fee: one row per month of a bounded term, inclusive of both ends', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, {
        billingModel: 'retainer',
        retainerBasis: 'amount',
        monthlyAmountCents: 100_000,
        startedOn: '2026-01-15',
        endsOn: '2026-04-10'
      })
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-01-01', 'retainer', 100_000],
        ['2026-02-01', 'retainer', 100_000],
        ['2026-03-01', 'retainer', 100_000],
        ['2026-04-01', 'retainer', 100_000]
      ])
      expect(lines(db, id).every((line) => line.status === 'projected')).toBe(true)
    })
  })

  it('an hours basis prices each month at hours x rate', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, {
        billingModel: 'retainer',
        retainerBasis: 'hours',
        hoursIncluded: 12,
        hourlyRateCents: 15_000,
        startedOn: '2026-09-01',
        endsOn: '2026-10-31'
      })
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-09-01', 'retainer', 180_000],
        ['2026-10-01', 'retainer', 180_000]
      ])
    })
  })

  it('rolling (ends_on NULL): from its start to the stated horizon — twelve months counting the current one — and no further', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, {
        billingModel: 'retainer',
        retainerBasis: 'amount',
        monthlyAmountCents: 650_000,
        startedOn: '2026-07-01',
        endsOn: null
      })
      regenerateRevenueLines(db, id, OPTS)
      const months = lines(db, id).map((line) => line.period_month)
      expect(ROLLING_HORIZON_MONTHS).toBe(12)
      expect(months[0]).toBe('2026-07-01')
      expect(months[months.length - 1]).toBe('2027-08-01')
      expect(months).toHaveLength(14)
    })
  })

  it('a retainer with no basis, or a basis with no numbers, generates nothing — a price nobody entered is not forecast', () => {
    withDatabase((db) => {
      const unpriced = rawEngagement(db, { billingModel: 'retainer', startedOn: '2026-01-01', retainerBasis: null })
      const halfPriced = rawEngagement(db, { billingModel: 'retainer', startedOn: '2026-01-01', retainerBasis: 'hours', hoursIncluded: 10 })
      regenerateRevenueLines(db, unpriced, OPTS)
      regenerateRevenueLines(db, halfPriced, OPTS)
      expect(lines(db, unpriced)).toEqual([])
      expect(lines(db, halfPriced)).toEqual([])
    })
  })
})

describe('fixed', () => {
  it('one milestone row per milestone at its expected month, for its amount — two in one month stay two rows', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'fixed', contractValueCents: 1_800_000, startedOn: '2026-02-10', endsOn: '2026-10-15' })
      rawMilestone(db, id, 600_000, '2026-03-01')
      rawMilestone(db, id, 600_000, '2026-03-01')
      rawMilestone(db, id, 600_000, '2026-08-01')
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-03-01', 'milestone', 600_000],
        ['2026-03-01', 'milestone', 600_000],
        ['2026-08-01', 'milestone', 600_000]
      ])
    })
  })

  it('a milestone with no amount or no month generates nothing, and the contract value is never used in its place', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'fixed', contractValueCents: 1_800_000, startedOn: '2026-02-10', endsOn: '2026-10-15' })
      rawMilestone(db, id, null, '2026-03-01')
      rawMilestone(db, id, 600_000, null)
      regenerateRevenueLines(db, id, OPTS)
      expect(lines(db, id)).toEqual([])
    })
  })
})

describe('tm', () => {
  it('a bounded term spreads the estimate evenly, odd cents on the last month, summing to the estimate exactly', () => {
    withDatabase((db) => {
      // 10 hrs x $333.33 = $3,333.30 over four months: 833.32 x 3 + 833.34.
      const id = rawEngagement(db, {
        billingModel: 'tm',
        hourlyRateCents: 33_333,
        estimatedHours: 10,
        startedOn: '2026-01-01',
        endsOn: '2026-04-30'
      })
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-01-01', 'tm_estimate', 83_332],
        ['2026-02-01', 'tm_estimate', 83_332],
        ['2026-03-01', 'tm_estimate', 83_332],
        ['2026-04-01', 'tm_estimate', 83_334]
      ])
    })
  })

  it('a bounded term is capped by not-to-exceed before it is spread', () => {
    withDatabase((db) => {
      // 30 x $165 = $4,950, capped at $4,000 over three months.
      const id = rawEngagement(db, {
        billingModel: 'tm',
        hourlyRateCents: 16_500,
        estimatedHours: 30,
        notToExceedCents: 400_000,
        startedOn: '2026-01-01',
        endsOn: '2026-03-31'
      })
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-01-01', 'tm_estimate', 133_333],
        ['2026-02-01', 'tm_estimate', 133_333],
        ['2026-03-01', 'tm_estimate', 133_334]
      ])
    })
  })

  it('a rolling term reads the estimate as each month\'s expected work, and a cap stops the lines where the engagement would', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, {
        billingModel: 'tm',
        hourlyRateCents: 16_500,
        estimatedHours: 30,
        notToExceedCents: 500_000,
        startedOn: '2026-09-01',
        endsOn: null
      })
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-09-01', 'tm_estimate', 495_000],
        ['2026-10-01', 'tm_estimate', 5_000]
      ])

      const uncapped = rawEngagement(db, { billingModel: 'tm', hourlyRateCents: 16_500, estimatedHours: 30, startedOn: '2026-09-01', endsOn: null })
      regenerateRevenueLines(db, uncapped, OPTS)
      expect(lines(db, uncapped)).toHaveLength(ROLLING_HORIZON_MONTHS)
      expect(lines(db, uncapped).every((line) => line.amount_cents === 495_000)).toBe(true)
    })
  })

  it('no rate or no estimate generates nothing', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'tm', hourlyRateCents: 16_500, startedOn: '2026-09-01', endsOn: null })
      regenerateRevenueLines(db, id, OPTS)
      expect(lines(db, id)).toEqual([])
    })
  })
})

describe('equity and none', () => {
  it('generate no rows at all — excluded by absence, not by a filter', () => {
    withDatabase((db) => {
      const equity = rawEngagement(db, { billingModel: 'equity', startedOn: '2026-01-01', endsOn: null })
      const none = rawEngagement(db, { billingModel: 'none', startedOn: '2026-01-01', endsOn: '2027-06-30' })
      regenerateRevenueLines(db, equity, OPTS)
      regenerateRevenueLines(db, none, OPTS)
      expect(db.prepare('SELECT COUNT(*) AS c FROM revenue_lines').get()).toEqual({ c: 0 })
    })
  })
})

describe('status', () => {
  it('proposed, lost and held generate nothing; active, pending and delivered do', () => {
    withDatabase((db) => {
      const terms = { billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 100_000, startedOn: '2026-01-01', endsOn: '2026-03-31' } as const
      const byStatus = {
        proposed: rawEngagement(db, { ...terms, status: 'proposed' }),
        lost: rawEngagement(db, { ...terms, status: 'lost' }),
        held: rawEngagement(db, { ...terms, status: 'held' }),
        active: rawEngagement(db, { ...terms, status: 'active' }),
        pending: rawEngagement(db, { ...terms, status: 'pending' }),
        delivered: rawEngagement(db, { ...terms, status: 'delivered' })
      }
      for (const id of Object.values(byStatus)) regenerateRevenueLines(db, id, OPTS)
      expect(lines(db, byStatus.proposed)).toEqual([])
      expect(lines(db, byStatus.lost)).toEqual([])
      expect(lines(db, byStatus.held)).toEqual([])
      expect(lines(db, byStatus.active)).toHaveLength(3)
      expect(lines(db, byStatus.pending)).toHaveLength(3)
      expect(lines(db, byStatus.delivered)).toHaveLength(3)
    })
  })

  it('a delivered engagement with no ends_on stops at the current month rather than running to the horizon', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, {
        billingModel: 'retainer',
        retainerBasis: 'amount',
        monthlyAmountCents: 100_000,
        status: 'delivered',
        startedOn: '2026-07-01',
        endsOn: null
      })
      regenerateRevenueLines(db, id, OPTS)
      expect(lines(db, id).map((line) => line.period_month)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    })
  })
})

// ---------------------------------------------------------------------------
// The three rules
// ---------------------------------------------------------------------------

describe('idempotent', () => {
  it('running the generator twice changes no row — same ids, same timestamps', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 100_000, startedOn: '2026-01-01', endsOn: null })
      regenerateRevenueLines(db, id, OPTS)
      const first = lines(db, id)
      expect(first.length).toBeGreaterThan(0)
      regenerateRevenueLines(db, id, OPTS)
      expect(lines(db, id)).toEqual(first)
    })
  })

  it('a change of terms rewrites only the rows that changed, keeping the ones that still match', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 100_000, startedOn: '2026-01-01', endsOn: '2026-03-31' })
      regenerateRevenueLines(db, id, OPTS)
      const before = lines(db, id)
      db.prepare("UPDATE engagements SET ends_on = '2026-04-30' WHERE id = ?").run(id)
      regenerateRevenueLines(db, id, OPTS)
      const after = lines(db, id)
      expect(after).toHaveLength(4)
      expect(after.slice(0, 3)).toEqual(before)
    })
  })
})

describe('non-destructive', () => {
  it('a row set to invoiced survives an edit that changes the rate, and no projected row is written beside it for that month', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 100_000, startedOn: '2026-01-01', endsOn: '2026-03-31' })
      regenerateRevenueLines(db, id, OPTS)
      const january = lines(db, id)[0]
      db.prepare("UPDATE revenue_lines SET status = 'invoiced', invoiced_at = ?, stripe_invoice_id = 'in_123' WHERE id = ?").run(nowTimestamp(), january.id)

      db.prepare('UPDATE engagements SET monthly_amount_cents = 250000 WHERE id = ?').run(id)
      regenerateRevenueLines(db, id, OPTS)

      const after = lines(db, id)
      expect(after).toHaveLength(3)
      expect(after[0]).toMatchObject({ id: january.id, amount_cents: 100_000, status: 'invoiced' })
      expect(shape(after.slice(1))).toEqual([
        ['2026-02-01', 'retainer', 250_000],
        ['2026-03-01', 'retainer', 250_000]
      ])
      const stripe = db.prepare('SELECT stripe_invoice_id FROM revenue_lines WHERE id = ?').get(january.id) as { stripe_invoice_id: string }
      expect(stripe.stripe_invoice_id).toBe('in_123')
    })
  })

  it('invoicing one of two milestones in a month leaves the other\'s projected row alone — an invoice stands in for one projection, not the month', () => {
    // The adherence review's case: the fixture's audit has two milestones in
    // each of its months. The first version of the generator blocked the
    // whole (month, kind) once anything in it was invoiced, and deleted the
    // second milestone's projection as "unwanted" on the next regeneration.
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'fixed', contractValueCents: 210_000, startedOn: '2026-04-01', endsOn: '2026-05-31' })
      rawMilestone(db, id, 105_000, '2026-04-01')
      rawMilestone(db, id, 105_000, '2026-04-01')
      regenerateRevenueLines(db, id, OPTS)
      const [first] = lines(db, id)
      db.prepare("UPDATE revenue_lines SET status = 'invoiced' WHERE id = ?").run(first.id)

      regenerateRevenueLines(db, id, OPTS)
      const after = lines(db, id)
      expect(after).toHaveLength(2)
      expect(after.map((line) => line.status).sort()).toEqual(['invoiced', 'projected'])
      expect(sumFor(db, id, '2026-04-01')).toBe(210_000)

      // And the invoice stands in for a projection even when the milestone
      // it came from was since re-priced: one invoiced row, one projected
      // row at the new amount, never three.
      db.prepare("UPDATE milestones SET amount_cents = 120000 WHERE engagement_id = ?").run(id)
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id)).sort()).toEqual([
        ['2026-04-01', 'milestone', 105_000],
        ['2026-04-01', 'milestone', 120_000]
      ])
    })
  })

  it('a projected row of an in-progress month IS rewritten — the estimate-replacement case is not restricted to future months', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 100_000, startedOn: '2026-09-01', endsOn: '2026-09-30' })
      regenerateRevenueLines(db, id, OPTS)
      db.prepare('UPDATE engagements SET monthly_amount_cents = 120000 WHERE id = ?').run(id)
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([['2026-09-01', 'retainer', 120_000]])
    })
  })

  it('expense rows are never touched', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 100_000, startedOn: '2026-01-01', endsOn: '2026-01-31' })
      const now = nowTimestamp()
      db.prepare(
        `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at)
         VALUES ('exp', ?, '2026-01-01', -2500, 'expense', 'projected', ?, ?)`
      ).run(id, now, now)
      regenerateRevenueLines(db, id, OPTS)
      regenerateRevenueLines(db, id, OPTS)
      expect(shape(lines(db, id))).toEqual([
        ['2026-01-01', 'expense', -2_500],
        ['2026-01-01', 'retainer', 100_000]
      ])
      // And the canonical SUM nets it, with no kind filter.
      expect(sumFor(db, id, '2026-01-01')).toBe(97_500)
    })
  })
})

describe('actuals replace estimates', () => {
  it('writing tm_actual for a month deletes that month\'s tm_estimate in one transaction; a SUM over the month returns the actual', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'tm', hourlyRateCents: 16_500, estimatedHours: 30, startedOn: '2026-09-01', endsOn: null })
      regenerateRevenueLines(db, id, OPTS)
      expect(sumFor(db, id, '2026-09-01')).toBe(495_000)

      writeTmActual(db, { engagementId: id, periodMonth: '2026-09-01', amountCents: 805_000 })

      expect(sumFor(db, id, '2026-09-01')).toBe(805_000)
      expect(lines(db, id).filter((line) => line.period_month === '2026-09-01').map((line) => line.kind)).toEqual(['tm_actual'])
      // October is untouched.
      expect(sumFor(db, id, '2026-10-01')).toBe(495_000)
    })
  })

  it('regeneration keeps the actual and writes no estimate back into its month; a second actual replaces the first', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'tm', hourlyRateCents: 16_500, estimatedHours: 30, startedOn: '2026-09-01', endsOn: null })
      regenerateRevenueLines(db, id, OPTS)
      writeTmActual(db, { engagementId: id, periodMonth: '2026-09-01', amountCents: 805_000 })
      regenerateRevenueLines(db, id, OPTS)
      expect(sumFor(db, id, '2026-09-01')).toBe(805_000)

      writeTmActual(db, { engagementId: id, periodMonth: '2026-09-01', amountCents: 810_000, status: 'invoiced' })
      const september = lines(db, id).filter((line) => line.period_month === '2026-09-01')
      expect(september).toHaveLength(1)
      expect(september[0]).toMatchObject({ kind: 'tm_actual', amount_cents: 810_000, status: 'invoiced' })
    })
  })

  it('refuses a month whose T&M line is already invoiced or paid — that row is Stripe\'s and is neither replaced nor doubled', () => {
    withDatabase((db) => {
      const id = rawEngagement(db, { billingModel: 'tm', hourlyRateCents: 16_500, estimatedHours: 30, startedOn: '2026-09-01', endsOn: null })
      regenerateRevenueLines(db, id, OPTS)
      const [september] = lines(db, id)
      db.prepare("UPDATE revenue_lines SET status = 'invoiced', stripe_invoice_id = 'in_9' WHERE id = ?").run(september.id)

      expect(() => writeTmActual(db, { engagementId: id, periodMonth: '2026-09-01', amountCents: 1 })).toThrow(RefusalError)
      const after = lines(db, id).filter((line) => line.period_month === '2026-09-01')
      expect(after).toHaveLength(1)
      expect(after[0]).toMatchObject({ id: september.id, status: 'invoiced' })
    })
  })

  it('validates its input and refuses an engagement that does not exist', () => {
    withDatabase((db) => {
      expect(() => writeTmActual(db, { engagementId: 'nope', periodMonth: '2026-09-01', amountCents: 1 })).toThrow(NotFoundError)
      const id = rawEngagement(db, { billingModel: 'tm', startedOn: '2026-09-01' })
      expect(() => writeTmActual(db, { engagementId: id, periodMonth: '2026-09-15', amountCents: 1 })).toThrow(ValidationError)
      expect(() => writeTmActual(db, { engagementId: id, periodMonth: '2026-09-01', amountCents: 1.5 })).toThrow(ValidationError)
    })
  })
})

// ---------------------------------------------------------------------------
// Runs inside the repository writes
// ---------------------------------------------------------------------------

describe('through the repositories', () => {
  const thisMonth = startOfMonth(new Date())

  it('createEngagement writes the lines its terms imply, in the same call', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Acme' })
      const engagement = createEngagement(db, {
        name: 'Retainer',
        billingCompanyId: company.id,
        billingModel: 'retainer',
        status: 'active',
        retainerBasis: 'amount',
        monthlyAmountCents: 100_000,
        startedOn: `${thisMonth.slice(0, 7)}-15`,
        endsOn: null
      })
      expect(lines(db, engagement.id)).toHaveLength(ROLLING_HORIZON_MONTHS)
      expect(lines(db, engagement.id)[0].period_month).toBe(thisMonth)
    })
  })

  it('updateEngagement regenerates — signing a proposal (proposed -> active) is what puts it in the forecast', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, {
        name: 'Proposal',
        billingModel: 'retainer',
        status: 'proposed',
        retainerBasis: 'amount',
        monthlyAmountCents: 100_000,
        startedOn: '2026-01-01',
        endsOn: '2026-02-28'
      })
      expect(lines(db, engagement.id)).toEqual([])
      updateEngagement(db, engagement.id, { status: 'active' })
      expect(lines(db, engagement.id)).toHaveLength(2)
      updateEngagement(db, engagement.id, { status: 'lost' })
      expect(lines(db, engagement.id)).toEqual([])
    })
  })

  it('every milestone write regenerates the fixed scope: create adds a row, update moves it, complete leaves it, delete removes it', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, {
        name: 'Build',
        billingModel: 'fixed',
        status: 'active',
        contractValueCents: 1_000_000,
        startedOn: '2026-01-01',
        endsOn: '2026-06-30'
      })
      expect(lines(db, engagement.id)).toEqual([])

      const milestone = createMilestone(db, { engagementId: engagement.id, name: 'Kickoff', amountCents: 400_000, expectedMonth: '2026-02-01' })
      expect(shape(lines(db, engagement.id))).toEqual([['2026-02-01', 'milestone', 400_000]])

      updateMilestone(db, milestone.id, { expectedMonth: '2026-03-01' })
      expect(shape(lines(db, engagement.id))).toEqual([['2026-03-01', 'milestone', 400_000]])

      const before = lines(db, engagement.id)
      completeMilestone(db, milestone.id)
      expect(lines(db, engagement.id)).toEqual(before)

      deleteMilestone(db, milestone.id)
      expect(lines(db, engagement.id)).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// The branch lives here and nowhere else
// ---------------------------------------------------------------------------

describe('billing_model is branched on in the generator only', () => {
  const repositories = join(__dirname)

  /** Comments stripped first (LESSONS.md 3): the files talk about `billing_model` a great deal. */
  function code(file: string): string {
    return readFileSync(join(repositories, file), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('among the revenue modules, only the generator switches on the model; the rollups name it as a GROUP BY key and never in a CASE', () => {
    const revenueFiles = readdirSync(repositories).filter((file) => /^revenue.*\.ts$/.test(file) && !file.endsWith('.test.ts'))
    expect(revenueFiles.sort()).toEqual(['revenue-generator.ts', 'revenue.ts'])

    const generator = code('revenue-generator.ts')
    expect(generator).toMatch(/switch \(model\)/)

    const rollups = code('revenue.ts')
    const mentions = rollups.split('\n').filter((line) => line.includes('billing_model'))
    expect(mentions.length).toBeGreaterThan(0)
    for (const line of mentions) {
      expect(line, line).not.toMatch(/CASE|WHEN|===|!==|==/)
    }
    expect(rollups).not.toMatch(/case\s+'(retainer|fixed|tm|equity|none)'/)
  })
})
