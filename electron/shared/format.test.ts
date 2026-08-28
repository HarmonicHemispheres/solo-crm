import { describe, expect, it } from 'vitest'
import {
  centsToDecimalString,
  decimalStringToCents,
  formatDateOnly,
  formatTimestamp,
  nowTimestamp,
  parseDateOnly,
  parseTimestamp,
  startOfMonth
} from './format'

// This file is typechecked under BOTH tsconfig.node.json and
// tsconfig.web.json (electron/shared/**/* is included in both, on purpose —
// see the header comment in ./format.ts). It must therefore never reference
// `process` or any other Node global: tsconfig.web.json declares no "node"
// types, so a reference here would fail typecheck under that config, not
// just at runtime. The deeper proof that these helpers are immune to the
// machine's local timezone (using `process.env.TZ`) lives in
// electron/main/shared-conventions.test.ts, where Node globals are legal.

describe('formatDateOnly / parseDateOnly', () => {
  it('round-trips a date string exactly', () => {
    const original = '2026-08-28'
    expect(formatDateOnly(parseDateOnly(original))).toBe(original)
  })

  it('rejects an invalid date string before it ever reaches a Date', () => {
    expect(() => parseDateOnly('2026-02-30')).toThrow()
  })
})

describe('formatTimestamp / parseTimestamp', () => {
  it('round-trips a timestamp string exactly', () => {
    const original = new Date().toISOString()
    expect(formatTimestamp(parseTimestamp(original))).toBe(original)
  })

  it('nowTimestamp() produces a value timestampSchema accepts', () => {
    const value = nowTimestamp()
    expect(() => formatTimestamp(parseTimestamp(value))).not.toThrow()
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('startOfMonth', () => {
  it('returns the first of the month for a mid-month date', () => {
    expect(startOfMonth(new Date(Date.UTC(2026, 7, 28)))).toBe('2026-08-01')
  })

  it('is idempotent on a date already at the start of the month', () => {
    expect(startOfMonth(new Date(Date.UTC(2026, 7, 1)))).toBe('2026-08-01')
  })
})

describe('centsToDecimalString / decimalStringToCents', () => {
  it('round-trips a positive amount', () => {
    expect(centsToDecimalString(1999)).toBe('19.99')
    expect(decimalStringToCents('19.99')).toBe(1999)
  })

  it('round-trips a negative amount (an expense row, ADR-003)', () => {
    expect(centsToDecimalString(-450)).toBe('-4.50')
    expect(decimalStringToCents('-4.50')).toBe(-450)
  })

  it('handles a whole-dollar amount with no decimal component', () => {
    expect(centsToDecimalString(500)).toBe('5.00')
    expect(decimalStringToCents('5')).toBe(500)
  })

  it('rejects more precision than a cent can hold', () => {
    expect(() => decimalStringToCents('19.999')).toThrow()
  })

  it('rejects a non-numeric string', () => {
    expect(() => decimalStringToCents('nineteen dollars')).toThrow()
  })

  it('rejects a float passed where cents are expected', () => {
    expect(() => centsToDecimalString(19.99)).toThrow()
  })
})
