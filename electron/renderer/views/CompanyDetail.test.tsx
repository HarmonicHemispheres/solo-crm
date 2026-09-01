import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { CrmApi } from '../../shared/ipc-types'
import type { Company } from '../../shared/companies'
import type { EngagementWithOffering } from '../../shared/engagements'
import type { Task } from '../../shared/tasks'
import type { Activity } from '../../shared/activity'
import type { Person, PersonAffiliation } from '../../shared/people'
import { CompanyDetail } from './CompanyDetail'

// This file is typechecked under tsconfig.web.json (no `@types/node`), but a
// few tests below deliberately flip `process.env.TZ` to exercise a genuine
// non-UTC local timezone — the same technique electron/main/shared-
// conventions.test.ts uses under tsconfig.node.json, where `process` is
// already typed. Vitest itself always runs in a real Node process
// regardless of the jsdom `environment` a test project sets, so this global
// exists at runtime; it just isn't declared for this tsconfig, hence the
// narrow ambient type below rather than pulling in Node's full type surface.
declare const process: { env: Record<string, string | undefined> }

/**
 * The directional-split assertions this task's own Risks section asks for
 * first, before any rendering code: rendering "billed here" and "delivered
 * here, billed elsewhere" from one query with the filter direction backwards
 * produces a page that still looks entirely plausible — these two tests
 * (EZDeploy / W+K, mirroring the real dev-seed fixture's `ezdeploy` /
 * `wk` / `e4` — electron/main/db/seed/fixture.ts) are what actually catches
 * that bug.
 */

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

// -- fixture: EZDeploy bills W+K and Programetrix for work delivered to
// them, and bills itself for its own platform advisory. Rinvii bills and
// is delivered to by itself alone. Lonely Co has no engagements at all. --

const ezdeploy = makeCompany({ id: 'co-ezdeploy', name: 'EZDeploy', kind: 'client', website: 'ezdeploy.io', cadenceDays: 10, since: '2026-02-01' })
const wk = makeCompany({
  id: 'co-wk',
  name: 'W+K',
  kind: 'end_client',
  billedViaCompanyId: 'co-ezdeploy',
  cadenceDays: 14,
  budgetNote: '$18,000 approved',
  since: '2026-02-01'
})
const programetrix = makeCompany({
  id: 'co-programetrix',
  name: 'Programetrix',
  kind: 'end_client',
  billedViaCompanyId: 'co-ezdeploy',
  cadenceDays: 30,
  since: '2026-04-01'
})
const rinvii = makeCompany({ id: 'co-rinvii', name: 'Rinvii', kind: 'client', cadenceDays: 7, since: '2026-03-01' })
const lonely = makeCompany({ id: 'co-lonely', name: 'Lonely Co', kind: 'prospect', cadenceDays: 14 })

const samay = makeEngagement({
  id: 'eng-samay',
  name: 'Samay — AI timesheet agent',
  billingCompanyId: 'co-ezdeploy',
  clientCompanyId: 'co-wk',
  billingModel: 'fixed',
  status: 'active',
  startedOn: '2026-02-10',
  endsOn: '2026-10-15'
})
const progAudit = makeEngagement({
  id: 'eng-prog',
  name: 'Programetrix agents audit',
  billingCompanyId: 'co-ezdeploy',
  clientCompanyId: 'co-programetrix',
  billingModel: 'fixed',
  status: 'delivered',
  startedOn: '2026-04-01',
  endsOn: '2026-05-20'
})
const platform = makeEngagement({
  id: 'eng-platform',
  name: 'Platform advisory',
  billingCompanyId: 'co-ezdeploy',
  clientCompanyId: 'co-ezdeploy',
  billingModel: 'tm',
  status: 'active',
  startedOn: '2026-05-01',
  endsOn: null
})
const rinviiRetainer = makeEngagement({
  id: 'eng-rinvii',
  name: 'Advisory + development retainer',
  billingCompanyId: 'co-rinvii',
  clientCompanyId: 'co-rinvii',
  billingModel: 'retainer',
  status: 'active',
  startedOn: '2026-03-01',
  endsOn: null
})

const ALL_COMPANIES = [ezdeploy, wk, programetrix, rinvii, lonely]
const ALL_ENGAGEMENTS = [samay, progAudit, platform, rinviiRetainer]

