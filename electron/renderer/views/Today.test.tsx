import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { Today } from './Today'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { queryKeys } from '../lib/query-keys'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { Company } from '../../shared/companies'
import type { EngagementWithOffering } from '../../shared/engagements'
import type { Person } from '../../shared/people'
import type { Task, TaskFilter } from '../../shared/tasks'
import type { Activity } from '../../shared/activity'
import type { SettingsSnapshot } from '../../shared/settings'
import type { RevenueSummary } from '../../shared/revenue'

/**
 * T-260829-14's acceptance, as checks.
 *
 * The two assertions this file exists for, above the rest:
 *
 * - **Going quiet sorts by ratio, not raw days** (P2-04's first criterion).
 *   `sortsByRatio` below states a case where the day counts and the ratios
 *   disagree, so a comparator that reads `days` passes nothing.
 * - **Nothing on the page is a number this view re-derived.** Open todos
 *   comes from `tasks:countOpen`, and the test for it deliberately hands the
 *   channel a count that does not match the list length so a `tasks.length`
 *   shortcut is visible rather than accidentally right.
 */

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const DAY_MS = 86_400_000

/** An ISO instant `days` whole days before now — decay is instant arithmetic (`lib/decay.ts`), so fixtures are built the same way rather than as calendar dates. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS - 60_000).toISOString()
}

/** The user's local calendar day, matching `todo-urgency.ts`'s `localToday()` — `due_on` is date-only and its boundary is the wall clock, not UTC. */
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function addDays(dateOnly: string, delta: number): string {
  const [year, month, day] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + delta)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

const TODAY = localToday()

