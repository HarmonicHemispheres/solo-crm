import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Revenue } from './Revenue'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { RevenueSummary } from '../../shared/revenue'

/**
 * T-260902-05 / -06. Two properties above the rest:
 *
 * - **The toggle changes attribution and not the total.** The payload
 *   carries three row sets with one set of totals; the assertion is that
 *   switching redraws the rows, the footer does not move, and nothing is
 *   fetched again.
 * - **The page computes nothing.** Every figure on it is handed over by
 *   `revenue:summary`, and the stub's numbers are chosen so that any sum,
 *   product or division the view might do would produce a value that is
 *   not in the payload — and is asserted absent.
 */

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function DetailStub() {
  const params = useParams()
  return <div data-testid="company-detail">{params.id}</div>
}

function summaryFor(overrides: Partial<RevenueSummary> = {}): RevenueSummary {
  return {
    currentMonth: '2026-09-01',
    yearStart: '2026-01-01',
    lineCount: 40,
    metrics: {
      recurringMonthCents: 830_000,
      recurringEngagements: 2,
      recurringNextYearCents: 9_960_000,
      backlogCents: 720_000,
      backlogMilestones: 2,
      tmMonthCents: 495_000,
      concentration: {
        share: 0.6,
        name: 'EZDeploy',
        payers: [
          { name: 'EZDeploy', cents: 3_840_000, share: 0.6 },
          { name: 'Rinvii', cents: 2_560_000, share: 0.4 }
        ]
      }
    },
    window: { from: '2026-06-01', to: '2027-05-01' },
    series: [
      { periodMonth: '2026-08-01', kind: 'retainer', status: 'actual', cents: 830_000 },
      { periodMonth: '2026-09-01', kind: 'retainer', status: 'projected', cents: 830_000 },
      { periodMonth: '2026-09-01', kind: 'milestone', status: 'projected', cents: 360_000 },
      { periodMonth: '2026-09-01', kind: 'tm', status: 'projected', cents: 495_000 }
    ],
    months: [
      { periodMonth: '2026-08-01', cents: 830_000 },
      { periodMonth: '2026-09-01', cents: 1_685_000 }
    ],
    rollups: {
      billing: [
        { key: 'ez', name: 'EZDeploy', model: null, companyId: 'ez', via: null, engagementCount: 3, monthlyCents: 855_000, backlogCents: 720_000, ytdCents: 3_840_000, ytdShare: 0.6 },
        { key: 'rin', name: 'Rinvii', model: null, companyId: 'rin', via: null, engagementCount: 1, monthlyCents: 650_000, backlogCents: 0, ytdCents: 2_560_000, ytdShare: 0.4 }
      ],
      client: [
        { key: 'rin', name: 'Rinvii', model: null, companyId: 'rin', via: null, engagementCount: 1, monthlyCents: 650_000, backlogCents: 0, ytdCents: 2_560_000, ytdShare: 0.4 },
        { key: 'wk', name: 'W+K', model: null, companyId: 'wk', via: 'EZDeploy', engagementCount: 1, monthlyCents: 360_000, backlogCents: 720_000, ytdCents: 2_000_000, ytdShare: 0.3125 },
        { key: 'ez', name: 'EZDeploy', model: null, companyId: 'ez', via: null, engagementCount: 2, monthlyCents: 495_000, backlogCents: 0, ytdCents: 1_840_000, ytdShare: 0.2875 }
      ],
      model: [
        { key: 'retainer', name: 'Retainer', model: 'retainer', companyId: null, via: null, engagementCount: 1, monthlyCents: 650_000, backlogCents: 0, ytdCents: 2_560_000, ytdShare: 0.4 },
        { key: 'fixed', name: 'Fixed scope', model: 'fixed', companyId: null, via: null, engagementCount: 1, monthlyCents: 360_000, backlogCents: 720_000, ytdCents: 2_000_000, ytdShare: 0.3125 },
        { key: 'tm', name: 'Time & materials', model: 'tm', companyId: null, via: null, engagementCount: 2, monthlyCents: 495_000, backlogCents: 0, ytdCents: 1_840_000, ytdShare: 0.2875 }
      ]
    },
    totals: { monthlyCents: 1_505_000, backlogCents: 720_000, ytdCents: 6_400_000 },
    ...overrides
  }
}

