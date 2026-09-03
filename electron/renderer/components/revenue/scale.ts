/**
 * The chart's y-axis arithmetic (T-260902-06), beside `RevenueChart.tsx`
 * rather than in it so that file exports components only (react-refresh).
 * Both take one figure the summary states and produce a scale or a label
 * from it — nothing here sums revenue.
 */

/**
 * The top of the scale: the tallest month rounded up to 1, 2, 2.5 or 5 x
 * a power of ten, in cents, so the gridlines land on round dollar figures.
 * At least $100, so an empty chart still has an axis.
 */
export function niceCeiling(cents: number): number {
  const floor = 10_000
  if (cents <= floor) return floor
  const magnitude = 10 ** Math.floor(Math.log10(cents))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= cents) return step * magnitude
  }
  return 10 * magnitude
}

/** `$12.5k`, `$1.2M`, `$950` — an axis label, short enough for the margin; the figures themselves are `formatMoney` everywhere they are stated. */
export function compactMoney(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`
  if (dollars >= 1_000) return `$${trim(dollars / 1_000)}k`
  return `$${trim(dollars)}`
}

function trim(value: number): string {
  return Number(value.toFixed(1)).toString()
}
