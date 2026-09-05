import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Todos } from './Todos'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { CreateTaskInput, Task, TaskFilter } from '../../shared/tasks'
import type { Company } from '../../shared/companies'
import type { Person } from '../../shared/people'
import type { SettingEntry } from '../../shared/ipc-types'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

// ---------------------------------------------------------------------------
// A fixed reference point relative to the test machine's *own* local clock
// (not a hardcoded calendar date) — `localToday()` in Todos.tsx reads local
// Date accessors deliberately (this task's Risks), so fixtures are built the
// same way rather than risking an off-by-one against whatever date the test
// actually runs on.
// ---------------------------------------------------------------------------

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function addDays(dateOnly: string, delta: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + delta)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

const TODAY = today()

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'todo',
    isNextStep: false,
    dueOn: null,
    waitingSince: null,
    doneAt: null,
    companyId: null,
    engagementId: null,
    personId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

const EZDEPLOY = makeCompany({ id: 'ezdeploy', name: 'EZDeploy' })
const RINVII = makeCompany({ id: 'rinvii', name: 'Rinvii' })
const PERSON = makePerson({ id: 'ben', name: 'Ben Thompson' })

const OVERDUE_TASK = makeTask({ id: 't-overdue', title: 'Send the countersigned SOW', dueOn: addDays(TODAY, -2), companyId: 'ezdeploy' })
const TODAY_TASK = makeTask({ id: 't-today', title: 'Call Rinvii about renewal', dueOn: TODAY, companyId: 'rinvii' })
const THIS_WEEK_TASK = makeTask({ id: 't-week', title: 'Write the edge-case test plan', dueOn: addDays(TODAY, 3), companyId: 'rinvii' })
const LATER_TASK = makeTask({ id: 't-later', title: 'Prep phase-two outline', dueOn: addDays(TODAY, 20) })
const NO_DATE_TASK = makeTask({ id: 't-nodate', title: 'Decide on the tier', dueOn: null })
const WAITING_TASK = makeTask({
  id: 't-waiting',
  title: 'Waiting on Ben for the scope',
  status: 'waiting',
  waitingSince: isoDaysAgo(6),
  personId: 'ben'
})

const OPEN_TASKS: readonly Task[] = [OVERDUE_TASK, TODAY_TASK, THIS_WEEK_TASK, LATER_TASK, NO_DATE_TASK]
const WAITING_TASKS: readonly Task[] = [WAITING_TASK]

/** The `.card` a group's `<h2>` heading sits in — `getByRole('heading', ...)` rather than `getByText` because "Overdue" is both a group heading and a stat label (`Stat`'s `.k`), and the two would otherwise ambiguously match the same text. */
function groupCard(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name })
  const card = heading.closest('.card')
  if (!card) throw new Error(`"${name}" group's card not found`)
  return card as HTMLElement
}

function DetailStub({ testId }: { testId: string }) {
  const params = useParams()
  return <div data-testid={testId}>{params.id}</div>
}

function renderTodos({
  openTasks = OPEN_TASKS,
  waitingTasks = WAITING_TASKS,
  companies = [EZDEPLOY, RINVII],
  people = [PERSON],
  countOpen = openTasks.length,
  groupBy = 'date' as 'date' | 'client',
  crmOverrides = {}
}: {
  openTasks?: readonly Task[]
  waitingTasks?: readonly Task[]
  companies?: readonly Company[]
  people?: readonly Person[]
  countOpen?: number
  groupBy?: 'date' | 'client'
  crmOverrides?: Parameters<typeof stubCrm>[0]
} = {}) {
  // Stateful, not fixed returns — matching Companies.test.tsx's own
  // `currentMode` pattern (its comment explains why): a completion's
  // onSettled invalidates and refetches in the background, and a fixed
  // return would silently undo the very write the test just made, hiding a
  // real regression behind a false "it stayed removed" the optimistic cache
  // write alone would already produce.
  let currentGroupBy = groupBy
  let currentOpenTasks = [...openTasks]
  let currentWaitingTasks = [...waitingTasks]
  let currentCountOpen = countOpen
  window.crm = stubCrm({
    'tasks:list': vi.fn(async (filter?: TaskFilter) => {
      if (filter?.status === 'waiting') return { ok: true as const, data: currentWaitingTasks }
      if (filter?.open) return { ok: true as const, data: currentOpenTasks }
      return { ok: true as const, data: [...currentOpenTasks, ...currentWaitingTasks] }
    }),
    'tasks:countOpen': vi.fn(async () => ({ ok: true as const, data: { count: currentCountOpen } })),
    'tasks:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: OVERDUE_TASK } })),
    'tasks:update': vi.fn(async (input: { id: string; patch: { status?: string | null } }) => {
      if (input.patch.status === 'done') {
        const wasOpen = currentOpenTasks.some((t) => t.id === input.id)
        currentOpenTasks = currentOpenTasks.filter((t) => t.id !== input.id)
        currentWaitingTasks = currentWaitingTasks.filter((t) => t.id !== input.id)
        if (wasOpen) currentCountOpen = Math.max(0, currentCountOpen - 1)
      }
      return { ok: true as const, data: { ok: true as const, data: OVERDUE_TASK } }
    }),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
    'settings:get': vi.fn(async () => ({
      ok: true as const,
      data: { key: 'view.todos.groupBy' as const, value: currentGroupBy }
    })),
    'settings:set': vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.todos.groupBy') currentGroupBy = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    }),
    ...crmOverrides
  })

  const queryClient = createQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/todos']}>
        <Routes>
          <Route path="/todos" element={<Todos />} />
          <Route path="/company/:id" element={<DetailStub testId="company-detail" />} />
          <Route path="/person/:id" element={<DetailStub testId="person-detail" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, queryClient }
}