function renderRevenue(summaryData: RevenueSummary = summaryFor()) {
  const summary = vi.fn(async () => ({ ok: true as const, data: summaryData }))
  window.crm = stubCrm({ 'revenue:summary': summary })
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/revenue']}>
        <Routes>
          <Route path="/revenue" element={<Revenue />} />
          <Route path="/company/:id" element={<DetailStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { summary }
}

function statFor(label: string): HTMLElement {
  return screen.getByText(label).closest('.stat') as HTMLElement
}

describe('Revenue', () => {
  it('renders the header, the toggle, the four metrics and the two cards from one revenue:summary read', async () => {
    const { summary } = renderRevenue()
    expect(await screen.findByRole('heading', { level: 1, name: 'Revenue' })).toBeTruthy()
    await screen.findByText('$8,300')

    expect(summary).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: 'Roll revenue up by' })).toBeTruthy()

    expect(within(statFor('Recurring / month')).getByText('$8,300')).toBeTruthy()
    expect(statFor('Recurring / month').classList.contains('hero')).toBe(true)
    expect(statFor('Recurring / month').textContent).toContain('2 retainers · $99,600 next 12 mo')
    expect(within(statFor('Fixed backlog')).getByText('$7,200')).toBeTruthy()
    expect(statFor('Fixed backlog').textContent).toContain('2 unbilled milestones')
    expect(within(statFor('T&M run rate')).getByText('$4,950')).toBeTruthy()
    expect(within(statFor('Concentration')).getByText('60%')).toBeTruthy()
    expect(statFor('Concentration').textContent).toContain('EZDeploy is the largest')
    expect(statFor('Concentration').querySelectorAll('.conc i')).toHaveLength(2)

    expect(document.querySelectorAll('.stat.hero')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Recognised by month' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Rollup' })).toBeTruthy()

    // The chart's scale comes from the payload's tallest month ($16,850 ->
    // a $20k top, four gridlines), and a month's tooltip is its `months`
    // row, not a sum of its segments.
    const axis = document.querySelector('.revchart-y') as HTMLElement
    expect([...axis.querySelectorAll('span')].map((span) => span.textContent)).toEqual(['$5k', '$10k', '$15k', '$20k'])
    expect(document.querySelector('.revchart svg')?.getAttribute('aria-label')).toContain('up to $20,000')
    expect(document.querySelector('g[data-month="2026-09-01"] title')?.textContent).toBe('Sep 2026: $16,850')
  })

  it('the toggle changes the attribution rows and not the total — and fetches nothing', async () => {
    const { summary } = renderRevenue()
    await screen.findByText('$8,300')

    const footer = () => (document.querySelector('.rev-tbl tfoot') as HTMLElement).textContent
    expect(screen.getByRole('columnheader', { name: 'Billed to' })).toBeTruthy()
    expect(screen.getByText('EZDeploy')).toBeTruthy()
    expect(screen.queryByText('W+K')).toBeNull()
    const totalsUnderBilling = footer()
    expect(totalsUnderBilling).toContain('$15,050')
    expect(totalsUnderBilling).toContain('$64,000')

    fireEvent.click(screen.getByRole('button', { name: 'End client' }))
    await screen.findByText('W+K')
    expect(screen.getByRole('columnheader', { name: 'Work for' })).toBeTruthy()
    expect(screen.getByText('via EZDeploy')).toBeTruthy()
    expect(footer()).toBe(totalsUnderBilling)

    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
    await screen.findByText('Fixed scope')
    expect(screen.getByRole('columnheader', { name: 'Model' })).toBeTruthy()
    expect(document.querySelector('.modeltag.m-retainer')).not.toBeNull()
    expect(footer()).toBe(totalsUnderBilling)

    // The metrics never moved either — concentration is by billing party whatever the toggle says.
    expect(within(statFor('Concentration')).getByText('60%')).toBeTruthy()
    // And the payload was read once: the three row sets came together.
    expect(summary).toHaveBeenCalledTimes(1)
  })

  // Three payloads whose figures deliberately disagree with the arithmetic
  // the view could have done, so a local sum, product or share would show
  // as a number that is not in the payload.
  it('computes nothing: the footer is the payload\'s totals, not a sum of the rows', async () => {
    renderRevenue(summaryFor({ totals: { monthlyCents: 1, backlogCents: 2, ytdCents: 3 } }))
    await screen.findByText('$0.03')
    const footer = document.querySelector('.rev-tbl tfoot')?.textContent ?? ''
    expect(footer).toContain('$0.01')
    expect(footer).toContain('$0.02')
    // 855,000 + 650,000, the sum of the two billing rows, is nowhere.
    expect(document.body.textContent).not.toContain('$15,050')
  })

  it('computes nothing: the annual figure is the payload\'s, not the monthly one times twelve', async () => {
    renderRevenue(summaryFor({ metrics: { ...summaryFor().metrics, recurringNextYearCents: 123_400 } }))
    await screen.findByText('$8,300')
    expect(statFor('Recurring / month').textContent).toContain('$1,234 next 12 mo')
    expect(document.body.textContent).not.toContain('$99,600')
  })

  it('computes nothing: concentration is the payload\'s share, not the largest payer over the total', async () => {
    renderRevenue(
      summaryFor({
        metrics: {
          ...summaryFor().metrics,
          concentration: { share: 0.05, name: 'X', payers: [{ name: 'X', cents: 100, share: 0.9 }] }
        }
      })
    )
    await screen.findByText('5%')
    expect(screen.queryByText('90%')).toBeNull()
  })

  it('a row with a company navigates to it, by click and by keyboard; a model row does not', async () => {
    renderRevenue()
    await screen.findByText('Rinvii')
    const row = screen.getByRole('row', { name: 'Open Rinvii' })
    expect(row.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(row, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('rin'))
  })

  it('an empty database shows the honest empty state, not four zeros', async () => {
    renderRevenue(
      summaryFor({
        lineCount: 0,
        rollups: { billing: [], client: [], model: [] },
        series: [],
        months: [],
        metrics: { ...summaryFor().metrics, recurringMonthCents: 0, backlogCents: 0, tmMonthCents: 0, concentration: { share: null, name: null, payers: [] } }
      })
    )
    await screen.findByText(/Nothing to show yet/)
    expect(screen.queryByText('$0')).toBeNull()
    expect(screen.queryByText('Recurring / month')).toBeNull()
    expect(document.querySelector('.rev-tbl')).toBeNull()
  })

  it('reads only revenue:summary — every other window.crm channel fails the render', async () => {
    const summary = vi.fn(async () => ({ ok: true as const, data: summaryFor() }))
    window.crm = new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === 'revenue:summary') return summary
        throw new Error(`Revenue read window.crm.${String(prop)} — the page must derive nothing from another channel (ADR-003)`)
      }
    }) as never
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/revenue']}>
          <Routes>
            <Route path="/revenue" element={<Revenue />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await screen.findByText('$8,300')
    expect(summary).toHaveBeenCalledTimes(1)
  })
})
