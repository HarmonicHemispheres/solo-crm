import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { People } from './People'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { invalidate } from '../lib/query-keys'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { Company } from '../../shared/companies'
import type { Person, PersonAffiliation, PersonWithAffiliations } from '../../shared/people'
import type { SettingEntry } from '../../shared/ipc-types'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const NOW = new Date('2026-08-28T12:00:00.000Z')

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
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

function makeAffiliation(overrides: Partial<PersonAffiliation> & { id: string; personId: string; companyId: string }): PersonAffiliation {
  return {
    title: null,
    isPrimary: null,
    started: '2026-01-01',
    ended: null,
    current: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

// -- fixture: Ana is currently at EZDeploy as "Head of Product"; Beto has
// never had an affiliation at all (this task's Acceptance: no invented
// company). --

const EZDEPLOY = makeCompany({ id: 'ezdeploy', name: 'EZDeploy' })
const RINVII = makeCompany({ id: 'rinvii', name: 'Rinvii' })

const ANA = makePerson({ id: 'ana', name: 'Ana Silva', lastContactAt: isoDaysAgo(3) })
const BETO = makePerson({ id: 'beto', name: 'Beto Cruz', lastContactAt: null })

const ANA_AT_EZDEPLOY = makeAffiliation({
  id: 'aff-ana-ez',
  personId: 'ana',
  companyId: 'ezdeploy',
  title: 'Head of Product',
  started: '2026-02-01',
  ended: null,
  current: true
})

function detailFor(person: Person, affiliations: readonly PersonAffiliation[]): PersonWithAffiliations {
  return { ...person, affiliations }
}

/** Detail route stand-in — proves navigation actually happened, not just that a handler was called. */
function PersonDetailStub() {
  const { id } = useParams()
  return <div data-testid="person-detail">{id}</div>
}

function renderPeople({
  people = [ANA, BETO],
  companies = [EZDEPLOY, RINVII],
  details = { ana: detailFor(ANA, [ANA_AT_EZDEPLOY]), beto: detailFor(BETO, []) },
  mode = 'card' as 'card' | 'list',
  queryClient = createQueryClient(),
  crmOverrides = {}
}: {
  people?: readonly Person[]
  companies?: readonly Company[]
  details?: Record<string, PersonWithAffiliations>
  mode?: 'card' | 'list'
  queryClient?: QueryClient
  crmOverrides?: Parameters<typeof stubCrm>[0]
} = {}) {
  let currentMode = mode
  window.crm = stubCrm({
    'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
    'people:get': vi.fn(async (payload) => ({ ok: true as const, data: details[payload.id] ?? null })),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'settings:get': vi.fn(async () => ({
      ok: true as const,
      data: { key: 'view.people.mode' as const, value: currentMode }
    })),
    'settings:set': vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.people.mode') currentMode = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    }),
    ...crmOverrides
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/people']}>
        <LayerManager>
          <Routes>
            <Route path="/people" element={<People />} />
            <Route path="/person/:id" element={<PersonDetailStub />} />
          </Routes>
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, queryClient }
}

/**
 * Asserts the dialog is `PersonSheet`, not something merely titled like it —
 * see `Companies.test.tsx`'s counterpart for why the field, not the title,
 * is the load-bearing assertion.
 */
function expectRealPersonForm(dialog: HTMLElement): void {
  const name = within(dialog).getByLabelText('Name') as HTMLInputElement
  expect(name.placeholder).toBe('Jane Doe')
  fireEvent.change(name, { target: { value: 'Dana Okoro' } })
  expect(name.value).toBe('Dana Okoro')
  const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement
  expect(create.disabled).toBe(false)
}

describe('People', () => {
  it('shows a person\'s current company and title on their card', async () => {
    renderPeople()
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())

    const anaCard = screen.getByRole('button', { name: /^Ana Silva/ })
    expect(within(anaCard).getByText('EZDeploy')).toBeTruthy()
    expect(within(anaCard).getByText('Head of Product')).toBeTruthy()
  })

  it('renders a person with no affiliation at all without error and without inventing a company', async () => {
    renderPeople()
    await waitFor(() => expect(screen.getByText('Beto Cruz')).toBeTruthy())

    const betoCard = screen.getByRole('button', { name: /^Beto Cruz/ })
    // "—" for company (and for role) — no crash, no fabricated name.
    expect(within(betoCard).getAllByText('—')).toHaveLength(2)
  })

  it('renders the same record set — same count, same default order — in both presentations', async () => {
    renderPeople({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())
    const cardNames = screen.getAllByText(/^(Ana Silva|Beto Cruz)$/).map((el) => el.textContent)

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /name/i })).toBeTruthy())
    const listNames = screen.getAllByText(/^(Ana Silva|Beto Cruz)$/).map((el) => el.textContent)

    expect(listNames).toEqual(cardNames)
    expect(cardNames).toHaveLength(2)
  })

  it('shows the empty state, not a blank panel, when there are zero people', async () => {
    renderPeople({ people: [], details: {} })
    await waitFor(() => expect(screen.getByText(/No people yet/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Add person' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New person' })).toBeTruthy()
  })

  it('a person created elsewhere appears without a manual reload, once the people entity is invalidated', async () => {
    let people: readonly Person[] = []
    const queryClient = createQueryClient()
    window.crm = stubCrm({
      'people:list': vi.fn(async () => ({ ok: true as const, data: people })),
      'people:get': vi.fn(async () => ({ ok: true as const, data: null })),
      'companies:list': vi.fn(async () => ({ ok: true as const, data: [] })),
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'view.people.mode' as const, value: 'card' as const }
      }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/people']}>
          <LayerManager>
            <People />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText(/No people yet/)).toBeTruthy())

    people = [ANA]
    await act(async () => {
      await invalidate.people(queryClient)
    })

    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())
    expect(screen.queryByText(/No people yet/)).toBeNull()
  })

  it('persists the presentation choice through settings:set, and a later mount reads it back (survives a restart)', async () => {
    let persisted: 'card' | 'list' = 'card'
    const settingsSet = vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.people.mode') persisted = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    })
    const crmOverrides = {
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'view.people.mode' as const, value: persisted }
      })),
      'settings:set': settingsSet
    }

    renderPeople({ mode: 'card', crmOverrides })
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.people.mode', value: 'list' }))

    renderPeople({ mode: persisted, queryClient: createQueryClient(), crmOverrides })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /name/i })).toBeTruthy())
  })

  it('rolls the presentation back to the stored value when settings:set fails (T-260901-28)', async () => {
    // See Companies.test.tsx's twin for the reasoning, and Todos'. The
    // never-resolving second `settings:get` is what makes this test about
    // the rollback rather than about the refetch that follows it.
    let getCalls = 0
    const settingsGet = vi.fn(async () => {
      getCalls += 1
      if (getCalls === 1) return { ok: true as const, data: { key: 'view.people.mode' as const, value: 'card' as const } }
      return new Promise<never>(() => {})
    })
    const settingsSet = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'handler-error' as const, message: 'disk is read-only' }
    }))
    renderPeople({ mode: 'card', crmOverrides: { 'settings:get': settingsGet, 'settings:set': settingsSet } })
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'List' }))

    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.people.mode', value: 'list' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Card' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('false')
    // And the cards, not the table, are what is actually on screen.
    expect(screen.queryByRole('columnheader', { name: /name/i })).toBeNull()
  })

  it('every card is a real button, and activating one navigates to its detail route', async () => {
    renderPeople({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())

    const card = screen.getByRole('button', { name: /^Ana Silva/ })
    expect(card.tagName).toBe('BUTTON')

    fireEvent.click(card)
    await waitFor(() => expect(screen.getByTestId('person-detail').textContent).toBe('ana'))
  })

  it('every table row is keyboard-reachable and Enter activates it, navigating to its detail route', async () => {
    renderPeople({ mode: 'list' })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /name/i })).toBeTruthy())

    const row = screen.getByText('Beto Cruz').closest('tr')
    if (!row) throw new Error('row not found')
    expect(row.tabIndex).toBe(0)

    fireEvent.keyDown(row, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('person-detail').textContent).toBe('beto'))
  })

  /** The T-260829-08 regression — see `Companies.test.tsx`'s own note on why
   * this asserts a field rather than that a dialog opened. */
  it('opens a real person form — not a titled shell — from the empty state and from the header', async () => {
    renderPeople({ people: [], details: {} })
    await waitFor(() => expect(screen.getByText(/No people yet/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    const fromEmptyState = screen.getByRole('dialog', { name: 'New person' })
    expectRealPersonForm(fromEmptyState)

    fireEvent.click(within(fromEmptyState).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New person' }))
    expectRealPersonForm(screen.getByRole('dialog', { name: 'New person' }))
  })

  it('opens a real person form from the grid\'s own "Add person" card', async () => {
    renderPeople({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('Ana Silva')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expectRealPersonForm(screen.getByRole('dialog', { name: 'New person' }))
  })

  it('never calls window.crm from this module directly — every read is wired through the ipc/query-key helpers', async () => {
    const peopleList = vi.fn(async () => ({ ok: true as const, data: [ANA] }))
    renderPeople({ crmOverrides: { 'people:list': peopleList } })
    await waitFor(() => expect(peopleList).toHaveBeenCalled())
    expect(peopleList).toHaveBeenCalledWith(undefined)
  })
})