describe('Todos', () => {
  it('renders the six date buckets and puts each task in the right one', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    for (const label of ['Overdue', 'Today', 'This week', 'Later', 'No date', 'Waiting']) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    }

    expect(within(groupCard('Overdue')).getByText('Send the countersigned SOW')).toBeTruthy()
    expect(within(groupCard('Waiting')).getByText('Waiting on Ben for the scope')).toBeTruthy()
  })

  it('both groupings show the same flattened set of tasks, only partitioned differently', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    const allTitles = [...OPEN_TASKS, ...WAITING_TASKS].map((t) => t.title)
    const byDateTitles = allTitles.filter((title) => screen.getAllByText(title).length > 0).sort()

    fireEvent.click(screen.getByRole('button', { name: 'By client' }))
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())
    const byClientTitles = allTitles.filter((title) => screen.getAllByText(title).length > 0).sort()

    expect(byClientTitles).toEqual(byDateTitles)
    expect(byDateTitles).toHaveLength(allTitles.length)
  })

  it('groups by client into one card per company plus Unassigned, when toggled', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'By client' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'EZDeploy' })).toBeTruthy())

    expect(within(groupCard('Rinvii')).getByText('Call Rinvii about renewal')).toBeTruthy()
    expect(within(groupCard('Rinvii')).getByText('Write the edge-case test plan')).toBeTruthy()

    expect(within(groupCard('Unassigned')).getByText('Prep phase-two outline')).toBeTruthy()
    expect(within(groupCard('Unassigned')).getByText('Waiting on Ben for the scope')).toBeTruthy()
  })

  it('the Open stat comes from tasks:countOpen, not a length this view computes itself', async () => {
    // Deliberately a different number than OPEN_TASKS.length (5) — if this
    // view were deriving "Open" from the fetched array instead of calling
    // tasks:countOpen, it would show 5, not 99.
    renderTodos({ countOpen: 99 })
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())
    expect(screen.getByText('99')).toBeTruthy()
    expect(screen.queryByText('5')).toBeNull()
  })

  it('a waiting task shows elapsed time since waiting_since and is excluded from the Overdue bucket', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Waiting on Ben for the scope')).toBeTruthy())
    expect(screen.getByText('waiting 6d')).toBeTruthy()

    expect(within(groupCard('Overdue')).queryByText('Waiting on Ben for the scope')).toBeNull()
  })

  it('an overdue row and a due-today row read differently in text, not only in colour', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())
    expect(screen.getByText('2d overdue')).toBeTruthy()
    expect(screen.getByText('today')).toBeTruthy()
  })

  it('quick-add under "This week" creates a task with a due date that actually lands in that window', async () => {
    const tasksCreate = vi.fn(async (input: CreateTaskInput) => ({
      ok: true as const,
      data: { ok: true as const, data: { ...OVERDUE_TASK, ...input } }
    }))
    renderTodos({ crmOverrides: { 'tasks:create': tasksCreate } })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'This week' })).toBeTruthy())

    const input = within(groupCard('This week')).getByPlaceholderText('Add a todo to This week')
    fireEvent.change(input, { target: { value: 'Follow up with legal' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(tasksCreate).toHaveBeenCalled())
    const payload = tasksCreate.mock.calls[0][0]
    expect(payload.title).toBe('Follow up with legal')
    expect(payload.dueOn).not.toBeNull()
    const delta = Math.round((new Date(payload.dueOn as string).getTime() - new Date(TODAY).getTime()) / 86_400_000)
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThanOrEqual(7)
  })

  it('quick-add under a company group (by client) scopes the new task to that company', async () => {
    const tasksCreate = vi.fn(async (input: CreateTaskInput) => ({
      ok: true as const,
      data: { ok: true as const, data: { ...OVERDUE_TASK, ...input } }
    }))
    renderTodos({ groupBy: 'client', crmOverrides: { 'tasks:create': tasksCreate } })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'EZDeploy' })).toBeTruthy())

    const input = within(groupCard('EZDeploy')).getByPlaceholderText('Add a todo to EZDeploy')
    fireEvent.change(input, { target: { value: 'Chase the signature' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(tasksCreate).toHaveBeenCalledWith({ title: 'Chase the signature', dueOn: null, companyId: 'ezdeploy' }))
  })

  it('completing a task removes it from its group and the Open stat drops, without a manual reload', async () => {
    renderTodos({ countOpen: 5 })
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())
    expect(screen.getByText('5')).toBeTruthy()

    const row = screen.getByText('Send the countersigned SOW').closest('.todo')
    if (!row) throw new Error('row not found')
    const checkButton = within(row as HTMLElement).getByRole('button', { name: /Mark .* done/ })
    fireEvent.click(checkButton)

    await waitFor(() => expect(screen.queryByText('Send the countersigned SOW')).toBeNull())
    await waitFor(() => expect(screen.getByText('4')).toBeTruthy())
  })

  it('completing a waiting task does not change the Open stat (it was never counted)', async () => {
    renderTodos({ countOpen: 5 })
    await waitFor(() => expect(screen.getByText('Waiting on Ben for the scope')).toBeTruthy())

    const row = screen.getByText('Waiting on Ben for the scope').closest('.todo')
    if (!row) throw new Error('row not found')
    const checkButton = within(row as HTMLElement).getByRole('button', { name: /Mark .* done/ })
    fireEvent.click(checkButton)

    await waitFor(() => expect(screen.queryByText('Waiting on Ben for the scope')).toBeNull())
    expect(screen.getByText('5')).toBeTruthy()
  })

  it('shows one empty state with quick-add, not six empty group headers, when there are no todos at all', async () => {
    renderTodos({ openTasks: [], waitingTasks: [], countOpen: 0 })
    await waitFor(() => expect(screen.getByText(/No todos yet/)).toBeTruthy())

    expect(screen.queryByRole('heading', { name: 'Overdue' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'This week' })).toBeNull()
    expect(screen.getByPlaceholderText('Add a todo')).toBeTruthy()
  })

  it('every quick-add input, completion checkbox and the grouping toggle are native, keyboard-reachable controls', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    const groupToggle = screen.getByRole('button', { name: 'By client' })
    expect(groupToggle.tagName).toBe('BUTTON')

    const row = screen.getByText('Send the countersigned SOW').closest('.todo')
    if (!row) throw new Error('row not found')
    const checkButton = within(row as HTMLElement).getByRole('button', { name: /Mark .* done/ })
    expect(checkButton.tagName).toBe('BUTTON')

    const quickAddInputs = screen.getAllByPlaceholderText(/^Add a todo/)
    expect(quickAddInputs.length).toBeGreaterThan(0)
    for (const input of quickAddInputs) expect(input.tagName).toBe('INPUT')
  })

  it('a company link on a row navigates to that company\'s detail route', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'EZDeploy' }))
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('ezdeploy'))
  })

  it('a person link on a row navigates to that person\'s detail route', async () => {
    renderTodos()
    await waitFor(() => expect(screen.getByText('Waiting on Ben for the scope')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Ben Thompson' }))
    await waitFor(() => expect(screen.getByTestId('person-detail').textContent).toBe('ben'))
  })

  it('rolls the grouping back to the stored value when settings:set fails (T-260901-28)', async () => {
    // The rollback half of the optimistic write. Modelled on Companies.tsx's
    // own test, including the trick that makes it real: `settings:get`
    // answers 'date' once and then never resolves, so the reconciling
    // refetch cannot paper over a missing `onError` — the only thing that
    // can put "By date" back on screen is the rollback itself.
    let getCalls = 0
    const settingsGet = vi.fn(async () => {
      getCalls += 1
      if (getCalls === 1) return { ok: true as const, data: { key: 'view.todos.groupBy' as const, value: 'date' as const } }
      return new Promise<never>(() => {})
    })
    const settingsSet = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'handler-error' as const, message: 'disk is read-only' }
    }))
    renderTodos({ crmOverrides: { 'settings:get': settingsGet, 'settings:set': settingsSet } })
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'By client' }))

    // The click really did ask main to store 'client' — the toggle is back
    // on "By date" because the write failed, not because nothing happened.
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.todos.groupBy', value: 'client' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'By date' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'By client' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('persists the grouping choice through settings:set', async () => {
    const settingsSet = vi.fn(async (entry: SettingEntry) => ({ ok: true as const, data: { ok: true as const, data: entry } }))
    renderTodos({ crmOverrides: { 'settings:set': settingsSet } })
    await waitFor(() => expect(screen.getByText('Send the countersigned SOW')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'By client' }))
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.todos.groupBy', value: 'client' }))
  })
})
