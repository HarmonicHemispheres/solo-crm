import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { DecayMeter } from '../components/primitives/DecayMeter'
import { SETTINGS_KEYS, SETTINGS_REGISTRY, type SettingsSnapshot } from '../../shared/settings'
import { decayForCompany, type DecayInput } from './decay'

/**
 * The snapshot is built from `SETTINGS_REGISTRY`'s own declared defaults
 * rather than hand-written here, so the cadence numbers these tests assert
 * are the ones the app actually ships — a default changed in the registry
 * and not here would otherwise pass against a fixture nothing uses.
 */
const DEFAULT_SETTINGS = Object.fromEntries(
  SETTINGS_KEYS.map((key) => [key, SETTINGS_REGISTRY[key].default])
) as SettingsSnapshot

const DAY_MS = 24 * 60 * 60 * 1000

/** A fixed clock. Nothing in these tests reads the wall clock. */
const NOW = new Date('2026-08-30T12:00:00.000Z')

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

function company(overrides: Partial<DecayInput> = {}): DecayInput {
  return { kind: 'client', cadenceDays: 7, lastTouchAt: daysBefore(NOW, 1), createdAt: daysBefore(NOW, 400), ...overrides }
}

describe('decayForCompany', () => {
  it('reads eight days as late for a client and fine for a channel, from the same function and the same clock', () => {
    // P2-03's own criterion, verbatim: "a retainer client at eight days reads
    // late and a channel at eight days reads fine, from the same function."
    // This is the whole reason the module exists — the threshold is the
    // relationship's, never a global one.
    const eightDaysAgo = daysBefore(NOW, 8)

    const client = decayForCompany(company({ kind: 'client', cadenceDays: 7, lastTouchAt: eightDaysAgo }), DEFAULT_SETTINGS, NOW)
    const channel = decayForCompany(company({ kind: 'channel', cadenceDays: 30, lastTouchAt: eightDaysAgo }), DEFAULT_SETTINGS, NOW)

    expect(client.band).toBe('late')
    expect(channel.band).toBe('ok')
    expect(client.days).toBe(8)
    expect(channel.days).toBe(8)
    expect(client.label).toBe('8d')
  })

  it('falls back to the kind default when the company has no cadence of its own', () => {
    // `cadenceDays` is nullable on the row even though the create sheet always
    // writes one today (companies.ts), so this path is reachable from the seed
    // and from a hand-edited database.
    const decay = decayForCompany(
      company({ kind: 'advisory', cadenceDays: null, lastTouchAt: daysBefore(NOW, 21) }),
      DEFAULT_SETTINGS,
      NOW
    )

    // 21 is `cadence.defaultDays.advisory`'s declared default.
    expect(decay.cadenceDays).toBe(21)
    expect(decay.pct).toBe(1)
    expect(decay.band).toBe('late')
  })

  it('uses the company own cadence and ignores the kind default when one is set', () => {
    const decay = decayForCompany(
      company({ kind: 'advisory', cadenceDays: 5, lastTouchAt: daysBefore(NOW, 21) }),
      DEFAULT_SETTINGS,
      NOW
    )

    expect(decay.cadenceDays).toBe(5)
    expect(decay.band).toBe('late')
  })

  it('reads the kind default out of the snapshot it is handed, not a constant of its own', () => {
    // The fallback has to track whatever Workspace Settings last wrote, or
    // "new companies inherit" (P2-02) inherits a number nobody chose.
    const settings: SettingsSnapshot = { ...DEFAULT_SETTINGS, 'cadence.defaultDays.advisory': 60 }
    const untouchedFor21Days = company({ kind: 'advisory', cadenceDays: null, lastTouchAt: daysBefore(NOW, 21) })

    expect(decayForCompany(untouchedFor21Days, settings, NOW).cadenceDays).toBe(60)
    expect(decayForCompany(untouchedFor21Days, settings, NOW).band).toBe('ok')
    expect(decayForCompany(untouchedFor21Days, DEFAULT_SETTINGS, NOW).band).toBe('late')
  })

  it('measures an untouched company from when it was added, not from the beginning of time', () => {
    // The reported defect: every company starts with no touch, so every new
    // company greeted its author with a full red bar labelled "never". An
    // untouched company's wait is the time since it was added — 400 days
    // against a 7-day cadence here, which is still emphatically late.
    const decay = decayForCompany(company({ lastTouchAt: null }), DEFAULT_SETTINGS, NOW)

    expect(decay.days).toBe(400)
    expect(decay.touched).toBe(false)
    expect(Number.isNaN(decay.pct)).toBe(false)
    expect(decay.band).toBe('late')
    expect(decay.label).toBe('400d')
    expect(decay.cadenceDays).toBe(7)
  })

  it('reads a company added today with nothing logged as on track, labelled "new"', () => {
    // The other half of the same defect, and the half an operator meets
    // first: a company created moments ago is not overdue, and saying so in
    // red is the software failing to tell neglect from newness.
    const decay = decayForCompany(company({ lastTouchAt: null, createdAt: daysBefore(NOW, 0) }), DEFAULT_SETTINGS, NOW)

    expect(decay.days).toBe(0)
    expect(decay.touched).toBe(false)
    expect(decay.band).toBe('ok')
    expect(decay.label).toBe('new')
    expect(decay.description).toContain('nothing logged yet')
  })

  it('keeps a touch as the clock whenever there is one, whatever created_at says', () => {
    // created_at is the fallback, never a competitor: a company added a year
    // ago and touched yesterday is one day into its cadence.
    const decay = decayForCompany(company({ lastTouchAt: daysBefore(NOW, 1), createdAt: daysBefore(NOW, 365) }), DEFAULT_SETTINGS, NOW)

    expect(decay.days).toBe(1)
    expect(decay.touched).toBe(true)
    expect(decay.band).toBe('ok')
  })

  it('counts elapsed instants, not calendar dates — an hour across midnight is still today', () => {
    // `last_touch_at` is a full UTC instant (CONVENTIONS.md), so this is
    // instant arithmetic, not the local-calendar-day arithmetic Todos.tsx
    // correctly uses for the date-only `due_on`. The calendar date changed
    // between these two moments and one hour is still not one day.
    const decay = decayForCompany(
      company({ lastTouchAt: '2026-08-29T23:30:00.000Z' }),
      DEFAULT_SETTINGS,
      new Date('2026-08-30T00:30:00.000Z')
    )

    expect(decay.days).toBe(0)
    expect(decay.label).toBe('today')
    expect(decay.band).toBe('ok')
  })

  it('floors to whole days — 23h59m is zero days and 24h is one', () => {
    const touched = '2026-08-29T00:00:00.000Z'
    const justUnder = decayForCompany(company({ lastTouchAt: touched }), DEFAULT_SETTINGS, new Date('2026-08-29T23:59:00.000Z'))
    const exactlyOne = decayForCompany(company({ lastTouchAt: touched }), DEFAULT_SETTINGS, new Date('2026-08-30T00:00:00.000Z'))

    expect(justUnder.days).toBe(0)
    expect(justUnder.label).toBe('today')
    expect(exactlyOne.days).toBe(1)
    expect(exactlyOne.label).toBe('1d')
  })

  it('reads a zero cadence as late rather than dividing by it', () => {
    // `cadence_days` is a plain nullable integer on the column; only the input
    // schema constrains it to positive, so a 0 can exist in a hand-edited file.
    const decay = decayForCompany(company({ cadenceDays: 0, lastTouchAt: daysBefore(NOW, 3) }), DEFAULT_SETTINGS, NOW)

    expect(decay.pct).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isNaN(decay.pct)).toBe(false)
    expect(decay.band).toBe('late')
    expect(decay.days).toBe(3)
  })

  it('reads a company with neither a cadence nor a kind to inherit one as late', () => {
    // `kind` is nullable too, so there is a company shape with no cadence
    // available at all. It is unknown, not healthy.
    const decay = decayForCompany(
      company({ kind: null, cadenceDays: null, lastTouchAt: daysBefore(NOW, 3) }),
      DEFAULT_SETTINGS,
      NOW
    )

    expect(decay.cadenceDays).toBe(0)
    expect(decay.band).toBe('late')
    expect(decay.label).toBe('3d')
  })

  it('reads a touch timestamped in the future as today, never as a negative day count', () => {
    const decay = decayForCompany(company({ lastTouchAt: daysBefore(NOW, -2) }), DEFAULT_SETTINGS, NOW)

    expect(decay.label).toBe('today')
    expect(decay.band).toBe('ok')
  })

  it('never lands in the ok band on an unparseable timestamp', () => {
    const decay = decayForCompany(company({ lastTouchAt: 'not a timestamp' }), DEFAULT_SETTINGS, NOW)

    expect(decay.band).toBe('late')
  })
})