// -- T-260828-30 fixtures: todos, activity and contacts. `dana` is EZDeploy's
// current primary contact; `casey` left EZDeploy for W+K, so she is
// historical at one and current at the other — the case Acceptance's
// "visibly historical, solely under the disclosure" targets directly. --

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
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeActivity(overrides: Partial<Activity> & { id: string; title: string }): Activity {
  return {
    occurredAt: TS,
    kind: 'note',
    body: null,
    companyId: null,
    personId: null,
    engagementId: null,
    source: 'manual',
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makePerson(overrides: Partial<Person> & { id: string; name: string }): Person {
  return { email: null, phone: null, notes: null, lastContactAt: null, createdAt: TS, updatedAt: TS, ...overrides }
}

function makeAffiliation(overrides: Partial<PersonAffiliation> & { id: string; personId: string; companyId: string }): PersonAffiliation {
  return { title: null, isPrimary: null, started: '2026-01-01', ended: null, current: true, createdAt: TS, updatedAt: TS, ...overrides }
}

const dana = makePerson({ id: 'per-dana', name: 'Dana Kwan' })
const casey = makePerson({ id: 'per-casey', name: 'Casey Ito' })

const danaAtEzdeploy = makeAffiliation({ id: 'aff-dana-ez', personId: 'per-dana', companyId: 'co-ezdeploy', title: 'CTO', isPrimary: true, current: true })
const caseyAtEzdeploy = makeAffiliation({
  id: 'aff-casey-ez',
  personId: 'per-casey',
  companyId: 'co-ezdeploy',
  title: 'Ops lead',
  started: '2026-01-01',
  ended: '2026-06-01',
  current: false
})
const caseyAtWk = makeAffiliation({ id: 'aff-casey-wk', personId: 'per-casey', companyId: 'co-wk', title: 'PM', current: true })

const ALL_PEOPLE = [dana, casey]
const AFFILIATIONS: Record<string, readonly PersonAffiliation[]> = {
  'per-dana': [danaAtEzdeploy],
  'per-casey': [caseyAtEzdeploy, caseyAtWk]
}

const followUp = makeTask({ id: 'task-followup', title: 'Follow up on renewal', companyId: 'co-ezdeploy' })
const sendInvoice = makeTask({ id: 'task-invoice', title: 'Send invoice', companyId: 'co-ezdeploy', isNextStep: true })

const directTouch = makeActivity({ id: 'act-direct', title: 'Quarterly check-in call', kind: 'call', companyId: 'co-ezdeploy', occurredAt: '2026-08-01T00:00:00.000Z' })
const danaEmail = makeActivity({ id: 'act-dana', title: 'Emailed Dana re: renewal', kind: 'email', personId: 'per-dana', occurredAt: '2026-08-10T00:00:00.000Z' })
const samayNote = makeActivity({ id: 'act-samay', title: 'Samay kickoff notes', kind: 'note', engagementId: 'eng-samay', occurredAt: '2026-02-10T00:00:00.000Z' })

interface CrmExtras {
  tasks?: readonly Task[]
  activity?: readonly Activity[]
  people?: readonly Person[]
  affiliations?: Record<string, readonly PersonAffiliation[]>
}

/** A stub `CrmApi` backed by mutable maps, so a mutation (`companies:update`,
 * `tasks:*`, `activity:log`) persists and a refetch (triggered by the
 * mutation's own `invalidate.<entity>`) reads back what was actually
 * written — the "verified by reading the row back" half of this task's
 * acceptance. `extras` is optional and defaults to nothing seeded, so every
 * pre-existing `buildCrm(companies, engagements)` call site above is
 * unchanged. */
function buildCrm(companySeed: readonly Company[], engagementSeed: readonly EngagementWithOffering[], extras: CrmExtras = {}): CrmApi {
  const companies = new Map(companySeed.map((c) => [c.id, c] as const))
  const tasks = new Map((extras.tasks ?? []).map((t) => [t.id, t] as const))
  const activity = new Map((extras.activity ?? []).map((a) => [a.id, a] as const))
  const people = new Map((extras.people ?? []).map((p) => [p.id, p] as const))
  const affiliationsByPerson = extras.affiliations ?? {}
  let nextTaskSeq = 0
  let nextActivitySeq = 0

  return stubCrm({
    'companies:get': vi.fn(async (payload) => ({ ok: true as const, data: companies.get(payload.id) ?? null })),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: Array.from(companies.values()) })),
    'companies:update': vi.fn(async (payload) => {
      const current = companies.get(payload.id)
      if (!current) {
        return { ok: true as const, data: { ok: false as const, error: { code: 'not-found' as const, message: 'not found' } } }
      }
      const updated: Company = { ...current, ...payload.patch, updatedAt: TS }
      companies.set(payload.id, updated)
      return { ok: true as const, data: { ok: true as const, data: updated } }
    }),
    'engagements:list': vi.fn(async (payload) => {
      let result = engagementSeed
      if (payload?.billingCompanyId != null) result = result.filter((e) => e.billingCompanyId === payload.billingCompanyId)
      if (payload?.clientCompanyId != null) result = result.filter((e) => e.clientCompanyId === payload.clientCompanyId)
      return { ok: true as const, data: result }
    }),
    'tasks:list': vi.fn(async (payload) => {
      let result = Array.from(tasks.values())
      if (payload?.companyId != null) result = result.filter((t) => t.companyId === payload.companyId)
      return { ok: true as const, data: result }
    }),
    'tasks:create': vi.fn(async (payload) => {
      const id = `task-new-${++nextTaskSeq}`
      const created: Task = makeTask({
        id,
        title: payload.title,
        status: payload.status ?? 'todo',
        dueOn: payload.dueOn ?? null,
        companyId: payload.companyId ?? null,
        engagementId: payload.engagementId ?? null,
        personId: payload.personId ?? null
      })
      tasks.set(id, created)
      return { ok: true as const, data: { ok: true as const, data: created } }
    }),
    'tasks:update': vi.fn(async (payload) => {
      const current = tasks.get(payload.id)
      if (!current) {
        return { ok: true as const, data: { ok: false as const, error: { code: 'not-found' as const, message: 'not found' } } }
      }
      const updated: Task = { ...current, ...payload.patch, updatedAt: TS }
      tasks.set(payload.id, updated)
      return { ok: true as const, data: { ok: true as const, data: updated } }
    }),
    'tasks:setNextStep': vi.fn(async (payload) => {
      const target = tasks.get(payload.id)
      if (!target) {
        return { ok: true as const, data: { ok: false as const, error: { code: 'not-found' as const, message: 'not found' } } }
      }
      // Mirrors the real repository's `setNextStep` transaction (T-260828-23):
      // clear every other open task in the same company before setting this
      // one — the invariant this task's Acceptance checks on screen.
      for (const [id, t] of tasks) {
        if (id !== target.id && t.companyId === target.companyId && t.isNextStep && t.status !== 'done') {
          tasks.set(id, { ...t, isNextStep: false, updatedAt: TS })
        }
      }
      const updated: Task = { ...target, isNextStep: true, updatedAt: TS }
      tasks.set(payload.id, updated)
      return { ok: true as const, data: { ok: true as const, data: updated } }
    }),
    'activity:list': vi.fn(async (payload) => {
      let result = Array.from(activity.values())
      if (payload?.companyId != null) result = result.filter((a) => a.companyId === payload.companyId)
      if (payload?.personId != null) result = result.filter((a) => a.personId === payload.personId)
      if (payload?.engagementId != null) result = result.filter((a) => a.engagementId === payload.engagementId)
      return { ok: true as const, data: result }
    }),
    'activity:log': vi.fn(async (payload) => {
      const id = `act-new-${++nextActivitySeq}`
      const created: Activity = makeActivity({
        id,
        title: payload.title,
        kind: payload.kind,
        body: payload.body,
        companyId: payload.companyId ?? null,
        personId: payload.personId ?? null,
        engagementId: payload.engagementId ?? null,
        source: payload.source,
        occurredAt: payload.occurredAt
      })
      activity.set(id, created)
      return { ok: true as const, data: { ok: true as const, data: created } }
    }),
    'people:list': vi.fn(async () => ({ ok: true as const, data: Array.from(people.values()) })),
    'people:get': vi.fn(async (payload) => {
      const person = people.get(payload.id)
      if (!person) return { ok: true as const, data: null }
      return { ok: true as const, data: { ...person, affiliations: affiliationsByPerson[payload.id] ?? [] } }
    })
  })
}

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assigns.
  delete window.crm
})

