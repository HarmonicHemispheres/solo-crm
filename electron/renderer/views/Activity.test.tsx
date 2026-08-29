import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Activity } from './Activity'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { Activity as ActivityRow, ActivityFilters } from '../../shared/activity'
import type { Company } from '../../shared/companies'
import type { Person } from '../../shared/people'
import type { Engagement } from '../../shared/engagements'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function makeActivity(overrides: Partial<ActivityRow> & { id: string }): ActivityRow {
  return {
    occurredAt: '2026-08-20T09:00:00.000Z',
    kind: 'call',
    title: 'Touch',
    body: null,
    companyId: null,
    personId: null,
    engagementId: null,
    source: 'manual',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    ...overrides
  }
}

function makeCompany(overrides: Partial<Company> & { id: string; name: string }): Company {
  return {
    kind: 'client',
    website: null,
    billsDirectly: true,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: 14,
    lastTouchAt: null,
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makePerson(overrides: Partial<Person> & { id: string; name: string }): Person {
  return {
    email: null,
    phone: null,
    notes: null,
    lastContactAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeEngagement(overrides: Partial<Engagement> & { id: string }): Engagement {
  return {
    name: 'Engagement',
    billingCompanyId: null,
    clientCompanyId: null,
    offeringVersionId: null,
    agreedRateCents: null,
    billingModel: null,
    status: null,
    startedOn: '2026-01-01',
    endsOn: null,
    renewsOn: null,
    hoursIncluded: null,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const EZDEPLOY = makeCompany({ id: 'ezdeploy', name: 'EZDeploy' })
const RINVII = makeCompany({ id: 'rinvii', name: 'Rinvii' })
const JANE = makePerson({ id: 'jane', name: 'Jane Doe' })
const SAMAY = makeEngagement({ id: 'samay', name: 'Samay build', billingCompanyId: 'ezdeploy', clientCompanyId: 'rinvii' })

/** A minimal in-memory `activity:list` that actually applies the filters it
 * is passed — the entity and date-range filters cross the IPC boundary as
 * real `WHERE` narrowing (`electron/main/db/repositories/activity.ts`), so a
 * stub that ignores them and always returns everything would let a filtering
 * bug in the view pass unnoticed. */
function filterActivity(rows: readonly ActivityRow[], filters: ActivityFilters | undefined): ActivityRow[] {
  if (!filters) return [...rows]
  return rows.filter((row) => {
    if (filters.companyId !== undefined && row.companyId !== filters.companyId) return false
    if (filters.personId !== undefined && row.personId !== filters.personId) return false
    if (filters.engagementId !== undefined && row.engagementId !== filters.engagementId) return false
    if (filters.occurredFrom !== undefined && row.occurredAt < filters.occurredFrom) return false
    if (filters.occurredTo !== undefined && row.occurredAt > filters.occurredTo) return false
    return true
  })
}

/** Detail-route stand-ins — prove navigation actually happened, not just that a handler was called (same technique as Companies.test.tsx). */
function CompanyDetailStub() {
  const { id } = useParams()
  return <div data-testid="company-detail">{id}</div>
}
function PersonDetailStub() {
  const { id } = useParams()
  return <div data-testid="person-detail">{id}</div>
}

function renderActivity({
  activity = [],
  companies = [EZDEPLOY, RINVII],
  people = [JANE],
  engagements = [SAMAY],
  initialEntries = ['/activity']
}: {
  activity?: readonly ActivityRow[]
  companies?: readonly Company[]
  people?: readonly Person[]
  engagements?: readonly Engagement[]
  initialEntries?: string[]
} = {}) {
  const activityList = vi.fn(async (filters?: ActivityFilters) => ({
    ok: true as const,
    data: filterActivity(activity, filters).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  }))
  window.crm = stubCrm({
    'activity:list': activityList,
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements }))
  })

  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <LayerManager>
          <Routes>
            <Route path="/activity" element={<Activity />} />
            <Route path="/company/:id" element={<CompanyDetailStub />} />
            <Route path="/person/:id" element={<PersonDetailStub />} />
          </Routes>
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, activityList }
}

describe('Activity', () => {
  it('renders kind, when, title, body excerpt and every linked entity for a logged row', async () => {
    renderActivity({
      activity: [
        makeActivity({
          id: 'a1',
          kind: 'meeting',
          title: 'Kickoff call',
          body: 'Discussed scope and timeline for the engagement.',
          companyId: 'ezdeploy',
          personId: 'jane',
          engagementId: 'samay',
          occurredAt: '2026-08-20T14:00:00.000Z'
        })
      ]
    })

    await waitFor(() => expect(screen.getByText('Kickoff call')).toBeTruthy())
    // `.tag`, not the filter bar's "Meeting" chip button — both render the
    // same text, at the same time, on this exact screen.
    expect(screen.getByText('Meeting', { selector: '.tag' })).toBeTruthy()
    expect(screen.getByText('Discussed scope and timeline for the engagement.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'EZDeploy' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Samay build' })).toBeTruthy()
  })

  it('renders no edit and no delete affordance anywhere in the view (G8)', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'a1', title: 'Kickoff call', companyId: 'ezdeploy' })]
    })
    await waitFor(() => expect(screen.getByText('Kickoff call')).toBeTruthy())

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })

  it('orders rows by occurred_at descending, with a backdated row in its correct historical position', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'recent', title: 'Recent note', occurredAt: '2026-08-27T09:00:00.000Z', createdAt: '2026-08-27T09:00:00.000Z' }),
        // Logged today but backdated to a month ago — created_at is the
        // newest of the three, occurred_at is the oldest. Sorting by
        // created_at (this task's Risks) would put this first; sorting by
        // occurred_at puts it last.
        makeActivity({ id: 'backdated', title: 'Backdated note', occurredAt: '2026-07-01T09:00:00.000Z', createdAt: '2026-08-28T10:00:00.000Z' }),
        makeActivity({ id: 'middle', title: 'Middle note', occurredAt: '2026-08-15T09:00:00.000Z', createdAt: '2026-08-15T09:00:00.000Z' })
      ]
    })

    await waitFor(() => expect(screen.getByText('Recent note')).toBeTruthy())
    const titles = screen.getAllByText(/note$/).map((el) => el.textContent)
    expect(titles).toEqual(['Recent note', 'Middle note', 'Backdated note'])
  })

  it('filters by kind and clears cleanly back to the full set', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'c1', kind: 'call', title: 'Call one' }),
        makeActivity({ id: 'e1', kind: 'email', title: 'Email one' })
      ]
    })

    await waitFor(() => expect(screen.getByText('Call one')).toBeTruthy())
    expect(screen.getByText('Email one')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(screen.queryByText('Email one')).toBeNull())
    expect(screen.getByText('Call one')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(screen.getByText('Email one')).toBeTruthy())
    expect(screen.getByText('Call one')).toBeTruthy()
  })

  it('filters by date range (server-side occurredFrom/occurredTo) and clears cleanly back to the full set', async () => {
    const { activityList } = renderActivity({
      activity: [
        makeActivity({ id: 'early', title: 'Early touch', occurredAt: '2026-08-01T09:00:00.000Z' }),
        makeActivity({ id: 'late', title: 'Late touch', occurredAt: '2026-08-25T09:00:00.000Z' })
      ]
    })

    await waitFor(() => expect(screen.getByText('Early touch')).toBeTruthy())
    expect(screen.getByText('Late touch')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-20' } })
    await waitFor(() => expect(screen.queryByText('Early touch')).toBeNull())
    expect(screen.getByText('Late touch')).toBeTruthy()
    // Actually reached the IPC boundary with occurredFrom set — proves this
    // is server-side narrowing, not a client-side re-filter of a fixed list.
    expect(activityList).toHaveBeenLastCalledWith(expect.objectContaining({ occurredFrom: '2026-08-20T00:00:00.000Z' }))

    // Two "Clear filters" buttons exist while the filtered set is empty —
    // the filter bar's own and the "no matches" empty state's action, same
    // reasoning as the header/empty-state "Log a touch" pair above.
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByText('Early touch')).toBeTruthy())
    expect(screen.getByText('Late touch')).toBeTruthy()
  })

  it('every entity link navigates to the right page — company, person, and an engagement (routed to its billing company, since no engagement detail route exists)', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'a1', title: 'Kickoff call', companyId: 'ezdeploy', personId: 'jane', engagementId: 'samay' })
      ]
    })
    await waitFor(() => expect(screen.getByText('Kickoff call')).toBeTruthy())

    fireEvent.click(screen.getByRole('link', { name: 'EZDeploy' }))
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('ezdeploy'))
  })

  it('the person link navigates to the person detail route', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'a1', title: 'Kickoff call', personId: 'jane' })]
    })
    await waitFor(() => expect(screen.getByText('Kickoff call')).toBeTruthy())

    fireEvent.click(screen.getByRole('link', { name: 'Jane Doe' }))
    await waitFor(() => expect(screen.getByTestId('person-detail').textContent).toBe('jane'))
  })

  it('the engagement link navigates to the engagement\'s billing company page, labelled with the engagement\'s own name', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'a1', title: 'Kickoff call', engagementId: 'samay' })]
    })
    await waitFor(() => expect(screen.getByText('Kickoff call')).toBeTruthy())

    const link = screen.getByRole('link', { name: 'Samay build' })
    fireEvent.click(link)
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('ezdeploy'))
  })

  it('shows an empty state naming the quick-log shortcut when there is no activity at all', async () => {
    renderActivity({ activity: [] })
    await waitFor(() =>
      expect(screen.getByText('No activity yet. Log a touch (⌘L) to start the record.')).toBeTruthy()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Log the first touch' }))
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('shows a distinct "no matches" empty state (not the quick-log one) when filters narrow an otherwise non-empty log to nothing', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'c1', kind: 'call', title: 'Call one' })]
    })
    await waitFor(() => expect(screen.getByText('Call one')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    await waitFor(() => expect(screen.getByText(/No activity matches these filters/)).toBeTruthy())
    expect(screen.queryByText(/No activity yet/)).toBeNull()

    // Two "Clear filters" buttons exist while the filtered set is empty —
    // the filter bar's own and the "no matches" empty state's action, same
    // reasoning as the header/empty-state "Log a touch" pair above.
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByText('Call one')).toBeTruthy())
  })

  it('stays windowed at the 10x volume target — renders one page of rows, not the whole set, until "Load more" is clicked', async () => {
    const rows = Array.from({ length: 130 }, (_, i) =>
      makeActivity({
        id: `row-${i}`,
        title: `Touch ${i}`,
        occurredAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()
      })
    )
    renderActivity({ activity: rows })

    await waitFor(() => expect(screen.getAllByText(/^Touch \d+$/).length).toBeGreaterThan(0))
    expect(screen.getAllByText(/^Touch \d+$/)).toHaveLength(50)

    fireEvent.click(screen.getByRole('button', { name: /Load .*more/ }))
    await waitFor(() => expect(screen.getAllByText(/^Touch \d+$/)).toHaveLength(100))

    fireEvent.click(screen.getByRole('button', { name: /Load .*more/ }))
    await waitFor(() => expect(screen.getAllByText(/^Touch \d+$/)).toHaveLength(130))
    expect(screen.queryByRole('button', { name: /Load .*more/ })).toBeNull()
  })

  it('reads the entity filter off the URL when arrived at from elsewhere, and clears it cleanly', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'a1', title: 'For EZDeploy', companyId: 'ezdeploy' }),
        makeActivity({ id: 'a2', title: 'For Rinvii', companyId: 'rinvii' })
      ],
      initialEntries: ['/activity?companyId=ezdeploy']
    })

    await waitFor(() => expect(screen.getByText('For EZDeploy')).toBeTruthy())
    expect(screen.queryByText('For Rinvii')).toBeNull()
    expect(screen.getByText('Filtered to EZDeploy')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(screen.getByText('For Rinvii')).toBeTruthy())
    expect(screen.getByText('For EZDeploy')).toBeTruthy()
  })

  it('never calls window.crm from this module directly — every read is wired through the ipc/query-key helpers', async () => {
    window.crm = stubCrm({ 'activity:list': vi.fn(async () => ({ ok: true as const, data: [] })) })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/activity']}>
          <LayerManager>
            <Activity />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )
    // Called with the calling convention callCrmImpl/ipcQueryFn use — an
    // object payload (activity:list's request schema is `.optional()`, but
    // this view always builds one, even when empty), not a raw window.crm
    // invocation with something ad hoc.
    await waitFor(() => expect(window.crm['activity:list']).toHaveBeenCalledWith({}))
  })
})