describe('band thresholds', () => {
  // The rule lives twice on purpose — here as a band, and in DecayMeter.tsx as
  // the class it draws — because a pure computation should not import a React
  // component to learn what "late" means. This is what stops the two copies
  // drifting: the same pct goes through both and has to come out the same.
  //
  // Each case is produced by a real company rather than by handing a pct in
  // directly, so the arithmetic upstream of the threshold is on trial too:
  // over a 100-day cadence, N days late is a pct of N/100 exactly.
  const CASES = [
    { days: 69, pct: 0.69, band: 'ok' },
    { days: 70, pct: 0.7, band: 'warn' },
    { days: 99, pct: 0.99, band: 'warn' },
    { days: 100, pct: 1, band: 'late' }
  ] as const

  for (const { days, pct, band } of CASES) {
    it(`agrees with DecayMeter at pct ${pct}`, () => {
      const decay = decayForCompany(
        company({ cadenceDays: 100, lastTouchAt: daysBefore(NOW, days) }),
        DEFAULT_SETTINGS,
        NOW
      )
      expect(decay.pct).toBe(pct)
      expect(decay.band).toBe(band)

      const { container } = render(createElement(DecayMeter, { pct: decay.pct, label: decay.label }))
      const classes = (container.querySelector('.decay')?.className ?? '').split(' ')
      expect(classes).toContain(decay.band)
    })
  }

  it('agrees with DecayMeter that a long-untouched company is late', () => {
    const decay = decayForCompany(company({ lastTouchAt: null }), DEFAULT_SETTINGS, NOW)

    const { container } = render(createElement(DecayMeter, { pct: decay.pct, label: decay.label }))
    const classes = (container.querySelector('.decay')?.className ?? '').split(' ')
    expect(classes).toContain(decay.band)
    expect(classes).toContain('late')
  })
})
