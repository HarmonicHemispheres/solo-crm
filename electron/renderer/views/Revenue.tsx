import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { EmptyState } from '../components/primitives/EmptyState'
import { Stat } from '../components/primitives/Stat'
import { Toggle } from '../components/primitives/Toggle'
import { ModelTag } from '../components/primitives/ModelTag'
import { RevenueChart, RevenueLegend } from '../components/revenue/RevenueChart'
import { ipcQueryFn } from '../lib/ipc'
import { queryKeys } from '../lib/query-keys'
import { identityColor, initials } from '../lib/identity'
import { formatMoney, plural } from './offerings-display'
import type { RevenueRollup, RevenueRollupRow, RevenueSummary } from '../../shared/revenue'
import './Revenue.css'

/**
 * `/revenue` — §6.7's view (T-260902-05, P3-10), replacing T-260902-01's
 * honest empty body now that there is something to read.
 *
 * Every number on this page arrives from one `revenue:summary` call and is
 * rendered as it came: the four metrics, the chart's series, the three
 * rollups' rows and their column totals. Nothing here adds two figures
 * together, divides one by another, or reads a rate, a contract value or
 * an hours column off an engagement (ADR-003; `Revenue.test.tsx` fails the
 * render on any other `window.crm` access). The rollup toggle changes
 * which of the payload's three row sets is shown — who the same money is
 * attributed to — and never a total, and never fetches.
 *
 * The one thing that is still deliberately absent is the mockup's animated
 * count-up on the stat values; base.css's motion rules cover transitions,
 * and a number that is changing is a number that cannot be read.
 */

const ROLLUP_OPTIONS = [
  { value: 'billing', label: 'Billing party' },
  { value: 'client', label: 'End client' },
  { value: 'model', label: 'Model' }
] as const satisfies ReadonlyArray<{ value: RevenueRollup; label: string }>

