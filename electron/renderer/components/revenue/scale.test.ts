import { describe, expect, it } from 'vitest'
import { compactMoney, niceCeiling } from './scale'

describe('niceCeiling', () => {
  it('rounds the tallest month up to a round dollar top, never below $100', () => {
    expect(niceCeiling(0)).toBe(10_000)
    expect(niceCeiling(9_999)).toBe(10_000)
    expect(niceCeiling(1_685_000)).toBe(2_000_000)
    expect(niceCeiling(2_000_000)).toBe(2_000_000)
    expect(niceCeiling(2_100_000)).toBe(2_500_000)
    expect(niceCeiling(2_600_000)).toBe(5_000_000)
    expect(niceCeiling(5_000_001)).toBe(10_000_000)
  })
})

describe('compactMoney', () => {
  it('labels the axis in as few characters as the figure allows', () => {
    expect(compactMoney(95_000)).toBe('$950')
    expect(compactMoney(500_000)).toBe('$5k')
    expect(compactMoney(1_250_000)).toBe('$12.5k')
    expect(compactMoney(120_000_000)).toBe('$1.2M')
  })
})
