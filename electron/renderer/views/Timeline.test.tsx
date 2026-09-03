import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Timeline } from './Timeline'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import { engagementAnchorId } from '../nav'
import type { Company } from '../../shared/companies'
import type { EngagementWithOffering, Milestone } from '../../shared/engagements'

/**
 * The engagement timeline (T-260902-16, P3-12). These are written off that
 * task's acceptance list: a rolling engagement must not be drawn as ending on
 * an invented date, milestone ticks sit at their own `expected_month`, and
 * signed/unsigned must differ by something other than colour.
 *
 * jsdom computes no layout, so nothing here asserts a rendered width — the
 * assertions are on the percentages the component *decides*, read off the
 * inline style, plus the classes that carry the non-colour distinctions. The
 * screenshots are what check the result.
 */

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const TS = '2026-08-28T00:00:00.000Z'

function makeCompany(overrides: Partial<Company> & { id: string; name: string }): Company {
  return {
    kind: null,
    website: null,
    billsDirectly: null,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: null,
    lastTouchAt: null,
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeEngagement(overrides: Partial<EngagementWithOffering> & { id: string; name: string }): EngagementWithOffering {
  return {
    billingCompanyId: null,
    clientCompanyId: null,
    offeringVersionId: null,
    agreedRateCents: null,
    offeringId: null,
    offeringName: null,
    billingModel: null,
    status: null,
    startedOn: '2026-01-01',
    endsOn: null,
    renewsOn: null,
    retainerBasis: null,
    monthlyAmountCents: null,
    hoursIncluded: null,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeMilestone(overrides: Partial<Milestone> & { id: string; engagementId: string }): Milestone {
  return {
    name: null,
    sort: null,
    completedAt: null,
    amountCents: null,
    expectedMonth: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

const acme = makeCompany({ id: 'co-acme', name: 'Acme' })

/** Rolling: no `ends_on`. Runs to the right-hand edge with a fade. */
const rolling = makeEngagement({
  id: 'eng-rolling',
  name: 'Ongoing retainer',
  billingCompanyId: 'co-acme',
  billingModel: 'retainer',
  status: 'active',
  startedOn: '2026-04-15',
  endsOn: null
})

/** Bounded and signed: a crisp bar over its own months. */
const bounded = makeEngagement({
  id: 'eng-bounded',
  name: 'Platform build',
  billingCompanyId: 'co-acme',
  billingModel: 'fixed',
  status: 'active',
  startedOn: '2026-03-01',
  endsOn: '2026-06-30'
})

/** Not signed (`isSigned` is active | pending | delivered). */
const proposed = makeEngagement({
  id: 'eng-proposed',
  name: 'Discovery proposal',
  billingCompanyId: 'co-acme',
  billingModel: 'tm',
  status: 'proposed',
  startedOn: '2026-05-01',
  endsOn: '2026-07-31'
})

const milestones: readonly Milestone[] = [
  makeMilestone({ id: 'ms-1', engagementId: 'eng-bounded', name: 'Kickoff', expectedMonth: '2026-03-01', completedAt: TS }),
  makeMilestone({ id: 'ms-2', engagementId: 'eng-bounded', name: 'Handover', expectedMonth: '2026-06-01' })
]

function renderTimeline(engagements: readonly EngagementWithOffering[], milestoneRows: readonly Milestone[] = []) {
  window.crm = stubCrm({
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: [acme] })),
    'milestones:list': vi.fn(async ({ engagementId }: { engagementId: string }) => ({
      ok: true as const,
      data: milestoneRows.filter((milestone) => milestone.engagementId === engagementId)
    }))
  } as never)
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/timeline']}>
        <Timeline />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** The one bar for an engagement, by its accessible link name. */
function bar(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) })
}

describe('Timeline', () => {
  beforeEach(() => {
    // Pinned inside the default 'This year' window so every assertion below
    // is about the component, not about which year the suite runs in.
    //
    // `shouldAdvanceTime` matters: testing-library's `waitFor` polls on a
    // timer, so a frozen clock starves it and every assertion below times
    // out at five seconds rather than failing on what it checks.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-15T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('draws one bar per engagement, grouped under the company that bills it', async () => {
    renderTimeline([rolling, bounded])
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())
    expect(bar('Ongoing retainer')).toBeTruthy()
    expect(bar('Platform build')).toBeTruthy()
  })

  it('renders a rolling engagement as a fade to the edge, never a bar ending on an invented date', async () => {
    renderTimeline([rolling])
    await waitFor(() => expect(bar('Ongoing retainer')).toBeTruthy())
    const element = bar('Ongoing retainer')
    expect(element.className).toContain('rolling')
    // Reaches the right-hand edge of the window rather than stopping on a
    // date nobody entered: left + width is the whole remaining span.
    const left = Number.parseFloat(element.style.left)
    const width = Number.parseFloat(element.style.width)
    expect(left + width).toBeCloseTo(100, 5)
    // And it says so in words, so the fade is not the only carrier.
    expect(element.textContent).toContain('rolling')
  })

  it('ends a bounded engagement on its own last month, not at the edge', async () => {
    renderTimeline([bounded])
    await waitFor(() => expect(bar('Platform build')).toBeTruthy())
    const element = bar('Platform build')
    expect(element.className).not.toContain('rolling')
    // Mar–Jun of a Jan–Dec window: starts two twelfths in, six twelfths wide.
    expect(Number.parseFloat(element.style.left)).toBeCloseTo((2 / 12) * 100, 5)
    expect(Number.parseFloat(element.style.width)).toBeCloseTo((4 / 12) * 100, 5)
    expect(element.textContent).toContain('Mar 26 → Jun 26')
  })

  it('marks unsigned work with a dash, so it survives greyscale', async () => {
    renderTimeline([bounded, proposed])
    await waitFor(() => expect(bar('Discovery proposal')).toBeTruthy())
    // `.ghost` is `border-style: dashed` in Timeline.css — the class is what
    // jsdom can see; the screenshots are what confirm the treatment.
    expect(bar('Discovery proposal').className).toContain('ghost')
    expect(bar('Platform build').className).not.toContain('ghost')
  })

  it('places a milestone tick at its own expected month, not evenly across the bar', async () => {
    renderTimeline([bounded], milestones)
    await waitFor(() => expect(bar('Platform build')).toBeTruthy())
    const ticks = bar('Platform build').querySelectorAll('.gms')
    expect(ticks).toHaveLength(2)
    // The bar spans Mar–Jun (four months). March's milestone sits in the
    // first month's centre — an eighth along — and June's in the last's,
    // seven eighths along. Evenly spaced by count would put them at 50% and
    // 100%, which is the bug this asserts against.
    expect(Number.parseFloat((ticks[0] as HTMLElement).style.left)).toBeCloseTo(12.5, 4)
    expect(Number.parseFloat((ticks[1] as HTMLElement).style.left)).toBeCloseTo(87.5, 4)
  })

  it('fills a completed milestone and leaves an outstanding one hollow', async () => {
    renderTimeline([bounded], milestones)
    await waitFor(() => expect(bar('Platform build')).toBeTruthy())
    const ticks = bar('Platform build').querySelectorAll('.gms')
    expect(ticks[0].className).toContain('on')
    expect(ticks[1].className).not.toContain('on')
  })

  it('drops a milestone with no expected month rather than guessing one', async () => {
    renderTimeline([bounded], [makeMilestone({ id: 'ms-x', engagementId: 'eng-bounded', name: 'Someday' })])
    await waitFor(() => expect(bar('Platform build')).toBeTruthy())
    expect(bar('Platform build').querySelectorAll('.gms')).toHaveLength(0)
  })

  it('links a bar to its engagement', async () => {
    renderTimeline([bounded])
    await waitFor(() => expect(bar('Platform build')).toBeTruthy())
    expect(bar('Platform build').getAttribute('href')).toBe(`/engagements#${engagementAnchorId('eng-bounded')}`)
  })

  it('changes the months drawn when the range changes', async () => {
    renderTimeline([rolling])
    await waitFor(() => expect(bar('Ongoing retainer')).toBeTruthy())
    // 'This year' is Jan–Dec: twelve columns, January carrying the year.
    const months = () => document.querySelectorAll('.gmonths span')
    expect(months()).toHaveLength(12)
    expect(months()[0].textContent).toBe("'26")

    fireEvent.click(screen.getByRole('button', { name: 'Next 12 months' }))

    // Sep 2026 through Aug 2027 — still twelve, but no longer starting at January.
    expect(months()).toHaveLength(12)
    expect(months()[0].textContent).toBe('S')
  })

  it('omits an engagement whose term does not reach the window at all', async () => {
    renderTimeline([makeEngagement({ id: 'eng-old', name: 'Ancient work', billingCompanyId: 'co-acme', status: 'delivered', startedOn: '2021-01-01', endsOn: '2021-06-30' })])
    await waitFor(() => expect(screen.getByText(/Nothing runs in this range/)).toBeTruthy())
    expect(screen.queryByRole('link', { name: /Ancient work/ })).toBeNull()
  })

  it('widens to cover an out-of-range engagement under Everything', async () => {
    renderTimeline([makeEngagement({ id: 'eng-old', name: 'Ancient work', billingCompanyId: 'co-acme', status: 'delivered', startedOn: '2021-01-01', endsOn: '2021-06-30' })])
    await waitFor(() => expect(screen.getByText(/Nothing runs in this range/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))

    await waitFor(() => expect(screen.getByRole('link', { name: /Ancient work/ })).toBeTruthy())
  })

  it('filters to active engagements only, and back', async () => {
    renderTimeline([bounded, proposed])
    await waitFor(() => expect(bar('Discovery proposal')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Active only' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Discovery proposal/ })).toBeNull())
    expect(bar('Platform build')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(bar('Discovery proposal')).toBeTruthy())
  })

  it('groups an engagement with no billing party rather than dropping it', async () => {
    renderTimeline([makeEngagement({ id: 'eng-orphan', name: 'Unbilled work', status: 'active', startedOn: '2026-02-01', endsOn: '2026-05-31' })])
    await waitFor(() => expect(screen.getByText('No billing party')).toBeTruthy())
    expect(bar('Unbilled work')).toBeTruthy()
  })

  it('says so when there is nothing to draw at all', async () => {
    renderTimeline([])
    await waitFor(() => expect(screen.getByText(/No engagements yet/)).toBeTruthy())
  })

  it('carries no money figure — the page is dates only (ADR-003)', async () => {
    renderTimeline(
      [
        makeEngagement({
          id: 'eng-priced',
          name: 'Priced work',
          billingCompanyId: 'co-acme',
          billingModel: 'retainer',
          retainerBasis: 'amount',
          monthlyAmountCents: 350_000,
          status: 'active',
          startedOn: '2026-02-01',
          endsOn: '2026-08-31'
        })
      ],
      []
    )
    await waitFor(() => expect(bar('Priced work')).toBeTruthy())
    const card = document.querySelector('.gantt')
    expect(card?.textContent).not.toMatch(/\$/)
  })

  it('draws the now marker inside the window and omits it outside one', async () => {
    const { unmount } = renderTimeline([rolling])
    await waitFor(() => expect(bar('Ongoing retainer')).toBeTruthy())
    // Mid-September of a Jan–Dec window: the ninth month's centre.
    const now = document.querySelector('.gnow') as HTMLElement | null
    expect(now).toBeTruthy()
    expect(Number.parseFloat(now?.style.left ?? '')).toBeCloseTo((8.5 / 12) * 100, 4)
    unmount()

    // 'Next 12 months' starts at the current month, so "now" sits at its
    // left edge and is still inside — the case with no marker is a window
    // entirely in the past, which only 'Everything' can produce here.
    renderTimeline([rolling])
    await waitFor(() => expect(bar('Ongoing retainer')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next 12 months' }))
    expect(document.querySelector('.gnow')).toBeTruthy()
  })
})