const ROLLUP_COLUMN: Record<RevenueRollup, string> = {
  billing: 'Billed to',
  client: 'Work for',
  model: 'Model'
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

export function Revenue() {
  const navigate = useNavigate()
  const [rollup, setRollup] = useState<RevenueRollup>('billing')

  // One read carries all three rollups; the toggle picks one out of the
  // payload already held, and Today reads the same entry.
  const summaryQuery = useQuery({ queryKey: queryKeys.revenue.summary(), queryFn: ipcQueryFn('revenue:summary') })
  const summary: RevenueSummary | undefined = summaryQuery.data

  const header = (
    <ViewHeader
      icon={<RevenueGlyph />}
      accent="var(--gold)"
      title="Revenue"
      description="Revenue rolls up by whoever is on the invoice. Switch to end client to see who the work is actually for — the totals are the same, the attribution is not."
      actions={<Toggle options={ROLLUP_OPTIONS} value={rollup} onChange={setRollup} aria-label="Roll revenue up by" />}
    />
  )

  if (summaryQuery.isPending) {
    return (
      <>
        {header}
        <p className="meta">Loading revenue…</p>
      </>
    )
  }

  if (summaryQuery.error || !summary) {
    return (
      <>
        {header}
        <EmptyState>{summaryQuery.error?.message ?? 'Revenue could not be read.'}</EmptyState>
      </>
    )
  }

  if (summary.lineCount === 0) {
    // Not four zeros: nothing has been recognised because nothing signed has
    // a price yet, and that is the thing to say (T-260902-01's reasoning,
    // kept). The generator writes a line the moment an engagement is
    // active, pending or delivered with terms it can price.
    return (
      <>
        {header}
        <Card>
          <Card.Header title="Recognised by month" />
          <EmptyState>
            Nothing to show yet. Revenue is recognised from each signed engagement's terms — retainers by the month, fixed
            scopes by milestone, T&amp;M by estimated hours — and no active, pending or delivered engagement has a price
            to recognise. Set one on an engagement and its months appear here.
          </EmptyState>
        </Card>
      </>
    )
  }

  const { metrics } = summary
  const largest = metrics.concentration
  const rows = summary.rollups[rollup]

  return (
    <>
      {header}
      <div className="grid stats rev-stats">
        <Stat
          label="Recurring / month"
          value={formatMoney(metrics.recurringMonthCents)}
          tone="hero"
          meta={`${plural(metrics.recurringEngagements, 'retainer')} · ${formatMoney(metrics.recurringNextYearCents)} next 12 mo`}
        />
        <Stat label="Fixed backlog" value={formatMoney(metrics.backlogCents)} meta={`${plural(metrics.backlogMilestones, 'unbilled milestone')}`} />
        <Stat label="T&M run rate" value={formatMoney(metrics.tmMonthCents)} meta="this month, estimate" />
        <Stat
          label="Concentration"
          value={largest.share === null ? '—' : percent(largest.share)}
          meta={largest.name === null ? 'nothing recognised this year' : `${largest.name} is the largest`}
          chart={
            <div className="conc" aria-hidden="true">
              {largest.payers.map((payer) => (
                <i key={payer.name} style={{ width: `${payer.share * 100}%`, background: identityColor(payer.name) }} title={payer.name} />
              ))}
            </div>
          }
        />
      </div>

      <div className="grid rev-cards">
        <Card>
          <Card.Header title="Recognised by month" actions={<RevenueLegend />} />
          <div className="rev-chart">
            <RevenueChart window={summary.window} series={summary.series} months={summary.months} currentMonth={summary.currentMonth} height={190} />
          </div>
        </Card>

        <Card>
          <Card.Header title="Rollup" count={rows.length} />
          <div className="rev-scroll">
            <table className="rev-tbl">
              <thead>
                <tr>
                  <th>{ROLLUP_COLUMN[rollup]}</th>
                  <th className="num">Monthly</th>
                  <th className="num">Backlog</th>
                  <th className="num">YTD</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RollupRow key={row.key} row={row} rollup={rollup} onNavigate={(id) => navigate(`/company/${id}`)} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{formatMoney(summary.totals.monthlyCents)}</td>
                  <td className="num">{formatMoney(summary.totals.backlogCents)}</td>
                  <td className="num">{formatMoney(summary.totals.ytdCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}

function RollupRow({ row, rollup, onNavigate }: { row: RevenueRollupRow; rollup: RevenueRollup; onNavigate: (companyId: string) => void }) {
  const { companyId } = row
  const open = companyId === null ? undefined : () => onNavigate(companyId)
  const engagements = plural(row.engagementCount, 'engagement')
  return (
    <tr
      className={open ? 'navigable' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-label={open ? `Open ${row.name}` : undefined}
      onClick={open}
      onKeyDown={
        open &&
        ((event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        })
      }
    >
      <td>
        <div className="rev-cell">
          {rollup === 'model' ? (
            row.model !== null && row.model !== 'none' ? (
              <ModelTag model={row.model}>{row.name}</ModelTag>
            ) : (
              <span className="modeltag">{row.name}</span>
            )
          ) : (
            <CompanyMark name={row.name} />
          )}
          <div className="rev-cell-text">
            {rollup !== 'model' && <div className="nm trunc">{row.name}</div>}
            <div className="meta">{row.via !== null ? `via ${row.via}` : engagements}</div>
          </div>
        </div>
        <div className="rev-share" aria-hidden="true">
          <i style={{ width: `${row.ytdShare * 100}%` }} />
        </div>
      </td>
      <td className="num">{row.monthlyCents !== 0 ? formatMoney(row.monthlyCents) : '—'}</td>
      <td className="num dim">{row.backlogCents !== 0 ? formatMoney(row.backlogCents) : '—'}</td>
      <td className="num">{formatMoney(row.ytdCents)}</td>
    </tr>
  )
}

/** The identity mark, at the rollup's 26px — the same `.cmark` every list draws (styles/identity-mark.css). */
function CompanyMark({ name }: { name: string }) {
  const style: CSSProperties = { width: 26, height: 26, fontSize: 10, color: identityColor(name) }
  return (
    <span className="cmark" style={style} aria-hidden="true">
      <span>{initials(name)}</span>
    </span>
  )
}

/** The rail's revenue glyph (components/shell/icons.tsx), per-view as every ViewHeader icon is. */
function RevenueGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4" />
    </svg>
  )
}
