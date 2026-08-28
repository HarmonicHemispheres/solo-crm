import { afterEach, describe, expect, it } from 'vitest'
import { formatDateOnly, formatTimestamp, parseDateOnly, parseTimestamp } from '../shared/format'

// Proves electron/shared is importable unmodified from main (this file lives
// under electron/main, typechecked and linted with Node globals available —
// see tsconfig.node.json), and that its date helpers round-trip through IPC
// with no timezone shift regardless of the machine's local timezone. The
// renderer-safe half of this coverage (no `process` reference, so it
// typechecks under tsconfig.web.json too) lives in electron/shared/format.test.ts.

describe('date round-trip is immune to the machine timezone', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTz
    }
  })

  it('does not shift the day when the machine timezone is behind UTC', () => {
    // Pacific/Niue is UTC-11. `new Date('2026-08-28')` parses as UTC
    // midnight; reading it back with LOCAL getters on this timezone gives
    // 2026-08-27 — the exact bug "no Date crosses the boundary" exists to
    // rule out. formatDateOnly must not reproduce it, because it reads UTC
    // fields only (electron/shared/format.ts).
    process.env.TZ = 'Pacific/Niue'
    const original = '2026-08-28'
    expect(formatDateOnly(parseDateOnly(original))).toBe(original)
  })

  it('does not shift the day when the machine timezone is ahead of UTC', () => {
    process.env.TZ = 'Pacific/Kiritimati' // UTC+14
    const original = '2026-08-28'
    expect(formatDateOnly(parseDateOnly(original))).toBe(original)
  })

  it('a naive new Date(dateOnlyString) read with LOCAL getters DOES shift — the bug these helpers avoid', () => {
    process.env.TZ = 'Pacific/Niue'
    const naive = new Date('2026-08-28')
    expect(naive.getDate()).toBe(27) // wrong: proves the failure mode is real
    expect(naive.getUTCDate()).toBe(28) // right: what formatDateOnly reads instead
  })

  it('timestamps round-trip exactly regardless of local timezone', () => {
    process.env.TZ = 'Pacific/Niue'
    const original = '2026-08-28T10:15:00.000Z'
    expect(formatTimestamp(parseTimestamp(original))).toBe(original)
  })
})
