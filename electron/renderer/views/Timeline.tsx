import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { Toggle } from '../components/primitives/Toggle'
import { EmptyState } from '../components/primitives/EmptyState'
import { engagementAnchorId } from '../nav'
import { identityColor, initials } from '../lib/identity'
import { ipcQueryFn } from '../lib/ipc'
import { queryKeys } from '../lib/query-keys'
import { addMonths, eachMonth, localPeriodMonth, monthsBetween, parseDateOnly, periodMonthOf } from '../../shared/format'
import { isSigned, type BillingModel, type EngagementWithOffering, type Milestone } from '../../shared/engagements'
import type { Company } from '../../shared/companies'
import type { PeriodMonth } from '../../shared/types'
import { MONTH_WIDTH_PX, ZOOMS, type ZoomKey } from './timeline-zoom'
import './Timeline.css'

/**
 * `/timeline` (T-260902-16, P3-12) — the mockup's `ganttView()` on its own
 * route under the Reports group, rather than the toggle on `/engagements`
 * the mockup draws it as.
 *
 * **Every position on this page comes from a date, never from money.** Bar
 * extent is `started_on` → `ends_on`, milestone ticks sit at their
 * `expected_month`: engagement and milestone columns, which ADR-003 permits
 * a view to read directly. Nothing here is summed across engagements or
 * attributed to a month, which is the line ADR-003 actually draws — so there
 * is no revenue figure on this page at all, and adding one would mean
 * reading `revenue_lines`, not these columns.
 *
 * Deliberately no headline price in the bar, which is where the mockup puts
 * one. ADR-003 permits it (a single engagement's own terms), but the four
 * billing-model branches that compute it live unexported inside
 * `Engagements.tsx`, and copying them here would make a second place
 * billing-model branching lives. Promoting them is its own change; until
 * then the bar carries the engagement's name and the tooltip its range.
 */

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

const RANGES = [
  { value: 'year', label: 'This year' },
  { value: 'next12', label: 'Next 12 months' },
  { value: 'all', label: 'Everything' }
] as const
type RangeKey = (typeof RANGES)[number]['value']

const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active only' }
] as const
type ScopeKey = (typeof SCOPES)[number]['value']

/** How far past the current month a rolling engagement is drawn when the
 * window is `all` — the generator's own horizon (`ROLLING_HORIZON_MONTHS`),
 * so the timeline and the forecast end at the same month rather than two. */
const ROLLING_HORIZON_MONTHS = 12

/** The months drawn, inclusive. Named `Span`, not `Window`, so nothing in
 * this file shadows the global the renderer actually has. */
interface Span {
  readonly from: PeriodMonth
  readonly to: PeriodMonth
}

/**
 * Which months to draw. `year` and `next12` are fixed windows; `all` is derived
 * from the data — earliest start to latest end, with a rolling engagement
 * counted out to the horizon rather than treated as unbounded (which has no
 * right-hand edge to draw).
 */
function spanFor(range: RangeKey, currentMonth: PeriodMonth, engagements: readonly EngagementWithOffering[]): Span {
  if (range === 'next12') return { from: currentMonth, to: addMonths(currentMonth, 11) }
  if (range === 'year') {
    const year = currentMonth.slice(0, 4)
    return { from: `${year}-01-01` as PeriodMonth, to: `${year}-12-01` as PeriodMonth }
  }
  const horizon = addMonths(currentMonth, ROLLING_HORIZON_MONTHS - 1)
  let from: PeriodMonth = currentMonth
  let to: PeriodMonth = horizon
  for (const engagement of engagements) {
    const start = periodMonthOf(engagement.startedOn)
    if (start < from) from = start
    const end = engagement.endsOn === null ? horizon : periodMonthOf(engagement.endsOn)
    if (end > to) to = end
  }
  return { from, to }
}

/** Where a month sits across the window, 0–100. The right edge of the last
 * month is 100, so a bar ending in the final month fills it rather than
 * stopping a column short. */
function positionOf(month: PeriodMonth, span: Span, columns: number): number {
  return (monthsBetween(span.from, month) / columns) * 100
}

const MONTH_INITIAL = 'JFMAMJJASOND'

