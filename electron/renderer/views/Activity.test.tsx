import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Activity } from './Activity'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { Activity as ActivityRow, ActivityFilters } from '../../shared/activity'
import type { Task, TaskFilter } from '../../shared/tasks'
import type { Company } from '../../shared/companies'
import type { Person } from '../../shared/people'
import type { EngagementWithOffering } from '../../shared/engagements'

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
    dueOn: null,
    companyId: null,
    personId: null,
    engagementId: null,
    source: 'manual',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    ...overrides
  }
}

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    body: null,
    kind: 'task',
    status: 'todo',
    isNextStep: false,
    occurredAt: null,
    dueOn: null,
    waitingSince: null,
    doneAt: null,
    companyId: null,
    engagementId: null,
    personId: null,
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
    introducedByPersonId: null,
    cadenceDays: 14,
    lastTouchAt: null,
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

function makeEngagement(overrides: Partial<EngagementWithOffering> & { id: string }): EngagementWithOffering {
  return {
    name: 'Engagement',
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

/** As `filterActivity`, for the todo half. The date range is deliberately
 * NOT applied here: the view does not send it to `tasks:list` (that channel's
 * `dueFrom`/`dueTo` bound `due_on` alone, which is only half of where a todo
 * sits on the timeline), so a stub that applied it would be testing something
 * the app does not do. */
function filterTasks(rows: readonly Task[], filter: TaskFilter | undefined): Task[] {
  if (!filter) return [...rows]
  return rows.filter((row) => {
    if (filter.companyId !== undefined && row.companyId !== filter.companyId) return false
    if (filter.personId !== undefined && row.personId !== filter.personId) return false
    if (filter.engagementId !== undefined && row.engagementId !== filter.engagementId) return false
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
  tasks = [],
  companies = [EZDEPLOY, RINVII],
  people = [JANE],
  engagements = [SAMAY],
  initialEntries = ['/activity'],
  crmOverrides = {}
}: {
  activity?: readonly ActivityRow[]
  tasks?: readonly Task[]
  companies?: readonly Company[]
  people?: readonly Person[]
  engagements?: readonly EngagementWithOffering[]
  initialEntries?: string[]
  crmOverrides?: Parameters<typeof stubCrm>[0]
} = {}) {
  const activityList = vi.fn(async (filters?: ActivityFilters) => ({
    ok: true as const,
    data: filterActivity(activity, filters).sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  }))
  const tasksList = vi.fn(async (filter?: TaskFilter) => ({
    ok: true as const,
    data: filterTasks(tasks, filter)
  }))
  window.crm = stubCrm({
    'activity:list': activityList,
    'tasks:list': tasksList,
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    ...crmOverrides
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
  return { ...result, activityList, tasksList }
}

/** The Type and Category filters both offer an "All" chip, so every filter
 * click in this file is scoped to its own group rather than found by name
 * across the whole bar. */
function typeFilter(): HTMLElement {
  return screen.getByRole('group', { name: 'Type' })
}
function categoryFilter(): HTMLElement {
  return screen.getByRole('group', { name: 'Category' })
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

  it('filters by category and clears cleanly back to the full set', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'c1', kind: 'call', title: 'Call one' }),
        makeActivity({ id: 'e1', kind: 'email', title: 'Email one' })
      ]
    })

    await waitFor(() => expect(screen.getByText('Call one')).toBeTruthy())
    expect(screen.getByText('Email one')).toBeTruthy()

    fireEvent.click(within(categoryFilter()).getByRole('button', { name: 'Call' }))
    await waitFor(() => expect(screen.queryByText('Email one')).toBeNull())
    expect(screen.getByText('Call one')).toBeTruthy()

    fireEvent.click(within(categoryFilter()).getByRole('button', { name: 'All' }))
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
    //
    // The expected instant is built here rather than written as a literal
    // (it was `'2026-08-20T00:00:00.000Z'` until T-260901-26). The bound is
    // local midnight of the picked day, so its UTC spelling depends on the
    // machine's timezone — a literal would be an assertion about where the
    // test happens to run. `new Date(y, m, d)` is the same local-midnight
    // construction the view makes, which is the claim under test.
    expect(activityList).toHaveBeenLastCalledWith(
      expect.objectContaining({ occurredFrom: new Date(2026, 7, 20, 0, 0, 0, 0).toISOString() })
    )

    // Two "Clear filters" buttons exist while the filtered set is empty —
    // the filter bar's own and the "no matches" empty state's action, same
    // reasoning as the header/empty-state "Log a touch" pair above.
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(screen.getByText('Early touch')).toBeTruthy())
    expect(screen.getByText('Late touch')).toBeTruthy()
  })

  it('a row displayed on the picked day is included by that day — the filter reads the same calendar the rows print (T-260901-26)', async () => {
    // LESSONS.md line 12, made concrete. The bounds used to be UTC midnight
    // (`parseDateOnly`) while every row renders its `occurredAt` in local
    // time, so west of UTC an evening touch showed "Sep 1" on its own row
    // and was excluded by From=Sep 1 / To=Sep 1 — it only appeared under
    // Sep 2.
    //
    // The fixture is built *from* the local timezone rather than as a fixed
    // UTC literal, so this states the same property wherever it runs: 18:00
    // local on 2026-09-01 is the row, 2026-09-01 is the filter. In UTC the
    // two frames coincide and it passes trivially; anywhere west of it —
    // including the machine this was written on — it is the regression, and
    // it fails against the old bounds.
    const sixPmLocal = new Date(2026, 8, 1, 18, 0, 0, 0)
    const occurredAt = sixPmLocal.toISOString()
    const { activityList } = renderActivity({
      activity: [makeActivity({ id: 'evening', title: 'Evening touch', occurredAt })]
    })

    await waitFor(() => expect(screen.getByText('Evening touch')).toBeTruthy())
    // The row prints the day the filter is about to be set to. Half the
    // point: the inclusion asserted below is only meaningful because this
    // is what the operator sees on the row.
    expect(screen.getByText(/Sep 1, 2026/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-01' } })

    // Asserted on the bounds that crossed the boundary, not on what is
    // painted. `placeholderData: keepPreviousData` deliberately holds the
    // previous rows on screen through the refetch, so a `getByText` here
    // finds the row whether or not the new filter would have excluded it —
    // which is exactly how a first draft of this test passed against the
    // unfixed view. The bounds are the thing the repository's SQL compares,
    // so they are the thing to check.
    await waitFor(() =>
      expect(activityList).toHaveBeenLastCalledWith(
        expect.objectContaining({ occurredFrom: expect.any(String), occurredTo: expect.any(String) })
      )
    )
    const filters = activityList.mock.lastCall?.[0] as ActivityFilters
    expect(
      occurredAt >= filters.occurredFrom! && occurredAt <= filters.occurredTo!,
      `${occurredAt} (shown as Sep 1) must fall inside [${filters.occurredFrom}, ${filters.occurredTo}]`
    ).toBe(true)
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

  it('shows an empty state naming the quick-log shortcut when the timeline is empty, and its action opens the form', async () => {
    renderActivity({ activity: [], tasks: [] })
    await waitFor(() =>
      expect(screen.getByText('Nothing here yet. Add an event or a todo, or log a touch with ⌘L.')).toBeTruthy()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add the first entry' }))
    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy()
  })

  it('shows a distinct "no matches" empty state (not the quick-log one) when filters narrow an otherwise non-empty log to nothing', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'c1', kind: 'call', title: 'Call one' })]
    })
    await waitFor(() => expect(screen.getByText('Call one')).toBeTruthy())

    fireEvent.click(within(categoryFilter()).getByRole('button', { name: 'Email' }))
    await waitFor(() => expect(screen.getByText(/Nothing on the timeline matches these filters/)).toBeTruthy())
    expect(screen.queryByText(/Nothing here yet/)).toBeNull()

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

/**
 * The half of this page that is new: events and todos in one stream, and the
 * category as the operator's own list rather than a four-value enum.
 */
describe('Activity — one stream of events and todos', () => {
  it('interleaves todos with events in one chronological list, newest first', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'e-old', title: 'Old event', occurredAt: '2026-08-10T09:00:00.000Z' }),
        makeActivity({ id: 'e-new', title: 'New event', occurredAt: '2026-08-25T09:00:00.000Z' })
      ],
      tasks: [
        // Between the two events by `occurred_at`; the second has none, so it
        // sits at its due date instead — which is what `entryInstant` is for.
        makeTask({ id: 't-mid', title: 'Middle todo', occurredAt: '2026-08-18T09:00:00.000Z' }),
        makeTask({ id: 't-due', title: 'Due todo', dueOn: '2026-08-14' })
      ]
    })

    await waitFor(() => expect(screen.getByText('New event')).toBeTruthy())
    const titles = screen.getAllByText(/(event|todo)$/).map((el) => el.textContent)
    expect(titles).toEqual(['New event', 'Middle todo', 'Due todo', 'Old event'])
  })

  it('an undated todo is in the stream, at the bottom', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'e1', title: 'An event', occurredAt: '2026-08-25T09:00:00.000Z' })],
      tasks: [makeTask({ id: 't1', title: 'Undated todo' })]
    })

    await waitFor(() => expect(screen.getByText('Undated todo')).toBeTruthy())
    const titles = screen.getAllByText(/(event|todo)$/).map((el) => el.textContent)
    expect(titles).toEqual(['An event', 'Undated todo'])
  })

  it('the Type filter narrows the stream to one half and back', async () => {
    renderActivity({
      activity: [makeActivity({ id: 'e1', title: 'An event' })],
      tasks: [makeTask({ id: 't1', title: 'A todo' })]
    })
    await waitFor(() => expect(screen.getByText('A todo')).toBeTruthy())

    fireEvent.click(within(typeFilter()).getByRole('button', { name: 'Todo' }))
    await waitFor(() => expect(screen.queryByText('An event')).toBeNull())
    expect(screen.getByText('A todo')).toBeTruthy()

    fireEvent.click(within(typeFilter()).getByRole('button', { name: 'Event' }))
    await waitFor(() => expect(screen.queryByText('A todo')).toBeNull())
    expect(screen.getByText('An event')).toBeTruthy()

    fireEvent.click(within(typeFilter()).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(screen.getByText('A todo')).toBeTruthy())
    expect(screen.getByText('An event')).toBeTruthy()
  })

  it('completing a todo from the stream writes a status transition, and nothing offers to edit an event', async () => {
    const update = vi.fn(async (payload: unknown) => {
      void payload
      return {
        ok: true as const,
        data: { ok: true as const, data: { ...makeTask({ id: 't1', title: 'A todo' }), status: 'done' as const } }
      }
    })
    renderActivity({
      activity: [makeActivity({ id: 'e1', title: 'An event' })],
      tasks: [makeTask({ id: 't1', title: 'A todo' })],
      crmOverrides: { 'tasks:update': update }
    })
    await waitFor(() => expect(screen.getByText('A todo')).toBeTruthy())

    // Exactly one completion control on the page: the todo's. An event has no
    // lifecycle to complete and no edit of any kind (G8).
    const checks = screen.getAllByRole('button', { name: /^Mark ".+" done$/ })
    expect(checks).toHaveLength(1)
    fireEvent.click(checks[0])

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({ id: 't1', patch: { status: 'done' } })
  })

  it('a done todo stays in the stream, marked done and with no completion control', async () => {
    renderActivity({
      tasks: [makeTask({ id: 't1', title: 'A finished todo', status: 'done', doneAt: '2026-08-20T10:00:00.000Z' })]
    })

    await waitFor(() => expect(screen.getByText('A finished todo')).toBeTruthy())
    expect(screen.getByText('Done', { selector: '.tag' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Mark ".+" done$/ })).toBeNull()
  })

  it('labels each row with the operator’s own category, and falls back for one they removed', async () => {
    renderActivity({
      activity: [
        makeActivity({ id: 'e1', kind: 'follow-up', title: 'Filed under a live category' }),
        // An id nothing in the list declares — a category the operator
        // removed. The row cannot be edited to repair it (G8), so it has to
        // render.
        makeActivity({ id: 'e2', kind: 'retired-kind', title: 'Filed under a removed one' })
      ],
      crmOverrides: {
        'settings:get': vi.fn(async () => ({
          ok: true as const,
          data: { key: 'timeline.kinds' as const, value: [{ id: 'follow-up', label: 'Follow up', tone: 'gold' as const }] }
        }))
      }
    })

    await waitFor(() => expect(screen.getByText('Filed under a live category')).toBeTruthy())
    expect(screen.getByText('Follow up', { selector: '.tag' })).toBeTruthy()
    // Title-cased from the id rather than blank.
    expect(screen.getByText('Retired kind', { selector: '.tag' })).toBeTruthy()
    // And the filter bar offers the operator's list, not a hardcoded four.
    expect(within(categoryFilter()).getByRole('button', { name: 'Follow up' })).toBeTruthy()
    expect(within(categoryFilter()).queryByRole('button', { name: 'Meeting' })).toBeNull()
  })

  it('the date range keeps a todo whose occurred_at is inside it, and drops one whose is outside', async () => {
    renderActivity({
      tasks: [
        makeTask({ id: 'in', title: 'Inside todo', occurredAt: '2026-08-20T12:00:00.000Z' }),
        makeTask({ id: 'out', title: 'Outside todo', occurredAt: '2026-07-01T12:00:00.000Z' })
      ]
    })
    await waitFor(() => expect(screen.getByText('Outside todo')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } })
    await waitFor(() => expect(screen.queryByText('Outside todo')).toBeNull())
    expect(screen.getByText('Inside todo')).toBeTruthy()
  })

  it('the header’s plus button opens the shared form on its event half', async () => {
    renderActivity()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New entry' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'New entry' }))
    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy()
  })
})