function renderCompanyDetail(companyId: string, crm: CrmApi) {
  window.crm = crm
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[`/company/${companyId}`]}>
        <Routes>
          <Route path="/company/:id" element={<CompanyDetail />} />
          <Route path="/companies" element={<div>Companies index</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CompanyDetail', () => {
  it('EZDeploy: shows the Samay build under "billed here" marked "for W+K", and lists W+K and Programetrix as end clients', async () => {
    renderCompanyDetail('co-ezdeploy', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'EZDeploy' })

    const billedCard = screen.getByText('Billed here').closest('.card') as HTMLElement
    expect(within(billedCard).getByText('Samay — AI timesheet agent')).toBeTruthy()
    expect(within(billedCard).getByText('for W+K')).toBeTruthy()
    expect(within(billedCard).getByText('Programetrix agents audit')).toBeTruthy()
    expect(within(billedCard).getByText('for Programetrix')).toBeTruthy()
    // Platform advisory bills and delivers to EZDeploy itself — no via marker.
    // Exactly the two cross-client rows above get a "for X" marker; the
    // same-company row does not.
    expect(within(billedCard).getByText('Platform advisory')).toBeTruthy()
    expect(within(billedCard).queryAllByText(/^for /)).toHaveLength(2)

    const endClientsCard = screen.getByText('End clients').closest('.card') as HTMLElement
    expect(within(endClientsCard).getByText('W+K')).toBeTruthy()
    expect(within(endClientsCard).getByText('Programetrix')).toBeTruthy()

    // Nothing bills to EZDeploy from elsewhere.
    const deliveredCard = screen.getByText('Delivered here, billed elsewhere').closest('.card') as HTMLElement
    expect(within(deliveredCard).getByText('Nothing here yet.')).toBeTruthy()
  })

  it('labels an engagement card with what it was sold as, and leaves an unsold one unlabelled', async () => {
    // The same "sold as" label the Engagements view carries (T-260901-13) —
    // these are the same cards, so the fact is asserted the same way.
    const sold = makeEngagement({
      ...samay,
      offeringVersionId: 'ver-build-1',
      offeringId: 'off-build',
      offeringName: 'Delivery build',
      agreedRateCents: 1_200_000
    })
    renderCompanyDetail('co-ezdeploy', buildCrm(ALL_COMPANIES, [sold, platform]))
    await screen.findByRole('heading', { name: 'EZDeploy' })

    const billedCard = screen.getByText('Billed here').closest('.card') as HTMLElement
    const soldRow = within(billedCard).getByText('Samay — AI timesheet agent').closest('.eng') as HTMLElement
    expect(soldRow.querySelector('.sold-as')?.textContent).toContain('sold as Delivery build')
    // No rate on the card, in either direction: not the agreed snapshot, not
    // a catalogue price (P3-03).
    expect(soldRow.textContent).not.toMatch(/12000|\$/)

    const unsoldRow = within(billedCard).getByText('Platform advisory').closest('.eng') as HTMLElement
    expect(unsoldRow.querySelector('.sold-as')).toBeNull()
  })

  it('W+K: shows that same engagement under "delivered here, billed to EZDeploy", with nothing billed here', async () => {
    renderCompanyDetail('co-wk', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'W+K' })

    const deliveredCard = screen.getByText('Delivered here, billed elsewhere').closest('.card') as HTMLElement
    expect(within(deliveredCard).getByText('Samay — AI timesheet agent')).toBeTruthy()
    expect(within(deliveredCard).getByText('billed to EZDeploy')).toBeTruthy()

    const billedCard = screen.getByText('Billed here').closest('.card') as HTMLElement
    expect(within(billedCard).getByText('Nothing here yet.')).toBeTruthy()

    expect(screen.queryByText('End clients')).toBeNull()
  })

  it('renders no via marker and no end-client section when billing and client are the same company', async () => {
    renderCompanyDetail('co-rinvii', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'Rinvii' })

    const billedCard = screen.getByText('Billed here').closest('.card') as HTMLElement
    expect(within(billedCard).getByText('Advisory + development retainer')).toBeTruthy()
    expect(within(billedCard).queryByText(/^for /)).toBeNull()
    expect(screen.queryByText('End clients')).toBeNull()
  })

  it('shows an empty state per section, not an end-clients panel, for a company with no engagements on either side', async () => {
    renderCompanyDetail('co-lonely', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'Lonely Co' })

    expect(screen.getByText('Billed here')).toBeTruthy()
    expect(screen.getByText('Delivered here, billed elsewhere')).toBeTruthy()
    expect(screen.queryByText('End clients')).toBeNull()
    expect(screen.getAllByText('Nothing here yet.')).toHaveLength(2)
  })

  it('renders a null endsOn as "rolling", never blank or a date', async () => {
    renderCompanyDetail('co-ezdeploy', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'EZDeploy' })

    expect(screen.getByText('May 26 → rolling')).toBeTruthy()
    // The Samay build has a real end date — never rendered as rolling.
    expect(screen.getByText('Feb 26 → Oct 26')).toBeTruthy()
  })

  it('shows "not found" for an unknown id, not a crash or an infinite spinner', async () => {
    renderCompanyDetail('co-does-not-exist', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    expect(await screen.findByText(/not found/i)).toBeTruthy()
  })

  it('following the billed-via link navigates to that company and its heading updates', async () => {
    renderCompanyDetail('co-wk', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'W+K' })

    fireEvent.click(screen.getByRole('link', { name: 'EZDeploy' }))

    expect(await screen.findByRole('heading', { name: 'EZDeploy' })).toBeTruthy()
  })

  it('editing a details-card field writes only that column, verified by reading the row back', async () => {
    const crm = buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS)
    renderCompanyDetail('co-ezdeploy', crm)
    await screen.findByRole('heading', { name: 'EZDeploy' })

    fireEvent.click(screen.getByRole('button', { name: 'ezdeploy.io' }))
    const input = screen.getByLabelText('Website')
    fireEvent.change(input, { target: { value: 'ezdeploy.dev' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(crm['companies:update']).toHaveBeenCalledWith({ id: 'co-ezdeploy', patch: { website: 'ezdeploy.dev' } })
    )
    // The card re-reads the row rather than trusting the optimistic edit —
    // the new value is what a fresh companies:get actually returned.
    await waitFor(() => expect(screen.getByRole('button', { name: 'ezdeploy.dev' })).toBeTruthy())
    // Every other column on the same row is untouched — kind is still Client.
    expect(screen.getByRole('button', { name: 'Client' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Escape cancels an in-progress edit without writing anything', async () => {
    const crm = buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS)
    renderCompanyDetail('co-ezdeploy', crm)
    await screen.findByRole('heading', { name: 'EZDeploy' })

    fireEvent.click(screen.getByRole('button', { name: 'ezdeploy.io' }))
    const input = screen.getByLabelText('Website')
    fireEvent.change(input, { target: { value: 'discarded.example' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByRole('button', { name: 'ezdeploy.io' })).toBeTruthy()
    expect(crm['companies:update']).not.toHaveBeenCalled()
  })

  it('changing the kind chip commits immediately with only the kind column', async () => {
    const crm = buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS)
    renderCompanyDetail('co-rinvii', crm)
    await screen.findByRole('heading', { name: 'Rinvii' })

    fireEvent.click(screen.getByRole('button', { name: 'Prospect' }))

    await waitFor(() => expect(crm['companies:update']).toHaveBeenCalledWith({ id: 'co-rinvii', patch: { kind: 'prospect' } }))
  })
})

describe('CompanyDetail — todos, activity, contacts (T-260828-30)', () => {
  function buildFullCrm() {
    return buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS, {
      tasks: [followUp, sendInvoice],
      activity: [directTouch, danaEmail, samayNote],
      people: ALL_PEOPLE,
      affiliations: AFFILIATIONS
    })
  }

  describe('todos', () => {
    it('shows the next step in its own block, distinct from the ordinary list by more than colour', async () => {
      renderCompanyDetail('co-ezdeploy', buildFullCrm())
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
      expect(within(todosCard).getByText('next step')).toBeTruthy()
      // The next-step task's title appears once, inside its own block — not
      // a second time in the ordinary list below it.
      expect(within(todosCard).getAllByText('Send invoice')).toHaveLength(1)
      expect(within(todosCard).getByText('Follow up on renewal')).toBeTruthy()
    })

    it('promoting an ordinary todo clears the marker from the previous next step, on screen, with no manual reload', async () => {
      const crm = buildFullCrm()
      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })

      fireEvent.click(screen.getByRole('button', { name: 'Set "Follow up on renewal" as next step' }))

      await waitFor(() => expect(crm['tasks:setNextStep']).toHaveBeenCalledWith({ id: 'task-followup' }))
      const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
      // "Follow up on renewal" is now the next step...
      await waitFor(() => expect(within(todosCard).getByText('next step').nextElementSibling?.textContent).toBe('Follow up on renewal'))
      // ...and "Send invoice" fell back into the ordinary list, its own
      // promote button restored (it no longer has a next-step block to sit
      // in instead).
      expect(within(todosCard).getByRole('button', { name: 'Set "Send invoice" as next step' })).toBeTruthy()
    })

    it('inline completion removes the task and updates the open count without leaving the page', async () => {
      const crm = buildFullCrm()
      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
      expect(within(todosCard).getByText('2')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Mark "Follow up on renewal" done' }))

      await waitFor(() => expect(crm['tasks:update']).toHaveBeenCalledWith({ id: 'task-followup', patch: { status: 'done' } }))
      await waitFor(() => expect(within(todosCard).queryByText('Follow up on renewal')).toBeNull())
      expect(within(todosCard).getByText('1')).toBeTruthy()
    })

    it('inline quick-add creates a task for this company and it appears without leaving the page', async () => {
      const crm = buildFullCrm()
      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const input = screen.getByPlaceholderText('Add a todo for EZDeploy')
      fireEvent.change(input, { target: { value: 'Call about renewal terms' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() =>
        expect(crm['tasks:create']).toHaveBeenCalledWith({ title: 'Call about renewal terms', companyId: 'co-ezdeploy' })
      )
      const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
      await waitFor(() => expect(within(todosCard).getByText('Call about renewal terms')).toBeTruthy())
      expect(within(todosCard).getByText('3')).toBeTruthy()
    })

    // Review fix (item 2): the next-step block used to render only the
    // badge, title and due label — no way to tick off or hand off the one
    // todo the page exists to draw attention to.
    it('the next-step block carries the same completion checkbox and promote control an ordinary row has', async () => {
      const crm = buildFullCrm()
      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
      // "Send invoice" is the seeded next step (sendInvoice.isNextStep).
      fireEvent.click(within(todosCard).getByRole('button', { name: 'Mark "Send invoice" done' }))

      await waitFor(() => expect(crm['tasks:update']).toHaveBeenCalledWith({ id: 'task-invoice', patch: { status: 'done' } }))
      // Ticking off the next step clears the whole block — there is no
      // longer an open next step to show.
      await waitFor(() => expect(within(todosCard).queryByText('next step')).toBeNull())
    })

    it('the next-step block still shows its promote control, reachable without a mouse (X-06)', async () => {
      renderCompanyDetail('co-ezdeploy', buildFullCrm())
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
      const promote = within(todosCard).getByRole('button', { name: 'Set "Send invoice" as next step' })
      // A real `<button>`, not a div with a click handler — reachable by Tab
      // and activated with Enter/Space with no extra keyboard wiring.
      expect(promote.tagName).toBe('BUTTON')
    })

    // Review fix (item 4): the `taskDueInfo` label chain, its parallel `cls`
    // chain, and the waiting-since age were all uncovered — every fixture
    // above leaves `dueOn` null (the "no date" branch) or uses `status:
    // 'todo'`, never `'waiting'`. These pin every remaining branch of both
    // ternary chains to a known `now`, so a mutated boundary or a swapped
    // label actually fails.
    it('labels every due-date band correctly: overdue, today, tomorrow, the 7-day boundary, later, and waiting', async () => {
      // `Date.now()` alone is mocked (not the timers) so React Testing
      // Library's own setTimeout-based `waitFor`/`findBy` polling keeps
      // running normally underneath — `vi.useFakeTimers()` would freeze that
      // polling too and hang every await below. `TZ` is pinned to remove any
      // dependence on the host machine's own local timezone for what "today"
      // resolves to; item 1's dedicated test below is what exercises a
      // genuinely non-UTC local timezone.
      const originalTz = process.env.TZ
      process.env.TZ = 'UTC'
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-28T12:00:00.000Z').getTime())
      try {
        const overdue = makeTask({ id: 'task-overdue', title: 'Overdue task', companyId: 'co-ezdeploy', dueOn: '2026-08-20' })
        const dueToday = makeTask({ id: 'task-today', title: 'Due today task', companyId: 'co-ezdeploy', dueOn: '2026-08-28' })
        const dueTomorrow = makeTask({ id: 'task-tomorrow', title: 'Due tomorrow task', companyId: 'co-ezdeploy', dueOn: '2026-08-29' })
        // Exactly 7 days out — still the "soon" band's far edge.
        const dueSoonEdge = makeTask({ id: 'task-soon-edge', title: 'Due soon-edge task', companyId: 'co-ezdeploy', dueOn: '2026-09-04' })
        // 8 days out — one past the edge, now "later".
        const dueLater = makeTask({ id: 'task-later', title: 'Due later task', companyId: 'co-ezdeploy', dueOn: '2026-09-05' })
        const waiting = makeTask({
          id: 'task-waiting',
          title: 'Waiting task',
          companyId: 'co-ezdeploy',
          status: 'waiting',
          waitingSince: '2026-08-25T12:00:00.000Z'
        })

        renderCompanyDetail(
          'co-ezdeploy',
          buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS, { tasks: [overdue, dueToday, dueTomorrow, dueSoonEdge, dueLater, waiting] })
        )
        await screen.findByRole('heading', { name: 'EZDeploy' })
        const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement

        const overdueDue = within(todosCard).getByText('8d overdue')
        expect(overdueDue.className).toBe('due over')

        const todayDue = within(todosCard).getByText('today')
        expect(todayDue.className).toBe('due soon')

        const tomorrowDue = within(todosCard).getByText('tomorrow')
        expect(tomorrowDue.className).toBe('due soon')

        const soonEdgeDue = within(todosCard).getByText('Sep 4')
        expect(soonEdgeDue.className).toBe('due soon')

        const laterDue = within(todosCard).getByText('Sep 5')
        expect(laterDue.className).toBe('due later')

        const waitingDue = within(todosCard).getByText('waiting 3d')
        expect(waitingDue.className).toBe('due wait')
        expect(within(todosCard).getByRole('button', { name: 'Mark "Waiting task" done' }).className).toContain('wait')
      } finally {
        nowSpy.mockRestore()
        if (originalTz === undefined) delete process.env.TZ
        else process.env.TZ = originalTz
      }
    })

    // Review fix (item 1): a due-date label used to mix a UTC-midnight
    // `dueOn` instant against `now`'s raw wall-clock instant, reading one
    // calendar day later than a viewer's actual local day for anyone west of
    // UTC once local time crosses into the UTC-next-day — from ~17:00 local
    // at UTC-7. A test at midday passes whether or not that bug exists,
    // which is why it survived; this one pins the clock to a late local
    // evening specifically to catch it.
    it('labels a todo due "today" correctly at a late local evening hour west of UTC, after the UTC calendar day has already advanced', async () => {
      const originalTz = process.env.TZ
      process.env.TZ = 'America/Los_Angeles' // UTC-7 in late August (PDT)
      // 8:00pm PDT on Aug 28 is already 3:00am UTC on Aug 29 — dueOn's
      // UTC-midnight instant for "2026-08-28" now sits a full day behind a
      // raw `now - dueOn` subtraction, which is exactly the bug: it would
      // report this task "1d overdue" while it is still due today locally.
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-29T03:00:00.000Z').getTime())
      try {
        const dueTonight = makeTask({ id: 'task-due-tonight', title: 'Renew SSL cert', companyId: 'co-ezdeploy', dueOn: '2026-08-28' })
        renderCompanyDetail('co-ezdeploy', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS, { tasks: [dueTonight] }))
        await screen.findByRole('heading', { name: 'EZDeploy' })

        const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
        expect(within(todosCard).getByText('today')).toBeTruthy()
        expect(within(todosCard).queryByText('1d overdue')).toBeNull()
      } finally {
        nowSpy.mockRestore()
        if (originalTz === undefined) delete process.env.TZ
        else process.env.TZ = originalTz
      }
    })
  })

  describe('activity', () => {
    it('merges rows carrying the company id directly with rows hung on its people and engagements, newest first', async () => {
      renderCompanyDetail('co-ezdeploy', buildFullCrm())
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const activityCard = screen.getByText('Activity').closest('.card') as HTMLElement
      await within(activityCard).findByText('Emailed Dana re: renewal')
      expect(within(activityCard).getByText('Quarterly check-in call')).toBeTruthy()
      // From eng-samay, not carrying companyId at all — only reachable via
      // the engagement-scoped activity:list call.
      expect(within(activityCard).getByText('Samay kickoff notes')).toBeTruthy()

      const titles = within(activityCard)
        .getAllByText(/Emailed Dana|Quarterly check-in|Samay kickoff/)
        .map((node) => node.textContent)
      expect(titles).toEqual(['Emailed Dana re: renewal', 'Quarterly check-in call', 'Samay kickoff notes'])
    })

    it('renders no edit and no delete control — no button at all, only the quick-log input (G8)', async () => {
      renderCompanyDetail('co-ezdeploy', buildFullCrm())
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const activityCard = screen.getByText('Activity').closest('.card') as HTMLElement
      await within(activityCard).findByText('Quarterly check-in call')
      expect(within(activityCard).queryAllByRole('button')).toHaveLength(0)
    })

    it('logging a touch from the card appends it without leaving the page', async () => {
      const crm = buildFullCrm()
      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const input = screen.getByPlaceholderText('Log a touch for EZDeploy')
      fireEvent.change(input, { target: { value: 'Left a voicemail' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() =>
        expect(crm['activity:log']).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Left a voicemail', kind: 'note', source: 'manual', companyId: 'co-ezdeploy', body: null })
        )
      )
      const activityCard = screen.getByText('Activity').closest('.card') as HTMLElement
      await waitFor(() => expect(within(activityCard).getByText('Left a voicemail')).toBeTruthy())
    })

    // Review fix (item 3): `relevantPersonIds` used to pull in EVERY
    // activity row tied to a person once they'd ever been affiliated with
    // this company — unbounded by the affiliation's own date range. Casey
    // left EZDeploy for W+K; her post-move activity must not leak onto
    // EZDeploy's timeline just because she is still fetched here as a
    // historical contact.
    it("bounds a former contact's activity to the time they were actually affiliated here, not their activity everywhere", async () => {
      const postMove = makeActivity({
        id: 'act-casey-wk',
        title: 'Kickoff call at W+K',
        kind: 'call',
        personId: 'per-casey',
        occurredAt: '2026-07-01T00:00:00.000Z'
      })
      const crm = buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS, {
        activity: [directTouch, danaEmail, samayNote, postMove],
        people: ALL_PEOPLE,
        affiliations: AFFILIATIONS
      })

      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })
      const ezActivityCard = screen.getByText('Activity').closest('.card') as HTMLElement
      await within(ezActivityCard).findByText('Quarterly check-in call')
      expect(within(ezActivityCard).queryByText('Kickoff call at W+K')).toBeNull()
    })

    it("shows that same post-move activity at the company Casey is now affiliated with", async () => {
      const postMove = makeActivity({
        id: 'act-casey-wk',
        title: 'Kickoff call at W+K',
        kind: 'call',
        personId: 'per-casey',
        occurredAt: '2026-07-01T00:00:00.000Z'
      })
      renderCompanyDetail(
        'co-wk',
        buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS, { activity: [postMove], people: ALL_PEOPLE, affiliations: AFFILIATIONS })
      )
      await screen.findByRole('heading', { name: 'W+K' })
      const activityCard = screen.getByText('Activity').closest('.card') as HTMLElement
      await within(activityCard).findByText('Kickoff call at W+K')
    })

    // Review fix (item 4): `ACTIVITY_KIND_LABEL` and `ACTIVITY_KIND_PATHS`
    // were both uncovered — no existing fixture asserted the rendered kind
    // label text or the icon markup itself, only row titles/ordering.
    it('labels and draws a distinct icon for each activity kind', async () => {
      const meetingActivity = makeActivity({
        id: 'act-meeting',
        title: 'Kickoff meeting',
        kind: 'meeting',
        companyId: 'co-ezdeploy',
        occurredAt: '2026-08-05T00:00:00.000Z'
      })
      const crm = buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS, {
        activity: [directTouch, danaEmail, samayNote, meetingActivity],
        people: ALL_PEOPLE,
        affiliations: AFFILIATIONS
      })
      renderCompanyDetail('co-ezdeploy', crm)
      await screen.findByRole('heading', { name: 'EZDeploy' })
      const activityCard = screen.getByText('Activity').closest('.card') as HTMLElement
      await within(activityCard).findByText('Kickoff meeting')

      function rowFor(title: string): HTMLElement {
        return within(activityCard).getByText(title).closest('.tli') as HTMLElement
      }

      // Label text — a mutated ACTIVITY_KIND_LABEL entry fails these.
      expect(within(rowFor('Quarterly check-in call')).getByText(/^Call ·/)).toBeTruthy()
      expect(within(rowFor('Emailed Dana re: renewal')).getByText(/^Email ·/)).toBeTruthy()
      expect(within(rowFor('Samay kickoff notes')).getByText(/^Note ·/)).toBeTruthy()
      expect(within(rowFor('Kickoff meeting')).getByText(/^Meeting ·/)).toBeTruthy()

      // Icon glyph — a mutated ACTIVITY_KIND_PATHS entry fails these: each
      // kind draws a different child element/path, not the same shape
      // recoloured.
      expect(rowFor('Quarterly check-in call').querySelector('.bul svg path')?.getAttribute('d')).toBe(
        'M5 4h3l2 5-2 1a10 10 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z'
      )
      expect(rowFor('Samay kickoff notes').querySelector('.bul svg path')?.getAttribute('d')).toBe('M4 19l1-4 10-10 3 3L8 18z')
      expect(rowFor('Emailed Dana re: renewal').querySelector('.bul svg rect')).toBeTruthy()
      expect(rowFor('Kickoff meeting').querySelector('.bul svg circle')).toBeTruthy()
    })
  })

  describe('contacts', () => {
    it('lists only current affiliations, with a person who has left visible solely under the historical disclosure', async () => {
      renderCompanyDetail('co-ezdeploy', buildFullCrm())
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const contactsCard = screen.getByText('Contacts').closest('.card') as HTMLElement
      expect(within(contactsCard).getByText('Dana Kwan')).toBeTruthy()
      expect(within(contactsCard).getByText('CTO')).toBeTruthy()
      expect(within(contactsCard).getByText('Primary')).toBeTruthy()

      // Casey appears exactly once in this card, and it's under the
      // historical disclosure — not a second time in the current list.
      const caseyMentions = within(contactsCard).getAllByText('Casey Ito')
      expect(caseyMentions).toHaveLength(1)
      const disclosure = caseyMentions[0].closest('.contacts-historical')
      expect(disclosure).not.toBeNull()
      // ...and visibly historical there, not just relocated: her subtitle
      // names when she left rather than repeating her old title.
      expect(within(disclosure as HTMLElement).getByText('left Jun 26')).toBeTruthy()
      expect(within(disclosure as HTMLElement).getByText('1 former contact')).toBeTruthy()
    })

    it('shows the same person as a current contact at the company they moved to', async () => {
      renderCompanyDetail('co-wk', buildFullCrm())
      await screen.findByRole('heading', { name: 'W+K' })

      const contactsCard = screen.getByText('Contacts').closest('.card') as HTMLElement
      expect(within(contactsCard).getByText('Casey Ito')).toBeTruthy()
      expect(within(contactsCard).getByText('PM')).toBeTruthy()
      expect(within(contactsCard).queryByText(/former contact/)).toBeNull()
    })

    // Review fix (item 4): `ContactsCard`'s header count was uncovered — a
    // mutant swapping `current.length` for `current.length + historical.length`
    // (or `historical.length`) would still pass every other assertion here.
    it('the header count reflects only current contacts, not current plus historical', async () => {
      renderCompanyDetail('co-ezdeploy', buildFullCrm())
      await screen.findByRole('heading', { name: 'EZDeploy' })

      const contactsCard = screen.getByText('Contacts').closest('.card') as HTMLElement
      // Dana (current) plus Casey (historical) — the header count must read
      // 1, the current-only count, not 2.
      expect(contactsCard.querySelector('.card-h .c')?.textContent).toBe('1')
    })
  })

  it('a company with nothing yet shows three empty states, each offering the action that fills it', async () => {
    renderCompanyDetail('co-lonely', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'Lonely Co' })

    const todosCard = screen.getByText('Todos').closest('.card') as HTMLElement
    expect(within(todosCard).getByText('Nothing open.')).toBeTruthy()
    expect(within(todosCard).getByPlaceholderText('Add a todo for Lonely Co')).toBeTruthy()

    const activityCard = screen.getByText('Activity').closest('.card') as HTMLElement
    expect(within(activityCard).getByText('Nothing logged.')).toBeTruthy()
    expect(within(activityCard).getByPlaceholderText('Log a touch for Lonely Co')).toBeTruthy()

    const contactsCard = screen.getByText('Contacts').closest('.card') as HTMLElement
    expect(within(contactsCard).getByText('No contacts yet.')).toBeTruthy()
    expect(within(contactsCard).getByRole('link', { name: 'Add a contact' })).toBeTruthy()
  })

  // -------------------------------------------------------------------
  // T-260828-53's two carry-overs (its "Left for whoever owns
  // CompanyDetail"), closed here by T-260828-50 — the twins of findings
  // that task closed in Companies.tsx but could not close here, because it
  // did not own this file.
  // -------------------------------------------------------------------

  it('a company nobody has ever contacted reads as late, never as ok (ADR-001)', async () => {
    // Lonely Co has `lastTouchAt: null`. Asserting the *label* alone is what
    // let this hole survive: replacing `cadenceState`'s null branch with
    // `{ pct: 0, label: 'no contact logged' }` keeps every word on screen
    // identical and turns the bar green. The meter's own class is the only
    // thing that distinguishes the two.
    renderCompanyDetail('co-lonely', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'Lonely Co' })

    const meter = document.querySelector('.decay') as HTMLElement
    expect(meter.className).toContain('late')
    expect(meter.className).not.toContain('ok')
    expect(meter.className).not.toContain('warn')
    expect(meter.textContent).toContain('no contact logged')
  })

  it('does not render the body against a half-loaded companies list', async () => {
    // W+K's header says "billed through <the billing company's name>", which
    // it can only know from `companies:list`. Holding that one query open
    // while `companies:get` resolves reproduces the race exactly: before the
    // gate, the header painted the raw uuid and corrected itself a frame
    // later.
    // Held in an object rather than a bare let: TypeScript control-flow
    // analysis does not track an assignment made inside the Promise executor,
    // so a plain let narrows back to null at the release call below, and the
    // optional call on it fails to compile as never. A property is not narrowed
    // that way. (Found at the merge gate — this file did not compile on its
    // own branch either.)
    const gate: { release: (() => void) | null } = { release: null }
    const listGate = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const crm = stubCrm({
      ...buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS),
      'companies:list': vi.fn(async () => {
        await listGate
        return { ok: true as const, data: ALL_COMPANIES }
      })
    })

    renderCompanyDetail('co-wk', crm)

    // `companies:get` resolves immediately, so an ungated body paints within
    // a couple of microtasks — with `co-ezdeploy` where "EZDeploy" belongs.
    // The assertion is that it does *not* paint while the list is still out:
    // a `queryBy` on the next line could pass simply by running before React
    // flushed, so this gives the ungated render a real window (measured: the
    // ungated build paints in well under 20ms here) and requires the heading
    // to still be absent at the end of it.
    await expect(waitFor(() => screen.getByRole('heading', { name: 'W+K' }), { timeout: 200 })).rejects.toThrow()
    expect(screen.queryByText(/co-ezdeploy/)).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()

    gate.release?.()
    await screen.findByRole('heading', { name: 'W+K' })
    expect(screen.getByText('billed through EZDeploy')).toBeTruthy()
  })

  it('renders the links section for the company (T-260828-50)', async () => {
    renderCompanyDetail('co-lonely', buildCrm(ALL_COMPANIES, ALL_ENGAGEMENTS))
    await screen.findByRole('heading', { name: 'Lonely Co' })

    const linksCard = screen.getByText('Links').closest('.card') as HTMLElement
    expect(within(linksCard).getByText('No links yet.')).toBeTruthy()
    expect(within(linksCard).getByPlaceholderText('Paste a Drive, Notion, PDF or any URL')).toBeTruthy()
  })
})
