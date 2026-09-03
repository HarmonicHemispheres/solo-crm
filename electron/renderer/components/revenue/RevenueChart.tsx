import { eachMonth } from '../../../shared/format'
import { formatMoney } from '../../views/offerings-display'
import { compactMoney, niceCeiling } from './scale'
import type { PeriodMonth } from '../../../shared/types'
import type { RevenueSeriesKind, RevenueSeriesPoint } from '../../../shared/revenue'
import './RevenueChart.css'

/**
 * The stacked monthly revenue chart (T-260902-06, P3-11) — the mockup's
 * `stackChart()`, drawn from `revenue:summary`'s `series` instead of its
 * hardcoded fifteen-element `revMonths` array. Shared by the Revenue view
 * and Today, so the two cannot disagree about a month.
 *
 * It does no data shaping beyond mapping cents to bar heights: each point
 * is already a `SUM ... GROUP BY period_month, kind, status` from main
 * (ADR-003), each month's total is the summary's own `months` row, and
 * this component only decides where on the canvas each goes. The scale —
 * the tallest month rounded up to a round number, with four gridlines
 * labelled beneath it — is arithmetic on one figure the payload states,
 * not a sum. A month the series has no point for is an empty column, not
 * a missing one — the window says how many months there are.
 *
 * **Projected is distinguishable from actual without colour.** An actual
 * segment (invoiced or paid) is solid; a projected one is drawn at reduced
 * opacity *and* with a dashed outline, so the distinction survives a
 * monochrome print and a colour-vision deficiency alike. The legend says
 * "dashed = projected" for the same reason the mockup's does.
 *
 * Inline SVG on the tokens, like `Ring` — no chart library, the app has
 * none. The bars scale with the card (`preserveAspectRatio="none"`), so
 * every stroke uses `vector-effect="non-scaling-stroke"` to keep its width
 * and dash honest at any size, and the axis labels are HTML beside the
 * canvas rather than text inside it, which would stretch with it.
 */

/** The three stacks, bottom to top, in the mockup's colours — `REVENUE_SERIES_KINDS`, each with its swatch. */
const STACKS: ReadonlyArray<{ readonly kind: RevenueSeriesKind; readonly color: string; readonly label: string }> = [
  { kind: 'retainer', color: 'var(--verdigris)', label: 'recurring' },
  { kind: 'milestone', color: 'var(--lapis)', label: 'fixed' },
  { kind: 'tm', color: 'var(--verdigris-dim)', label: 'T&M' }
]

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The mockup's canvas: 100 wide, bars rising from y=38.4 to at most 34 units tall. */
const VIEW_W = 100
const VIEW_H = 42
const BASELINE = 38.4
const MAX_BAR = 34
/** Gridlines above the baseline, evenly spaced up to the scale's top. */
const GRIDLINES = 4

export interface RevenueChartProps {
  window: { readonly from: PeriodMonth; readonly to: PeriodMonth }
  series: readonly RevenueSeriesPoint[]
  /** The summary's per-month gross totals — the scale and the tooltips. */
  months: ReadonlyArray<{ readonly periodMonth: PeriodMonth; readonly cents: number }>
  currentMonth: PeriodMonth
  /** Pixel height of the drawing; the mockup uses 190 on Revenue and 150 on Today. */
  height?: number
}

interface Segment {
  readonly kind: RevenueSeriesKind
  readonly color: string
  readonly status: 'projected' | 'actual'
  readonly y: number
  readonly height: number
}

interface Column {
  readonly month: PeriodMonth
  readonly label: string
  readonly total: number
  readonly segments: readonly Segment[]
}

function monthLabel(month: PeriodMonth): string {
  return MONTH_LABEL[Number(month.slice(5, 7)) - 1]
}