function makeCompany(overrides: Partial<Company> & { id: string; name: string }): Company {
  return {
    kind: 'client',
    website: null,
    billsDirectly: true,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: 7,
    lastTouchAt: isoDaysAgo(1),
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

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

function makeEngagement(overrides: Partial<EngagementWithOffering> & { id: string; name: string }): EngagementWithOffering {
  return {
    billingCompanyId: null,
    clientCompanyId: null,
    offeringVersionId: null,
    agreedRateCents: null,
    offeringId: null,
    offeringName: null,
    billingModel: null,
    status: 'active',
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

function makeActivity(overrides: Partial<Activity> & { id: string; title: string }): Activity {
  return {
    occurredAt: isoDaysAgo(1),
    kind: 'note',
    body: null,
    companyId: null,
    personId: null,
    engagementId: null,
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function DetailStub({ testId }: { testId: string }) {
  const params = useParams()
  return <div data-testid={testId}>{params.id}</div>
}

interface RenderOptions {
  companies?: readonly Company[]
  openTasks?: readonly Task[]
  waitingTasks?: readonly Task[]
  countOpen?: number
  engagements?: readonly EngagementWithOffering[]
  people?: readonly Person[]
  activity?: readonly Activity[]
  crmOverrides?: Parameters<typeof stubCrm>[0]
}

function renderToday({
  companies = [makeCompany({ id: 'ezdeploy', name: 'EZDeploy' })],
  openTasks = [],
  waitingTasks = [],
  countOpen,
  engagements = [],
  people = [],
  activity = [],
  crmOverrides = {}
}: RenderOptions = {}) {
  // Stateful rather than fixed returns, matching Todos.test.tsx's own helper:
  // a completion's `onSettled` invalidates and refetches in the background,
  // and a fixed return would silently undo the write the test just made —
  // hiding a real regression behind the optimistic cache write alone.
  let currentOpen = [...openTasks]
  let currentCount = countOpen ?? openTasks.length

  window.crm = stubCrm({
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'tasks:list': vi.fn(async (filter?: TaskFilter) => {
      if (filter?.status === 'waiting') return { ok: true as const, data: waitingTasks }
      if (filter?.open) return { ok: true as const, data: currentOpen }
      return { ok: true as const, data: [...currentOpen, ...waitingTasks] }
    }),
    'tasks:countOpen': vi.fn(async () => ({ ok: true as const, data: { count: currentCount } })),
    'tasks:update': vi.fn(async (input: { id: string; patch: { status?: string | null } }) => {
      if (input.patch.status === 'done') {
        const wasOpen = currentOpen.some((task) => task.id === input.id)
        currentOpen = currentOpen.filter((task) => task.id !== input.id)
        if (wasOpen) currentCount = Math.max(0, currentCount - 1)
      }
      const task = openTasks.find((candidate) => candidate.id === input.id) ?? makeTask({ id: input.id, title: 'stub' })
      return { ok: true as const, data: { ok: true as const, data: { ...task, status: 'done' as const } } }
    }),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
    'activity:list': vi.fn(async () => ({ ok: true as const, data: activity })),
    ...crmOverrides
  })

  const queryClient = createQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <LayerManager>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/company/:id" element={<DetailStub testId="company-detail" />} />
            <Route path="/person/:id" element={<DetailStub testId="person-detail" />} />
            <Route path="/todos" element={<div data-testid="todos-view" />} />
          </Routes>
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, queryClient }
}

/** The `.card` a card's `<h2>` heading sits in — headings, not text, because "Revenue" is also the rail's nav label and a legend word. */
function card(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name })
  const found = heading.closest('.card')
  if (!found) throw new Error(`"${name}" card not found`)
  return found as HTMLElement
}

/** The `.row` buttons inside a card, in DOM order. */
function rowTexts(cardEl: HTMLElement): string[] {
  return [...cardEl.querySelectorAll('button.row')].map((row) => row.textContent ?? '')
}

describe('Today', () => {
  it('renders the header, §6.1’s four stats and four cards — and, with nothing recognised, no money figure at all', async () => {
    renderToday({
      companies: [makeCompany({ id: 'ezdeploy', name: 'EZDeploy' })],
      openTasks: [makeTask({ id: 't1', title: 'Send the SOW', dueOn: addDays(TODAY, -1) })],
      countOpen: 4,
      engagements: [makeEngagement({ id: 'e1', name: 'Retainer', status: 'active' })],
      activity: [makeActivity({ id: 'a1', title: 'Kickoff call', kind: 'call' })]
    })

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
    // The whole page has one loading state and one error state (Today.tsx),
    // so waiting on any card is waiting on all nine queries.
    await screen.findByRole('heading', { name: 'Going quiet' })
    for (const label of ['Recurring / month', 'Fixed backlog', 'Open todos', 'Cadence health']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    for (const heading of ['Revenue', 'Going quiet', 'Next up', 'Recent']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    }

    // ui-design.md: "gold marks exactly one hero value per view".
    expect(document.querySelectorAll('.stat.hero')).toHaveLength(1)

    // The stub's `revenue:summary` answers `lineCount: 0`: nothing has been
    // recognised, and the honest reading of that is a dash, not `$0`. The
    // engagement above is active, and there is still no dollar figure —
    // the page derives nothing from engagement columns (ADR-003).
    expect(document.body.textContent).not.toContain('$')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(within(card('Revenue')).getByText(/nothing recognised yet/i)).toBeTruthy()
  })

  it('the two money stats and the chart read revenue:summary as it came — no arithmetic over engagement columns', async () => {
    renderToday({
      // Two engagements with every price column set, and NONE of those
      // numbers is what the page shows: the summary is the source.
      engagements: [
        makeEngagement({ id: 'e1', name: 'A', status: 'active', billingModel: 'retainer', retainerBasis: 'amount', monthlyAmountCents: 999_999 }),
        makeEngagement({ id: 'e2', name: 'B', status: 'active', billingModel: 'fixed', contractValueCents: 777_777 })
      ],
      crmOverrides: {
        'revenue:summary': vi.fn(async () => ({
          ok: true as const,
          data: {
            currentMonth: '2026-09-01',
            yearStart: '2026-01-01',
            lineCount: 3,
            metrics: {
              recurringMonthCents: 830_000,
              recurringEngagements: 2,
              recurringNextYearCents: 9_960_000,
              backlogCents: 720_000,
              backlogMilestones: 2,
              tmMonthCents: 495_000,
              concentration: { share: 0.34, name: 'Rinvii', payers: [{ name: 'Rinvii', cents: 1, share: 1 }] }
            },
            window: { from: '2026-06-01', to: '2027-05-01' },
            series: [
              { periodMonth: '2026-08-01', kind: 'retainer' as const, status: 'actual' as const, cents: 830_000 },
              { periodMonth: '2026-09-01', kind: 'retainer' as const, status: 'projected' as const, cents: 830_000 },
              { periodMonth: '2026-09-01', kind: 'milestone' as const, status: 'projected' as const, cents: 360_000 }
            ],
            rollups: { billing: [], client: [], model: [] },
            totals: { monthlyCents: 0, backlogCents: 0, ytdCents: 0 }
          }
        }))
      }
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const recurring = screen.getByText('Recurring / month').closest('.stat') as HTMLElement
    expect(within(recurring).getByText('$8,300')).toBeTruthy()
    expect(recurring.textContent).toContain('2 retainers · $99,600 next 12 mo')
    expect(recurring.classList.contains('hero')).toBe(true)

    const backlog = screen.getByText('Fixed backlog').closest('.stat') as HTMLElement
    expect(within(backlog).getByText('$7,200')).toBeTruthy()
    expect(backlog.textContent).toContain('2 unbilled milestones')

    // Neither engagement column value is anywhere on the page.
    expect(document.body.textContent).not.toContain('9,999.99')
    expect(document.body.textContent).not.toContain('7,777.77')

    // The chart drew the three points: one actual (solid), two projected (dashed).
    const chart = within(card('Revenue')).getByRole('img', { name: /Recognised revenue by month/ })
    expect(chart.querySelectorAll('rect.revchart-seg.actual')).toHaveLength(1)
    expect(chart.querySelectorAll('rect.revchart-seg.projected')).toHaveLength(2)
  })

  it('a failing revenue:summary does not take the dashboard down — the tiles read a dash and the card says what happened', async () => {
    renderToday({
      openTasks: [makeTask({ id: 't1', title: 'Still here' })],
      crmOverrides: {
        'revenue:summary': vi.fn(async () => ({ ok: false as const, error: { code: 'invalid-response' as const, message: 'revenue_lines row 7 has a bad period_month' } }))
      }
    })
    await screen.findByRole('heading', { name: 'Going quiet' })
    expect(screen.getByText('Still here')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(within(card('Revenue')).getByText(/bad period_month/)).toBeTruthy()
  })

  it('Going quiet sorts by ratio, not raw days', async () => {
    // The scope's own example is a `channel` (cadence 30) 20 days quiet
    // beside a `client` (cadence 7) 9 days quiet. 20/30 is 0.67 — `warn`,
    // not `late` — so that channel is not in this list at all, which is
    // itself the per-relationship point and is asserted below. For the
    // *ordering* the channel has to be late too, so it is 35 days quiet
    // (1.17) against the client's 9 days (1.29): the client is more overdue
    // on a quarter of the day count.
    renderToday({
      companies: [
        makeCompany({ id: 'chan', name: 'Channel Partners', kind: 'channel', cadenceDays: 30, lastTouchAt: isoDaysAgo(35) }),
        makeCompany({ id: 'client', name: 'Rinvii', kind: 'client', cadenceDays: 7, lastTouchAt: isoDaysAgo(9) }),
        makeCompany({ id: 'fine', name: 'Slow Channel', kind: 'channel', cadenceDays: 30, lastTouchAt: isoDaysAgo(20) })
      ]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const rows = rowTexts(card('Going quiet'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Rinvii')
    expect(rows[1]).toContain('Channel Partners')
    // 20 days on a 30-day cadence is not late — a global day threshold would
    // have listed it ahead of the 9-day client.
    expect(rows.join(' ')).not.toContain('Slow Channel')
  })

  it('a never-touched company renders at the top of Going quiet, determinate and with no NaN', async () => {
    renderToday({
      companies: [
        makeCompany({ id: 'client', name: 'Rinvii', cadenceDays: 7, lastTouchAt: isoDaysAgo(9) }),
        makeCompany({ id: 'new', name: 'Untouched Co', cadenceDays: 7, lastTouchAt: null })
      ]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const quiet = card('Going quiet')
    const rows = rowTexts(quiet)
    expect(rows[0]).toContain('Untouched Co')

    // ADR-001 rule 5 / P2-04: maximally stale, drawn as a full late bar with
    // a real label — never a blank, never a NaN.
    const meter = quiet.querySelector('button.row .decay')
    expect(meter?.className).toContain('late')
    expect(meter?.textContent).toContain('never')
    expect(quiet.querySelector('button.row .decay .fill')?.getAttribute('style')).toContain('100%')
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('with no companies it renders the three first-run steps, not four zero stats', async () => {
    renderToday({ companies: [] })

    expect(await screen.findByRole('heading', { name: 'Start here' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a company' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a person' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open an engagement' })).toBeTruthy()

    expect(screen.queryByText('Cadence health')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Going quiet' })).toBeNull()
    expect(document.querySelectorAll('.stat')).toHaveLength(0)
  })

  it('the first-run "Add a company" step opens the company create sheet', async () => {
    renderToday({ companies: [] })

    fireEvent.click(await screen.findByRole('button', { name: 'Add a company' }))
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
  })

  it('with companies present but none late, Going quiet says everyone is current', async () => {
    renderToday({
      companies: [
        makeCompany({ id: 'a', name: 'EZDeploy', cadenceDays: 14, lastTouchAt: isoDaysAgo(1) }),
        makeCompany({ id: 'b', name: 'Rinvii', cadenceDays: 30, lastTouchAt: isoDaysAgo(3) })
      ]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const quiet = card('Going quiet')
    expect(within(quiet).getByText('Everyone is current.')).toBeTruthy()
    expect(rowTexts(quiet)).toHaveLength(0)
  })

  it('every Going quiet row navigates to /company/:id for that company', async () => {
    renderToday({
      companies: [makeCompany({ id: 'rinvii', name: 'Rinvii', cadenceDays: 7, lastTouchAt: isoDaysAgo(30) })]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const [row] = [...card('Going quiet').querySelectorAll('button.row')]
    fireEvent.click(row)
    expect((await screen.findByTestId('company-detail')).textContent).toBe('rinvii')
  })

  it('a Going quiet row shows the company’s next-step todo as its subtitle, its cadence when it has none', async () => {
    renderToday({
      companies: [
        makeCompany({ id: 'rinvii', name: 'Rinvii', cadenceDays: 7, lastTouchAt: isoDaysAgo(30) }),
        makeCompany({ id: 'ez', name: 'EZDeploy', cadenceDays: 14, lastTouchAt: isoDaysAgo(30) })
      ],
      openTasks: [
        makeTask({ id: 'ns', title: 'Send the renewal quote', isNextStep: true, companyId: 'rinvii', dueOn: addDays(TODAY, 1) })
      ]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const rows = rowTexts(card('Going quiet'))
    expect(rows.find((row) => row.includes('Rinvii'))).toContain('Send the renewal quote')
    expect(rows.find((row) => row.includes('EZDeploy'))).toContain('every 14d')
  })

  it('Next up shows the five most urgent open todos, most overdue first', async () => {
    renderToday({
      companies: [makeCompany({ id: 'ez', name: 'EZDeploy' })],
      openTasks: [
        makeTask({ id: 't-soon', title: 'Due tomorrow', dueOn: addDays(TODAY, 1) }),
        makeTask({ id: 't-worst', title: 'Very overdue', dueOn: addDays(TODAY, -9) }),
        makeTask({ id: 't-bad', title: 'A bit overdue', dueOn: addDays(TODAY, -2) }),
        makeTask({ id: 't-none', title: 'No date at all', dueOn: null }),
        makeTask({ id: 't-later-1', title: 'Later one', dueOn: addDays(TODAY, 20) }),
        makeTask({ id: 't-later-2', title: 'Later two', dueOn: addDays(TODAY, 30) })
      ]
    })

    await screen.findByRole('heading', { name: 'Next up' })
    const titles = [...card('Next up').querySelectorAll('.todo .tx')].map((el) => el.textContent ?? '')
    expect(titles).toHaveLength(5)
    expect(titles[0]).toContain('Very overdue')
    expect(titles[1]).toContain('A bit overdue')
    expect(titles[2]).toContain('Due tomorrow')
    // `sortByDue` puts an undated task after every dated one, so with six
    // open todos the one with no date is the row that does not make the cut
    // — not the furthest-future one.
    expect(titles.join(' ')).not.toContain('No date at all')
    expect(titles[4]).toContain('Later two')
  })

  it('Open todos comes from tasks:countOpen, not from the length of the Next up slice', async () => {
    renderToday({
      companies: [makeCompany({ id: 'ez', name: 'EZDeploy' })],
      openTasks: [makeTask({ id: 't1', title: 'One', dueOn: addDays(TODAY, -1) })],
      waitingTasks: [makeTask({ id: 'w1', title: 'Waiting', status: 'waiting', waitingSince: isoDaysAgo(3) })],
      // Deliberately not 1: the server's definition of "open" is the only
      // source for this stat (T-260828-23), so a `tasks.length` shortcut
      // would read 1 here rather than 17.
      countOpen: 17
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const stat = screen.getByText('Open todos').closest('.stat') as HTMLElement
    expect(within(stat).getByText('17')).toBeTruthy()
    expect(stat.textContent).toContain('1 overdue · 1 waiting')
  })


  /**
   * The two tests below were added by the orchestrator at merge
   * (R-260829-03), not by the builder. Mutation testing found that a stat
   * *value* and the sort's tiebreak were unasserted: the opening test checks
   * that each stat's label is on the page, and `Open todos` has the
   * dedicated test above, but `Cadence health` could have read any number at
   * all. Mutants passed all fifteen tests — `companies.length -
   * quiet.length` → `companies.length`, and dropping the name tiebreak from
   * `byPctDescending`. The scope's acceptance asked that four stats
   * *render*, which they did; that was the criterion being too weak, not
   * the builder skipping it. (A third test, for the "Active engagements"
   * stat, went with that stat when T-260902-05 restored §6.1's money tiles
   * in its place; `Companies.tsx` still owns the `=== 'active'` predicate.)
   */

  it('Cadence health counts the companies that are current, not all of them', async () => {
    renderToday({
      companies: [
        // 9 days quiet against a 7-day cadence: 1.29, late.
        makeCompany({ id: 'late-1', name: 'Aardvark', kind: 'client', cadenceDays: 7, lastTouchAt: isoDaysAgo(9) }),
        // 3 of 30: current, and comfortably so.
        makeCompany({ id: 'ok-1', name: 'Basilisk', kind: 'channel', cadenceDays: 30, lastTouchAt: isoDaysAgo(3) }),
        makeCompany({ id: 'ok-2', name: 'Cormorant', kind: 'channel', cadenceDays: 30, lastTouchAt: isoDaysAgo(3) })
      ]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    const stat = screen.getByText('Cadence health').closest('.stat') as HTMLElement

    // 2, not 3. A stat that ignored `quiet` would read the company count.
    expect(within(stat).getByText('2')).toBeTruthy()
    expect(stat.textContent).toContain('of 3 current')
  })

  it('breaks a tie in Going quiet by name, so equally overdue companies hold their order', async () => {
    // Identical cadence and identical last touch: `pct` is exactly equal, so
    // the comparator's first branch is the only thing deciding the order.
    // Without the tiebreak this is `b.pct - a.pct` returning 0 for every
    // pair, and Array#sort's behaviour on a comparator that never
    // discriminates is not a promise the language makes — "ordering on a
    // non-unique column with no tiebreaker" is on `.dev/README.md`'s own
    // list of defects this project has shipped before.
    const quiet = { kind: 'client' as const, cadenceDays: 7, lastTouchAt: isoDaysAgo(21) }
    renderToday({
      companies: [
        makeCompany({ id: 'c-3', name: 'Zebra Industries', ...quiet }),
        makeCompany({ id: 'c-1', name: 'Aardvark Systems', ...quiet }),
        makeCompany({ id: 'c-2', name: 'Marmot Consulting', ...quiet })
      ]
    })

    await screen.findByRole('heading', { name: 'Going quiet' })
    // `.nm` rather than the row's whole text, which leads with the company
    // mark's initials.
    const names = [...card('Going quiet').querySelectorAll('.nm')].map((el) => el.textContent ?? '')

    expect(names).toEqual(['Aardvark Systems', 'Marmot Consulting', 'Zebra Industries'])
  })
  it('completing a todo in Next up removes it from the card and decrements the Open todos stat', async () => {
    renderToday({
      companies: [makeCompany({ id: 'ez', name: 'EZDeploy' })],
      openTasks: [
        makeTask({ id: 't1', title: 'Send the SOW', dueOn: addDays(TODAY, -1) }),
        makeTask({ id: 't2', title: 'Book the review', dueOn: addDays(TODAY, 1) })
      ],
      countOpen: 2
    })

    await screen.findByRole('heading', { name: 'Next up' })
    const stat = screen.getByText('Open todos').closest('.stat') as HTMLElement
    expect(within(stat).getByText('2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Mark "Send the SOW" done' }))

    await waitFor(() => expect(screen.queryByText('Send the SOW')).toBeNull())
    // Not just the optimistic write: the refetch `onSettled` triggers reads
    // the stub's own decremented count, so a view that drifted from the
    // channel would snap back to 2 here.
    await waitFor(() => expect(within(stat).getByText('1')).toBeTruthy())
    expect(screen.getByText('Book the review')).toBeTruthy()
  })

  it('a failed companies:list shows the error, not the fresh-workspace card', async () => {
    renderToday({
      companies: [],
      crmOverrides: {
        'companies:list': vi.fn(async () => ({
          ok: false as const,
          error: { code: 'handler-error' as const, message: 'database is locked' }
        }))
      }
    })

    expect(await screen.findByText('database is locked')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a company' })).toBeNull()
  })

  it('the Recent card lists the newest activity and opens the quick log', async () => {
    renderToday({
      companies: [makeCompany({ id: 'ez', name: 'EZDeploy' })],
      activity: [
        makeActivity({ id: 'a1', title: 'Kickoff call', kind: 'call', companyId: 'ez' }),
        makeActivity({ id: 'a2', title: 'Follow-up email', kind: 'email' })
      ]
    })

    await screen.findByRole('heading', { name: 'Recent' })
    const recent = card('Recent')
    expect(within(recent).getByText('Kickoff call')).toBeTruthy()
    expect(within(recent).getByText('Follow-up email')).toBeTruthy()

    fireEvent.click(within(recent).getByRole('button', { name: 'Add a touch' }))
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('the header’s Log a touch button opens the quick log, and Next up links to /todos', async () => {
    renderToday({ companies: [makeCompany({ id: 'ez', name: 'EZDeploy' })] })

    await screen.findByRole('heading', { name: 'Next up' })
    fireEvent.click(screen.getByRole('button', { name: 'All todos' }))
    expect(await screen.findByTestId('todos-view')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// §8 / P2-04's budget, in the shape of CommandPalette.latency.test.tsx: the
// view renders at 10x the requirements' reference volume in under 100ms.
//
// The measurement is of the view's own render, against a query cache already
// holding every answer — which is exactly what the budget is about. The IPC
// round trips are not this view's work and are measured where they happen
// (`search.latency.test.ts` and the repository suites); what this file owns
// is the cost of turning ~2,100 cached records into the page, including the
// decay computation for every company and the sort over every late one.
//
// On an idle 8-core Windows machine (jsdom, median of 5 renders after 2
// warm-ups) this measures 52ms against the 100ms budget — a margin of about
// 2x, which the run prints so a merely close pass is visible in the output
// rather than only in a failure. jsdom is strictly slower at DOM work than a
// real renderer, so a comfortable pass here is not hiding a real-browser
// failure; the margin is also what keeps a loaded machine from turning this
// into a false failure.
// ---------------------------------------------------------------------------

/**
 * The seed's own ten companies as `[cadenceDays, days since last touch]` —
 * `planning/solo-crm-mockup.html`'s `companies` array measured against its
 * own `TODAY` (2026-08-27), which `electron/main/db/seed/fixture.ts` ports
 * verbatim. Four of the ten are late (`programetrix` 99/30, `radial` 28/21,
 * `northbank` 74/30, `thompson` 50/14), three are `warn` and three are `ok`.
 *
 * Cycling these is what makes 100 companies a faithful *10x of the seed*
 * rather than a workspace shape nobody has: it reproduces the seed's own
 * 40% late proportion, so "Going quiet" draws about forty rows. Giving every
 * company the same short cadence would put ninety-odd rows in one card and
 * measure a page the app does not produce.
 */
const SEED_CADENCE_AND_TOUCH: ReadonlyArray<readonly [number, number]> = [
  [7, 1],
  [7, 2],
  [10, 8],
  [14, 8],
  [30, 99],
  [21, 28],
  [7, 6],
  [21, 16],
  [30, 74],
  [14, 50]
]

const COMPANY_COUNT = 100
const PERSON_COUNT = 1_000
const ENGAGEMENT_COUNT = 500
const TASK_COUNT = 500
const ACTIVITY_COUNT = 500

/** §8's first-paint budget, in milliseconds. */
const BUDGET_MS = 100
const WARMUP_RENDERS = 2
const MEASURED_RENDERS = 5
// Building the fixture once and rendering it seven times is under a second on
// an idle machine. This is a hang guard, not the performance assertion — the
// assertion is the median below, which a loaded machine slows without breaking.
const TEST_TIMEOUT_MS = 30_000

function rows<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => make(index))
}

describe('Today at 10x data volume', () => {
  it(
    'renders inside the frame budget',
    async () => {
      const settingsResult = await stubCrm()['settings:getAll']()
      if (!settingsResult.ok) throw new Error('stub settings snapshot unavailable')
      const settings: SettingsSnapshot = settingsResult.data

      const companies = rows(COMPANY_COUNT, (index) => {
        const [cadenceDays, daysQuiet] = SEED_CADENCE_AND_TOUCH[index % SEED_CADENCE_AND_TOUCH.length]
        return makeCompany({
          id: `company-${index}`,
          name: `Acme Company ${index}`,
          cadenceDays,
          lastTouchAt: isoDaysAgo(daysQuiet)
        })
      })
      const people = rows(PERSON_COUNT, (index) => makePerson({ id: `person-${index}`, name: `Acme Person ${index}` }))
      const engagements = rows(ENGAGEMENT_COUNT, (index) =>
        makeEngagement({ id: `engagement-${index}`, name: `Acme Engagement ${index}` })
      )
      const tasks = rows(TASK_COUNT, (index) =>
        makeTask({
          id: `task-${index}`,
          title: `Acme todo ${index} — about the length a real one has`,
          dueOn: addDays(TODAY, (index % 30) - 15),
          companyId: `company-${index % COMPANY_COUNT}`
        })
      )
      const activity = rows(ACTIVITY_COUNT, (index) =>
        makeActivity({
          id: `activity-${index}`,
          title: `Acme touch ${index}`,
          companyId: `company-${index % COMPANY_COUNT}`
        })
      )

      // The revenue summary at the same scale (T-260902-06): every month of
      // the window carrying all three stacks in both statuses — the fullest
      // chart the page can draw — and a rollup row per company, which Today
      // does not render but the payload carries.
      const months = rows(12, (index) => `${2026 + Math.floor((5 + index) / 12)}-${String(((5 + index) % 12) + 1).padStart(2, '0')}-01`)
      const revenue: RevenueSummary = {
        currentMonth: months[3],
        yearStart: '2026-01-01',
        lineCount: 5_000,
        metrics: {
          recurringMonthCents: 8_300_000,
          recurringEngagements: 20,
          recurringNextYearCents: 99_600_000,
          backlogCents: 7_200_000,
          backlogMilestones: 20,
          tmMonthCents: 4_950_000,
          concentration: { share: 0.34, name: 'Acme Company 0', payers: rows(COMPANY_COUNT, (index) => ({ name: `Acme Company ${index}`, cents: 100, share: 0.01 })) }
        },
        window: { from: months[0], to: months[11] },
        series: months.flatMap((periodMonth) =>
          (['retainer', 'milestone', 'tm'] as const).flatMap((kind) =>
            (['projected', 'actual'] as const).map((status) => ({ periodMonth, kind, status, cents: 100_000 }))
          )
        ),
        rollups: {
          billing: rows(COMPANY_COUNT, (index) => ({
            key: `company-${index}`,
            name: `Acme Company ${index}`,
            model: null,
            companyId: `company-${index}`,
            via: null,
            engagementCount: 5,
            monthlyCents: 100_000,
            backlogCents: 50_000,
            ytdCents: 900_000,
            ytdShare: 0.01
          })),
          client: [],
          model: []
        },
        totals: { monthlyCents: 10_000_000, backlogCents: 5_000_000, ytdCents: 90_000_000 }
      }

      window.crm = stubCrm()

      // Built once, outside every timed region, and reused: `staleTime` is
      // Infinity (query-client.ts) so a remount reads the cache rather than
      // refetching, and priming it is fixture setup, not the view's work.
      const client: QueryClient = createQueryClient()
      client.setQueryData(queryKeys.companies.list(), companies)
      client.setQueryData(queryKeys.tasks.openList(), tasks)
      client.setQueryData(queryKeys.tasks.waitingList(), [])
      client.setQueryData(queryKeys.tasks.countOpen(), { count: tasks.length })
      client.setQueryData(queryKeys.engagements.list(), engagements)
      client.setQueryData(queryKeys.people.list(), people)
      client.setQueryData(queryKeys.activity.list(), activity)
      client.setQueryData(queryKeys.settings.list(), settings)
      client.setQueryData(queryKeys.revenue.summary(), revenue)

      function renderOnce() {
        return render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/']}>
              <LayerManager>
                <Today />
              </LayerManager>
            </MemoryRouter>
          </QueryClientProvider>
        )
      }

      // Proves the measurement below is of the real page, not of a loading
      // paragraph — a primed cache renders content on the first pass.
      const warmup = renderOnce()
      expect(screen.getByRole('heading', { name: 'Going quiet' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Next up' })).toBeTruthy()
      // The chart drew every cell: 12 months x 3 stacks x 2 statuses.
      expect(document.querySelectorAll('rect.revchart-seg')).toHaveLength(72)
      // Without this the fixture could quietly stop producing late companies
      // and the budget below would pass over an empty card — a fast render of
      // nothing. Forty of the hundred are late, the seed's own proportion.
      expect(rowTexts(card('Going quiet')).length).toBe(40)
      warmup.unmount()

      for (let i = 0; i < WARMUP_RENDERS; i++) renderOnce().unmount()

      const timings: number[] = []
      for (let i = 0; i < MEASURED_RENDERS; i++) {
        const started = performance.now()
        const view = renderOnce()
        timings.push(performance.now() - started)
        view.unmount()
      }
      timings.sort((a, b) => a - b)
      const median = timings[Math.floor(timings.length / 2)]

      console.log(`[today] median render at 10x volume: ${median.toFixed(2)}ms of a ${BUDGET_MS}ms budget`)
      expect(median).toBeLessThan(BUDGET_MS)
    },
    TEST_TIMEOUT_MS
  )
})
