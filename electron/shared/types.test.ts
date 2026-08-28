import { describe, expect, it } from 'vitest'
import { centsSchema, dateOnlySchema, hoursSchema, periodMonthSchema, timestampSchema } from './types'

describe('dateOnlySchema', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(dateOnlySchema.safeParse('2026-08-28').success).toBe(true)
  })

  it('rejects a Date instance, with a message saying so', () => {
    const result = dateOnlySchema.safeParse(new Date('2026-08-28'))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Date object may not cross this boundary/)
    }
  })

  it('rejects a date with a time component', () => {
    expect(dateOnlySchema.safeParse('2026-08-28T00:00:00Z').success).toBe(false)
  })

  it('rejects an invalid calendar date', () => {
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false)
    expect(dateOnlySchema.safeParse('2026-13-01').success).toBe(false)
  })

  it('rejects a plain non-date string', () => {
    expect(dateOnlySchema.safeParse('not-a-date').success).toBe(false)
  })
})

describe('timestampSchema', () => {
  it('accepts millisecond-precision UTC ISO-8601, e.g. Date#toISOString()', () => {
    expect(timestampSchema.safeParse(new Date().toISOString()).success).toBe(true)
    expect(timestampSchema.safeParse('2026-08-28T10:15:00.000Z').success).toBe(true)
  })

  it('rejects a Date instance, with a message saying so', () => {
    const result = timestampSchema.safeParse(new Date())
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Date object may not cross this boundary/)
    }
  })

  it('rejects a non-UTC offset', () => {
    expect(timestampSchema.safeParse('2026-08-28T10:15:00.000+02:00').success).toBe(false)
  })

  it('rejects a timestamp missing the Z suffix', () => {
    expect(timestampSchema.safeParse('2026-08-28T10:15:00.000').success).toBe(false)
  })

  it('rejects a timestamp without millisecond precision', () => {
    expect(timestampSchema.safeParse('2026-08-28T10:15:00Z').success).toBe(false)
  })
})

describe('periodMonthSchema', () => {
  it('accepts the first day of a month', () => {
    expect(periodMonthSchema.safeParse('2026-08-01').success).toBe(true)
  })

  it('rejects any date that is not the first of a month', () => {
    const result = periodMonthSchema.safeParse('2026-08-15')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/first day of the month/)
    }
    expect(periodMonthSchema.safeParse('2026-08-31').success).toBe(false)
  })

  it('still rejects an invalid calendar date even when the day-of-month text is "01"', () => {
    // 2026-02-30 is not a valid date at all (dateOnlySchema's job), regardless
    // of whether "-30" would fail the first-of-month check too.
    expect(periodMonthSchema.safeParse('2026-02-30').success).toBe(false)
  })
})

describe('centsSchema', () => {
  it('accepts an integer', () => {
    expect(centsSchema.safeParse(1999).success).toBe(true)
  })

  it('accepts a negative integer (revenue_lines expense rows, ADR-003)', () => {
    expect(centsSchema.safeParse(-500).success).toBe(true)
  })

  it('rejects a float', () => {
    const result = centsSchema.safeParse(19.99)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/integer cents, not a float/)
    }
  })

  it('rejects a Date instance', () => {
    expect(centsSchema.safeParse(new Date()).success).toBe(false)
  })

  it('rejects a numeric string', () => {
    expect(centsSchema.safeParse('1999').success).toBe(false)
  })
})

describe('hoursSchema', () => {
  it('accepts a floating point value', () => {
    expect(hoursSchema.safeParse(2.5).success).toBe(true)
  })

  it('accepts zero', () => {
    expect(hoursSchema.safeParse(0).success).toBe(true)
  })

  it('rejects a negative value', () => {
    expect(hoursSchema.safeParse(-1).success).toBe(false)
  })

  it('rejects non-finite values', () => {
    expect(hoursSchema.safeParse(Number.NaN).success).toBe(false)
    expect(hoursSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
  })
})
