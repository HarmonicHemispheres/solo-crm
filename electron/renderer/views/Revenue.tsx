import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { Section } from '../components/primitives/Section'
import { EmptyState } from '../components/primitives/EmptyState'
import { Stat } from '../components/primitives/Stat'
import { Toast } from '../components/primitives/Toast'
import { Toggle } from '../components/primitives/Toggle'
import { ModelTag } from '../components/primitives/ModelTag'
import { RevenueChart, RevenueLegend } from '../components/revenue/RevenueChart'
import { PeriodPicker } from '../components/revenue/PeriodPicker'
import { defaultPeriod, formatPeriodMonth, periodLabel, periodScope, type Period } from '../components/revenue/period'
import { ipcMutationFn, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { identityColor, initials } from '../lib/identity'
import { formatMoney, plural } from './offerings-display'
import type { RevenueLine, RevenueLineStatus, RevenueRollup, RevenueRollupRow, RevenueSummary } from '../../shared/revenue'
import './Revenue.css'

/**
 * `/revenue` — §6.7's view (T-260902-05, P3-10).
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
 * **The reporting period is part of the request, not a filter here.** The
 * picker sends its window and bucket to `revenue:summary`; folding twelve
 * months into an annual bar is a `GROUP BY` in main for the same reason
 * every other figure is. The four metrics are deliberately *not* scoped by
 * it — "recurring per month" and "T&M run rate" are statements about now,
 * and stepping the chart back a year must not quietly restate them about
 * 2025. The one figure that is of the range is the period forecast, and
 * the summary states it (`windowTotalCents`, with `windowActualCents` for
 * the part already invoiced or paid).
 *
 * **Marking a line invoiced or paid** is the page's one write. Until it
 * existed the whole chart was drawn dashed — `status` had a single writer
 * in the plan, the Stripe adapter, so every generated line read `projected`
 * whatever had actually happened. The Lines card is where the operator says
 * otherwise; it writes one column on one row (`revenue:setLineStatus`) and
 * never an amount.
 *
 * The one thing still deliberately absent is the mockup's animated count-up
 * on the stat values; base.css's motion rules cover transitions, and a
 * number that is changing is a number that cannot be read.
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

const LINE_KIND_LABEL: Record<string, string> = {
  retainer: 'Retainer',
  milestone: 'Milestone',
  tm_estimate: 'T&M estimate',
  tm_actual: 'T&M actual',
  expense: 'Expense'
}

/**
 * The three states of a line, in the order money moves through them. The
 * control is a Toggle rather than a single cycling button: three states is
 * one too many to cycle through blind, and a segmented control shows where
 * the row is as well as where it can go.
 */
const LINE_STATUS_OPTIONS = [
  { value: 'projected', label: 'Projected' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' }
] as const satisfies ReadonlyArray<{ value: RevenueLineStatus; label: string }>

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

export function Revenue() {
  const navigate = useNavigate()
  const [rollup, setRollup] = useState<RevenueRollup>('billing')
  // The clock is read once per mount, not live during render — `Date.now()`
  // is an impure call react-hooks/purity refuses inline, and a report does
  // not need to jump to a new year while it is open.
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(new Date()))

  // One read carries all three rollups; the toggle picks one out of the
  // payload already held. The window is part of the key because it is part
  // of the answer — see `queryKeys.revenue`.
  const summaryQuery = useQuery({
    queryKey: queryKeys.revenue.summary(periodScope(period)),
    queryFn: ipcQueryFn('revenue:summary', { window: { from: period.from, to: period.to }, bucket: period.bucket })
  })
  const summary: RevenueSummary | undefined = summaryQuery.data

  const header = (
    <ViewHeader
      icon={<RevenueGlyph />}
      accent="var(--gold)"
      title="Revenue"
      description="Revenue rolls up by whoever is on the invoice. Switch to end client to see who the work is actually for — the totals are the same, the attribution is not."
      actions={<PeriodPicker period={period} onChange={setPeriod} />}
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
        <Section title="Monthly revenue">
          <Card>
            <EmptyState>
              Nothing to show yet. Revenue is recognised from each signed engagement's terms — retainers by the month, fixed
              scopes by milestone, T&amp;M by estimated hours — and no active, pending or delivered engagement has a price
              to recognise. Set one on an engagement and its months appear here.
            </EmptyState>
          </Card>
        </Section>
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
        {/* The period forecast: every line of every signed engagement in
            the window, and beneath it how much of that has already been
            invoiced or paid. Both are the summary's own sums (ADR-003). */}
        <Stat
          label="Period forecast"
          value={formatMoney(summary.windowTotalCents)}
          tone="hero"
          meta={`${plural(summary.windowEngagements, 'engagement')} in ${periodLabel(period)} · ${formatMoney(summary.windowActualCents)} invoiced or paid`}
        />
        <Stat
          label="Recurring / month"
          value={formatMoney(metrics.recurringMonthCents)}
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

      {/* Full width, and its own row: the chart is the page's argument, and
          it was sharing a two-column grid with the rollup table — at a
          typical window each got about 420px, which is 35px a column for a
          year. Each of the three is a Section — heading above the card,
          the page's own rhythm between them — rather than a card with the
          heading inside and nothing between it and the next. */}
      <Section title="Monthly revenue" actions={<RevenueLegend />}>
        <Card>
          <div className="rev-chart">
            <RevenueChart
              window={summary.window}
              series={summary.series}
              months={summary.months}
              currentMonth={summary.currentMonth}
              bucket={summary.bucket}
              height={230}
            />
          </div>
        </Card>
      </Section>

      <div className="cols-even rev-cards">
        <Section title="Rollup" count={rows.length} actions={<Toggle options={ROLLUP_OPTIONS} value={rollup} onChange={setRollup} aria-label="Roll revenue up by" />}>
          <Card>
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
        </Section>

        <LinesCard period={period} />
      </div>
    </>
  )
}

/**
 * The lines behind the chart, and the one column an operator owns on them.
 *
 * Its own query rather than a field on the summary: it is a list of rows,
 * not a figure, and it is long — every month of the window times every
 * priced engagement. Loading it beside the totals would make the four
 * metrics wait on it.
 */
function LinesCard({ period }: { period: Period }) {
  const queryClient = useQueryClient()
  const linesQuery = useQuery({
    queryKey: queryKeys.revenue.lines(period.from, period.to),
    queryFn: ipcQueryFn('revenue:lines', { from: period.from, to: period.to })
  })

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: RevenueLineStatus }) => ipcMutationFn('revenue:setLineStatus')(input).then(unwrapMutationResult),
    // The whole entity: the chart's projected/actual split, the rollup's
    // backlog column and this list are three readings of the column just
    // written.
    onSuccess: () => invalidate.revenue(queryClient)
  })

  const lines: readonly RevenueLine[] = linesQuery.data ?? []

  return (
    <Section title="Lines" count={linesQuery.isPending ? undefined : lines.length} caption="mark what has been invoiced">
      <Card>
        {linesQuery.isPending ? (
          <p className="meta rev-lines-note">Loading lines…</p>
        ) : linesQuery.error ? (
          <EmptyState>{linesQuery.error.message}</EmptyState>
        ) : lines.length === 0 ? (
          <EmptyState>No revenue lines fall in {periodLabel(period)}.</EmptyState>
        ) : (
          <div className="rev-lines">
            {lines.map((line) => (
              <div className="rev-line" key={line.id}>
                <div className="rev-line-id">
                  <div className="nm trunc">{line.engagementName ?? 'No engagement'}</div>
                  <div className="meta">
                    {formatPeriodMonth(line.periodMonth)} · {line.kind === null ? 'Unclassified' : (LINE_KIND_LABEL[line.kind] ?? line.kind)}
                    {line.billingCompanyName !== null && ` · ${line.billingCompanyName}`}
                  </div>
                </div>
                <div className="rev-line-amt num">{formatMoney(line.amountCents)}</div>
                <Toggle
                  options={LINE_STATUS_OPTIONS}
                  value={line.status}
                  onChange={(status) => setStatus.mutate({ id: line.id, status })}
                  aria-label={`Status of ${line.engagementName ?? 'this line'}, ${formatPeriodMonth(line.periodMonth)}`}
                />
              </div>
            ))}
          </div>
        )}
        <Toast message={setStatus.isError ? setStatus.error.message : null} onDismiss={() => setStatus.reset()} />
      </Card>
    </Section>
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