export function RevenueChart({ window, series, months: monthTotals, currentMonth, height = 190 }: RevenueChartProps) {
  const months = eachMonth(window.from, window.to)
  const count = months.length

  // cents by month|kind|status — the series is already grouped, so this is
  // a lookup, not a sum.
  const cells = new Map<string, number>()
  for (const point of series) cells.set(`${point.periodMonth}|${point.kind}|${point.status}`, point.cents)
  const totalOf = new Map(monthTotals.map((month) => [month.periodMonth, month.cents]))

  const top = niceCeiling(Math.max(0, ...months.map((month) => totalOf.get(month) ?? 0)))

  const columns: Column[] = months.map((month) => {
    const segments: Segment[] = []
    let y = BASELINE
    for (const stack of STACKS) {
      // Actual first, so it sits under the projection of the same kind —
      // what is invoiced is the floor of what the month will bring.
      for (const status of ['actual', 'projected'] as const) {
        const cents = cells.get(`${month}|${stack.kind}|${status}`) ?? 0
        if (cents <= 0) continue
        const segmentHeight = (cents / top) * MAX_BAR
        y -= segmentHeight
        segments.push({ kind: stack.kind, color: stack.color, status, y, height: segmentHeight })
      }
    }
    return { month, label: monthLabel(month), total: totalOf.get(month) ?? 0, segments }
  })

  const gridlines = Array.from({ length: GRIDLINES }, (_, index) => {
    const fraction = (index + 1) / GRIDLINES
    return { y: BASELINE - fraction * MAX_BAR, cents: top * fraction }
  })

  const columnWidth = VIEW_W / count
  const currentIndex = months.indexOf(currentMonth)
  const label = `Recognised revenue by month, ${monthLabel(window.from)} ${window.from.slice(0, 4)} to ${monthLabel(window.to)} ${window.to.slice(0, 4)}, up to ${formatMoney(top)}`

  return (
    <div className="revchart">
      <div className="revchart-plot">
        <div className="revchart-y" style={{ height }} aria-hidden="true">
          {gridlines.map((line) => (
            <span key={line.cents} className="meta" style={{ top: `${(line.y / VIEW_H) * 100}%` }}>
              {compactMoney(line.cents)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={{ height }}
          role="img"
          aria-label={label}
        >
          {gridlines.map((line) => (
            <line key={line.cents} className="revchart-grid" x1="0" y1={line.y} x2={VIEW_W} y2={line.y} vectorEffect="non-scaling-stroke" />
          ))}
          {columns.map((column, index) => (
            <g key={column.month} data-month={column.month}>
              <title>{`${column.label} ${column.month.slice(0, 4)}: ${formatMoney(column.total)}`}</title>
              {column.segments.map((segment) => (
                <rect
                  key={`${segment.kind}-${segment.status}`}
                  className={`revchart-seg ${segment.status}`}
                  data-kind={segment.kind}
                  data-status={segment.status}
                  x={index * columnWidth + columnWidth * 0.17}
                  y={segment.y}
                  width={columnWidth * 0.66}
                  height={segment.height}
                  rx={0.5}
                  fill={segment.color}
                  stroke={segment.color}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          ))}
          <line className="revchart-base" x1="0" y1={BASELINE + 0.2} x2={VIEW_W} y2={BASELINE + 0.2} vectorEffect="non-scaling-stroke" />
          {currentIndex >= 0 && currentIndex < count - 1 && (
            // The mockup's divider between what has happened and what is
            // expected: after the current month's column.
            <line
              className="revchart-now"
              x1={(currentIndex + 1) * columnWidth}
              y1="0"
              x2={(currentIndex + 1) * columnWidth}
              y2={BASELINE + 0.2}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="revchart-axis" aria-hidden="true">
        {columns.map((column) => (
          <span key={column.month} className={`meta${column.month === currentMonth ? ' now' : ''}${column.month > currentMonth ? ' ahead' : ''}`}>
            {column.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * The mockup's `.legend`: one swatch per stack, then the projected rule.
 * Sits in a card header's trailing slot on both pages. Today's card is a
 * third of the width and the mockup's legend there carries the three
 * swatches only; `compact` drops the note, which the Revenue page states
 * in full beside the same chart.
 */
export function RevenueLegend({ compact = false }: { compact?: boolean }) {
  return (
    <span className="legend">
      {STACKS.map((stack) => (
        <span key={stack.kind}>
          <i style={{ background: stack.color }} />
          {stack.label}
        </span>
      ))}
      {!compact && <span className="legend-note">dashed = projected</span>}
    </span>
  )
}