/** UTC-formatted, so a `YYYY-MM-DD` never shifts a month under a negative
 * UTC offset — `electron/shared/format.ts`'s header on exactly that bug, and
 * the same formatter Engagements.tsx uses so one engagement reads the same
 * on both pages. */
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** `Sep 26 → Dec 26`, or `Sep 26 → rolling` when there is no end date. */
function formatTerm(startedOn: string, endsOn: string | null): string {
  const from = MONTH_YEAR.format(parseDateOnly(startedOn))
  return `${from} → ${endsOn === null ? 'rolling' : MONTH_YEAR.format(parseDateOnly(endsOn))}`
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

interface Bar {
  readonly engagement: EngagementWithOffering
  /** Percentages across the window, already clamped to it. */
  readonly left: number
  readonly width: number
  /** `ends_on = NULL` — drawn with a fade at its right edge, never a bar
   * ending on a date nobody entered. */
  readonly rolling: boolean
  /** Not `active`/`pending`/`delivered` (`isSigned`) — drawn dashed and
   * faded, so signed and unsigned differ without relying on colour. */
  readonly unsigned: boolean
  readonly ticks: readonly { readonly id: string; readonly left: number; readonly done: boolean; readonly label: string }[]
}

/**
 * One engagement's bar, or `null` when its term does not overlap the window
 * at all — an engagement off-screen is omitted rather than pinned to an edge
 * where it would claim a range it does not have.
 */
function barFor(
  engagement: EngagementWithOffering,
  milestones: readonly Milestone[],
  span: Span,
  columns: number
): Bar | null {
  const endsOn = engagement.endsOn
  const rolling = endsOn === null
  const start = periodMonthOf(engagement.startedOn)
  // A rolling engagement runs to the right-hand edge whatever the span is;
  // that is what the fade says, and it is why no end date is invented here.
  const end = endsOn === null ? span.to : periodMonthOf(endsOn)
  if (end < span.from || start > span.to) return null

  const rawLeft = positionOf(start < span.from ? span.from : start, span, columns)
  // `+ 1` because a bar covers its end month, it does not stop on its first day.
  const rawRight = positionOf(addMonths(end > span.to ? span.to : end, 1), span, columns)
  const left = Math.max(0, rawLeft)
  const width = Math.max(Math.min(100, rawRight) - left, 100 / columns / 2)

  const ticks = milestones
    .filter((milestone) => milestone.expectedMonth !== null)
    .map((milestone) => {
      const month = periodMonthOf(milestone.expectedMonth as string)
      // Positioned relative to the bar, since that is what it is drawn
      // inside — a tick outside the bar's own extent is dropped rather than
      // clamped onto its edge, where it would name the wrong month.
      const withinSpan = positionOf(month, span, columns) + 100 / columns / 2
      return {
        id: milestone.id,
        left: ((withinSpan - left) / width) * 100,
        done: milestone.completedAt !== null,
        label: `${milestone.name ?? 'Milestone'} · ${MONTH_YEAR.format(parseDateOnly(month))}${milestone.completedAt !== null ? ' · done' : ''}`
      }
    })
    .filter((tick) => tick.left >= 0 && tick.left <= 100)

  return {
    engagement,
    left,
    width,
    rolling,
    unsigned: !isSigned(engagement.status),
    ticks
  }
}

function TimelineRow({ bar }: { bar: Bar }) {
  const { engagement } = bar
  const term = formatTerm(engagement.startedOn, engagement.endsOn)
  const status = engagement.status ?? 'no status'
  const model = engagement.billingModel ?? 'none'
  return (
    <div className="gwrap">
      <div className="glabel" title={engagement.name}>
        {engagement.name}
      </div>
      <div className="gplot">
        <Link
          to={{ pathname: '/engagements', hash: `#${engagementAnchorId(engagement.id)}` }}
          className={`gbar g-${model}${bar.rolling ? ' rolling' : ''}${bar.unsigned ? ' ghost' : ''}`}
          style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
          // The visible text is the term, so without this the link's
          // accessible name would be a bare date range — a screen reader
          // would read the page as a list of date ranges with no engagement
          // attached to any of them.
          aria-label={`${engagement.name} · ${term} · ${status}`}
          title={`${engagement.name} · ${term} · ${status}`}
        >
          {/* The term, not the name: `.glabel` already carries the name,
              and a bar repeating it says the same thing twice while the one
              fact the geometry only approximates — which months, exactly —
              goes unstated. */}
          <span className="gbar-t">{term}</span>
          {bar.ticks.map((tick) => (
            <span key={tick.id} className={tick.done ? 'gms on' : 'gms'} style={{ left: `${tick.left}%` }} title={tick.label} />
          ))}
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

interface BillingGroup {
  readonly key: string
  readonly name: string
  readonly bars: readonly Bar[]
}

export function Timeline() {
  const [range, setRange] = useState<RangeKey>('year')
  const [scope, setScope] = useState<ScopeKey>('all')
  const [zoom, setZoom] = useState<ZoomKey>('auto')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Read once per mount, not per render — the same reasoning Companies.tsx
  // and Today.tsx state for their own clocks.
  const currentMonth = useMemo(() => localPeriodMonth(new Date()), [])

  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })

  const allEngagements: readonly EngagementWithOffering[] = engagementsQuery.data ?? []
  const companies: readonly Company[] = companiesQuery.data ?? []
  const companiesById = new Map(companies.map((company) => [company.id, company] as const))

  // Milestones only for fixed-scope engagements — the one model with ticks
  // to draw — one `milestones:list` per id, the same shape Engagements.tsx
  // uses because there is no bulk channel.
  const fixedIds = allEngagements.filter((engagement) => engagement.billingModel === 'fixed').map((engagement) => engagement.id)
  const milestoneResults = useQueries({
    queries: fixedIds.map((id) => ({
      queryKey: queryKeys.milestones.list(id),
      queryFn: ipcQueryFn('milestones:list', { engagementId: id })
    }))
  })
  const milestonesById = new Map<string, readonly Milestone[]>()
  fixedIds.forEach((id, index) => milestonesById.set(id, milestoneResults[index]?.data ?? EMPTY_MILESTONES))

  const engagements = scope === 'active' ? allEngagements.filter((engagement) => engagement.status === 'active') : allEngagements
  const span = spanFor(range, currentMonth, engagements)
  const months = eachMonth(span.from, span.to)
  const columns = months.length

  const groups: BillingGroup[] = []
  const byBillingParty = new Map<string, Bar[]>()
  for (const engagement of engagements) {
    const bar = barFor(engagement, milestonesById.get(engagement.id) ?? EMPTY_MILESTONES, span, columns)
    if (bar === null) continue
    const key = engagement.billingCompanyId ?? UNBILLED_KEY
    const list = byBillingParty.get(key) ?? []
    list.push(bar)
    byBillingParty.set(key, list)
  }
  for (const [key, bars] of byBillingParty) {
    groups.push({
      key,
      name: key === UNBILLED_KEY ? 'No billing party' : (companiesById.get(key)?.name ?? key),
      bars: [...bars].sort((a, b) => (a.engagement.startedOn < b.engagement.startedOn ? -1 : 1))
    })
  }
  groups.sort((a, b) => a.name.localeCompare(b.name))

  const nowLeft = currentMonth >= span.from && currentMonth <= span.to ? positionOf(currentMonth, span, columns) + 100 / columns / 2 : null

  // The plot's width at a fixed zoom, handed to the stylesheet as one
  // variable so every row and the month header agree on it. `undefined` at
  // `auto`, which is the stylesheet's cue to let the plot flex as before.
  const plotWidth = zoom === 'auto' ? undefined : MONTH_WIDTH_PX[zoom] * columns

  // On a zoom change, bring the current month into view rather than leaving
  // the operator at January of the earliest year. Left-aligned at a third of
  // the way across, so what comes next is visible as well as what just was.
  // An effect rather than a click handler because the plot's width is not
  // known until the zoomed layout has been committed.
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller == null || plotWidth == null || nowLeft == null) return
    const nowPx = (nowLeft / 100) * plotWidth
    scroller.scrollLeft = Math.max(0, nowPx - scroller.clientWidth / 3)
  }, [plotWidth, nowLeft])

  const header = (
    <ViewHeader
      icon={<TimelineGlyph />}
      accent="var(--lapis)"
      title="Timeline"
      description="Every engagement across the months, grouped by who pays. Bar length is the term, not the money: a rolling engagement fades at the right edge rather than ending on a date nobody entered, and unsigned work is drawn dashed. Ticks are a fixed scope's milestones at the month each is expected."
      actions={
        <div className="tl-controls">
          <Toggle options={SCOPES} value={scope} onChange={setScope} aria-label="Which engagements to draw" />
          <Toggle options={RANGES} value={range} onChange={setRange} aria-label="Time range" />
          <Toggle options={ZOOMS} value={zoom} onChange={setZoom} aria-label="Zoom" />
        </div>
      }
    />
  )

  if (engagementsQuery.isPending || companiesQuery.isPending) {
    return (
      <div>
        {header}
        <p className="meta">Loading engagements…</p>
      </div>
    )
  }

  const loadError = engagementsQuery.error ?? companiesQuery.error
  if (loadError) {
    return (
      <div>
        {header}
        <EmptyState>{loadError.message}</EmptyState>
      </div>
    )
  }

  if (allEngagements.length === 0) {
    return (
      <div>
        {header}
        <Card>
          <Card.Header title="Engagements" />
          <EmptyState>No engagements yet. Add one and it appears here across the months it runs.</EmptyState>
        </Card>
      </div>
    )
  }

  return (
    <div>
      {header}
      <Card>
        <Card.Header title="Engagements" count={groups.reduce((total, group) => total + group.bars.length, 0)} actions={<TimelineLegend />} />
        {groups.length === 0 ? (
          <EmptyState>
            Nothing runs in this range. Widen it, or switch back to all engagements.
          </EmptyState>
        ) : (
          // The scroller is the card's, never the page's. At `auto` it has
          // nothing to scroll; at a fixed zoom `.gantt` grows to the plot's
          // stated width and this is what contains it.
          <div className="gantt-scroll" ref={scrollRef}>
          <div
            className="gantt"
            data-zoom={zoom}
            style={plotWidth != null ? ({ '--gantt-plot': `${plotWidth}px` } as CSSProperties) : undefined}
          >
            <div className="ghead">
              <div className="sp" />
              <div className="gmonths">
                {months.map((month) => (
                  <span key={month} className={month.slice(5, 7) === '01' ? 'yr' : undefined}>
                    {month.slice(5, 7) === '01' ? `'${month.slice(2, 4)}` : MONTH_INITIAL[Number(month.slice(5, 7)) - 1]}
                  </span>
                ))}
              </div>
            </div>
            {groups.map((group) => (
              <div key={group.key}>
                <div className="ghroup">
                  <span className="cmark" style={{ width: 22, height: 22, fontSize: 9, color: identityColor(group.name) }} aria-hidden="true">
                    <span>{initials(group.name)}</span>
                  </span>
                  <span className="ghroup-n">{group.name}</span>
                  <span className="meta">{group.bars.length}</span>
                </div>
                {group.bars.map((bar) => (
                  <TimelineRow key={bar.engagement.id} bar={bar} />
                ))}
              </div>
            ))}
            {/* The divider between what has happened and what is expected —
                the same fact `RevenueChart` draws on its own canvas. Absent
                rather than pinned to an edge when the window is entirely in
                the past or the future. */}
            {nowLeft !== null && (
              <div className="gnow-wrap" aria-hidden="true">
                <div className="gnow" style={{ left: `${nowLeft}%` }} />
              </div>
            )}
          </div>
          </div>
        )}
      </Card>
    </div>
  )
}

const EMPTY_MILESTONES: readonly Milestone[] = []
const UNBILLED_KEY = '__no_billing_party__'

/** One swatch per billing model, then the two rules a bar's shape carries. */
function TimelineLegend() {
  const models: ReadonlyArray<{ model: BillingModel; color: string; label: string }> = [
    { model: 'retainer', color: 'var(--verdigris)', label: 'retainer' },
    { model: 'fixed', color: 'var(--lapis)', label: 'fixed' },
    { model: 'tm', color: 'var(--slate)', label: 'T&M' },
    { model: 'equity', color: 'var(--gold)', label: 'equity' }
  ]
  return (
    <span className="legend">
      {models.map((entry) => (
        <span key={entry.model}>
          <i style={{ background: entry.color }} />
          {entry.label}
        </span>
      ))}
      <span className="legend-note">dashed = not signed</span>
    </span>
  )
}

/** The rail's timeline glyph, per-view as every ViewHeader icon is. */
function TimelineGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M3 7h10M7 12h13M3 17h8" />
    </svg>
  )
}
