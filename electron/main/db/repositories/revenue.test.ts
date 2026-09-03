import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { seedFixture } from '../seed'
import { fiscalYearStart, revenueSummary } from './revenue'
import { setSetting } from './settings'
import { ValidationError } from './errors'
import { nowTimestamp } from '../../../shared/format'
import { REVENUE_ROLLUPS, revenueSummarySchema, type RevenueSummary } from '../../../shared/revenue'

/**
 * T-260902-04 (P3-06): the rollups over the seeded fixture, pinned to one
 * instant so every month below is a fact. `seedFixture` shifts its dates so
 * that 2026-08-27 (the mockup's today) becomes the reference date, and
 * `revenueSummary` reads "this month" from the same instant.
 */

afterEach(() => {
  closeDatabase()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-revenue-'))
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

const NOW = new Date('2026-09-15T12:00:00Z')
const NOW_ISO = NOW.toISOString()

function seeded(db: Database.Database): RevenueSummary {
  seedFixture(db, { referenceNow: NOW })
  return revenueSummary(db, { now: NOW_ISO })
}

describe('revenueSummary: shape', () => {
  it('validates against the wire schema, carries all three rollups, and reads this month from the pinned instant', () => {
    withDatabase((db) => {
      const summary = seeded(db)
      expect(() => revenueSummarySchema.parse(summary)).not.toThrow()
      expect(summary.currentMonth).toBe('2026-09-01')
      expect(summary.yearStart).toBe('2026-01-01')
      for (const rollup of REVENUE_ROLLUPS) expect(summary.rollups[rollup].length).toBeGreaterThan(0)
    })
  })

  it('refuses a stray key, and takes no input at all as today', () => {
    withDatabase((db) => {
      expect(() => revenueSummary(db, { rollup: 'billing' })).toThrow(ValidationError)
      expect(() => revenueSummary(db, { extra: 1 })).toThrow(ValidationError)
      expect(() => revenueSummary(db, {})).not.toThrow()
    })
  })

  it('an empty database answers lineCount 0, zero metrics, no rows, no series, and a null concentration', () => {
    withDatabase((db) => {
      const summary = revenueSummary(db, { now: NOW_ISO })
      expect(summary.lineCount).toBe(0)
      expect(summary.rollups).toEqual({ billing: [], client: [], model: [] })
      expect(summary.series).toEqual([])
      expect(summary.metrics.concentration).toEqual({ share: null, name: null, payers: [] })
      expect(summary.totals).toEqual({ monthlyCents: 0, backlogCents: 0, ytdCents: 0 })
    })
  })
})

describe('revenueSummary: same totals, different attribution (§6.7)', () => {
  it('each rollup\'s rows sum to the one set of totals, to the cent', () => {
    withDatabase((db) => {
      const summary = seeded(db)
      expect(summary.totals.ytdCents).toBeGreaterThan(0)
      for (const rollup of REVENUE_ROLLUPS) {
        const rows = summary.rollups[rollup]
        expect(rows.reduce((sum, row) => sum + row.monthlyCents, 0), rollup).toBe(summary.totals.monthlyCents)
        expect(rows.reduce((sum, row) => sum + row.backlogCents, 0), rollup).toBe(summary.totals.backlogCents)
        expect(rows.reduce((sum, row) => sum + row.ytdCents, 0), rollup).toBe(summary.totals.ytdCents)
        // Shares sum to one when there is YTD revenue.
        expect(rows.reduce((sum, row) => sum + row.ytdShare, 0), rollup).toBeCloseTo(1, 9)
      }
    })
  })

  it('end clients appear under End client and never as a payer under Billing party (§6.2)', () => {
    withDatabase((db) => {
      const { rollups } = seeded(db)
      // W+K is delivered to but billed through EZDeploy; Programetrix likewise.
      const billingNames = rollups.billing.map((row) => row.name)
      const clientNames = rollups.client.map((row) => row.name)
      expect(billingNames).not.toContain('W+K')
      expect(billingNames).not.toContain('Programetrix')
      expect(clientNames).toContain('W+K')
      expect(clientNames).toContain('Programetrix')
      // The Samay build's money sits under EZDeploy on one rollup and under W+K on the other.
      const ezDeploy = rollups.billing.find((row) => row.name === 'EZDeploy')
      const wPlusK = rollups.client.find((row) => row.name === 'W+K')
      expect(ezDeploy?.backlogCents).toBe(wPlusK?.backlogCents)
    })
  })

  it('the model rollup names each model once, with the model set for the tag and no company', () => {
    withDatabase((db) => {
      const { rollups } = seeded(db)
      const models = rollups.model.map((row) => row.model)
      expect(new Set(models).size).toBe(models.length)
      expect(models).toEqual(expect.arrayContaining(['retainer', 'fixed', 'tm']))
      // Equity and none have no lines, so no row — excluded by absence.
      expect(models).not.toContain('equity')
      expect(models).not.toContain('none')
      for (const row of rollups.model) expect(row.companyId).toBeNull()
      for (const row of rollups.billing) expect(row.model).toBeNull()
    })
  })

  it('a line with no engagement is still in the rollups, under "No company" — the footer is the same money as the tiles', () => {
    withDatabase((db) => {
      seedFixture(db, { referenceNow: NOW })
      const now = nowTimestamp()
      db.prepare(
        `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at)
         VALUES (?, NULL, '2026-09-01', -2500, 'expense', 'projected', ?, ?)`
      ).run(randomUUID(), now, now)
      const summary = revenueSummary(db, { now: NOW_ISO })
      expect(() => revenueSummarySchema.parse(summary)).not.toThrow()
      const orphan = summary.rollups.billing.find((row) => row.key === 'none')
      expect(orphan?.name).toBe('No company')
      expect(orphan?.monthlyCents).toBe(-2500)
      expect(summary.totals.monthlyCents).toBe(summary.rollups.billing.reduce((sum, row) => sum + row.monthlyCents, 0))
    })
  })

  it('a negative line cannot push a share past one, so the response still validates', () => {
    withDatabase((db) => {
      seedFixture(db, { referenceNow: NOW })
      const rinvii = (db.prepare("SELECT id FROM engagements WHERE name LIKE 'Advisory + development%'").get() as { id: string }).id
      const now = nowTimestamp()
      // A large expense against one payer this fiscal year.
      db.prepare(
        `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at)
         VALUES (?, ?, '2026-08-01', -9000000, 'expense', 'projected', ?, ?)`
      ).run(randomUUID(), rinvii, now, now)
      const summary = revenueSummary(db, { now: NOW_ISO })
      expect(() => revenueSummarySchema.parse(summary)).not.toThrow()
      for (const row of summary.rollups.billing) expect(row.ytdShare).toBeLessThanOrEqual(1)
      for (const payer of summary.metrics.concentration.payers) expect(payer.share).toBeLessThanOrEqual(1)
    })
  })
})

describe('revenueSummary: the four metrics', () => {
  it('recurring is this month\'s retainer lines — the two active retainers, $6,500 flat plus 12 x $150', () => {
    withDatabase((db) => {
      const { metrics } = seeded(db)
      expect(metrics.recurringMonthCents).toBe(650_000 + 180_000)
      expect(metrics.recurringEngagements).toBe(2)
      // Both are rolling, so the next twelve months are all generated.
      expect(metrics.recurringNextYearCents).toBe(12 * (650_000 + 180_000))
    })
  })

  it('T&M run rate is this month\'s estimate — the rolling advisory at ~30 hrs x $165', () => {
    withDatabase((db) => {
      expect(seeded(db).metrics.tmMonthCents).toBe(495_000)
    })
  })

  it('fixed backlog is the milestone lines not yet invoiced — Samay\'s two remaining, the delivered scopes having been paid', () => {
    withDatabase((db) => {
      const { metrics } = seeded(db)
      expect(metrics.backlogCents).toBe(2 * 360_000)
      expect(metrics.backlogMilestones).toBe(2)
    })
  })

  it('concentration is the largest billing party\'s share of the year to date — the billing rollup\'s own first row', () => {
    withDatabase((db) => {
      const summary = seeded(db)
      const { concentration } = summary.metrics
      expect(concentration.share).not.toBeNull()
      expect(concentration.share as number).toBeGreaterThan(0)
      expect(concentration.share as number).toBeLessThanOrEqual(1)
      expect(concentration.name).toBe(summary.rollups.billing[0].name)
      expect(concentration.share).toBe(summary.rollups.billing[0].ytdShare)
      expect(concentration.payers.reduce((sum, payer) => sum + payer.share, 0)).toBeCloseTo(1, 9)
      // Only payers with revenue this year make the bar.
      for (const payer of concentration.payers) expect(payer.cents).toBeGreaterThan(0)
    })
  })

  it('reads the fiscal year start from settings', () => {
    withDatabase((db) => {
      seedFixture(db, { referenceNow: NOW })
      const calendar = revenueSummary(db, { now: NOW_ISO })
      setSetting(db, 'workspace.fiscalYearStartMonth', 7)
      const july = revenueSummary(db, { now: NOW_ISO })
      expect(july.yearStart).toBe('2026-07-01')
      expect(july.totals.ytdCents).toBeLessThan(calendar.totals.ytdCents)
      setSetting(db, 'workspace.fiscalYearStartMonth', 10)
      expect(revenueSummary(db, { now: NOW_ISO }).yearStart).toBe('2025-10-01')
    })
  })

  it('"this month" is the operator\'s local calendar month, not the UTC one', () => {
    withDatabase((db) => {
      seedFixture(db, { referenceNow: NOW })
      // 23:30 local on 30 September, whatever the zone: the local month is
      // September even where UTC has already reached October (or, east of
      // UTC, where UTC is still the 30th but the local clock says the 1st —
      // either way the local reading is the one the page must use).
      const lateLocal = new Date(2026, 8, 30, 23, 30)
      expect(revenueSummary(db, { now: lateLocal.toISOString() }).currentMonth).toBe('2026-09-01')
    })
  })
})

describe('fiscalYearStart', () => {
  it('is the most recent first-of-fiscal-year at or before the month', () => {
    expect(fiscalYearStart('2026-09-01', 1)).toBe('2026-01-01')
    expect(fiscalYearStart('2026-09-01', 9)).toBe('2026-09-01')
    expect(fiscalYearStart('2026-09-01', 10)).toBe('2025-10-01')
    expect(fiscalYearStart('2026-01-01', 4)).toBe('2025-04-01')
  })
})

describe('revenueSummary: the series', () => {
  it('is the canonical GROUP BY period_month, kind, status over a twelve-month window around this month, paid months as actual', () => {
    withDatabase((db) => {
      const summary = seeded(db)
      expect(summary.window).toEqual({ from: '2026-06-01', to: '2027-05-01' })
      for (const point of summary.series) {
        expect(point.periodMonth >= summary.window.from && point.periodMonth <= summary.window.to).toBe(true)
        // The seed marks every past month paid: before September everything is actual, from September on everything is projected.
        expect(point.status).toBe(point.periodMonth < '2026-09-01' ? 'actual' : 'projected')
      }
      const september = summary.series.filter((point) => point.periodMonth === '2026-09-01')
      const byKind = Object.fromEntries(september.map((point) => [point.kind, point.cents]))
      expect(byKind.retainer).toBe(830_000)
      expect(byKind.tm).toBe(495_000)
      expect(byKind.milestone).toBe(360_000)
    })
  })

  it('leaves a row it cannot place out of the chart — an expense, an unknown kind, a month that is not a first-of-month — without failing', () => {
    withDatabase((db) => {
      seedFixture(db, { referenceNow: NOW })
      const rinvii = (db.prepare("SELECT id FROM engagements WHERE name LIKE 'Advisory + development%'").get() as { id: string }).id
      const now = nowTimestamp()
      const insert = db.prepare(
        `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'projected', ?, ?)`
      )
      insert.run(randomUUID(), rinvii, '2026-09-01', -100, 'expense', now, now)
      insert.run(randomUUID(), rinvii, '2026-09-01', 100, 'mystery', now, now)
      insert.run(randomUUID(), rinvii, '2026-09-15', 100, 'retainer', now, now)
      const summary = revenueSummary(db, { now: NOW_ISO })
      expect(() => revenueSummarySchema.parse(summary)).not.toThrow()
      const september = summary.series.filter((point) => point.periodMonth === '2026-09-01')
      expect(Object.fromEntries(september.map((point) => [point.kind, point.cents])).retainer).toBe(830_000)
      // ...but the tiles and totals are net of all three: they are the table's SUM, with no kind filter.
      expect(summary.totals.monthlyCents).toBe(830_000 + 495_000 + 360_000 - 100 + 100)
    })
  })
})

describe('revenueSummary: §8 performance', () => {
  it('the summary over ten copies of the fixture completes under 100ms', () => {
    withDatabase((db) => {
      seedFixture(db, { referenceNow: NOW })
      for (let i = 0; i < 9; i += 1) seedFixture(db, { referenceNow: NOW, force: true })
      const count = (db.prepare('SELECT COUNT(*) AS c FROM revenue_lines').get() as { c: number }).c
      expect(count).toBeGreaterThan(500)

      // Warm once (statement compilation), then time three calls.
      revenueSummary(db, { now: NOW_ISO })
      const started = performance.now()
      for (let i = 0; i < 3; i += 1) revenueSummary(db, { now: NOW_ISO })
      const elapsed = (performance.now() - started) / 3
      expect(elapsed).toBeLessThan(100)
    })
  })
})
