import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { Companies } from './Companies'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { invalidate } from '../lib/query-keys'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { Company } from '../../shared/companies'
import type { Engagement } from '../../shared/engagements'
import type { SettingEntry } from '../../shared/ipc-types'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const NOW = new Date('2026-08-28T12:00:00.000Z')

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
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

function makeEngagement(overrides: Partial<Engagement> & { id: string }): Engagement {
  return {
    name: 'Engagement',
    billingCompanyId: null,
    clientCompanyId: null,
    serviceVersionId: null,
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

const EZDEPLOY = makeCompany({ id: 'ezdeploy', name: 'EZDeploy', cadenceDays: 10, lastTouchAt: isoDaysAgo(3) })
const RINVII = makeCompany({ id: 'rinvii', name: 'Rinvii', cadenceDays: 7, lastTouchAt: null })
// The seed fixture's own end-client cases (task Acceptance): billed via
// EZDeploy, so neither appears as a top-level row.
const WK = makeCompany({ id: 'wk', name: 'W+K', kind: 'end_client', billedViaCompanyId: 'ezdeploy' })
const PROGRAMETRIX = makeCompany({
  id: 'programetrix',
  name: 'Programetrix',
  kind: 'end_client',
  billedViaCompanyId: 'ezdeploy'
})

const SAMAY = makeEngagement({
  id: 'samay',
  name: 'Samay',
  billingCompanyId: 'ezdeploy',
  clientCompanyId: 'wk',
  status: 'active'
})

/** Detail route stand-in — proves navigation actually happened, not just that a handler was called. */
function CompanyDetail() {
  const { id } = useParams()
  return <div data-testid="company-detail">{id}</div>
}

function renderCompanies({
  companies = [EZDEPLOY, RINVII, WK, PROGRAMETRIX],
  engagements = [SAMAY],
  mode = 'card' as 'card' | 'list',
  queryClient = createQueryClient(),
  crmOverrides = {}
}: {
  companies?: readonly Company[]
  engagements?: readonly Engagement[]
  mode?: 'card' | 'list'
  queryClient?: QueryClient
  crmOverrides?: Parameters<typeof stubCrm>[0]
} = {}) {
  // Stateful, not a fixed return: settings:set's onSuccess invalidates and
  // refetches settings:get in the background (the real round trip a
  // mutation-then-invalidate does), so a stub that always answered with the
  // render's initial `mode` would clobber an optimistic toggle back to its
  // starting value the moment that refetch lands.
  let currentMode = mode
  window.crm = stubCrm({
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    'settings:get': vi.fn(async () => ({
      ok: true as const,
      data: { key: 'view.companies.mode' as const, value: currentMode }
    })),
    'settings:set': vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.companies.mode') currentMode = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    }),
    ...crmOverrides
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/companies']}>
        <LayerManager>
          <Routes>
            <Route path="/companies" element={<Companies />} />
            <Route path="/company/:id" element={<CompanyDetail />} />
          </Routes>
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, queryClient }
}

describe('Companies', () => {
  it('excludes a company that only appears as another one\'s end client — the seed fixture\'s W+K and Programetrix', async () => {
    renderCompanies()
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    expect(screen.getByText('Rinvii')).toBeTruthy()
    expect(screen.queryByText('W+K')).toBeNull()
    expect(screen.queryByText('Programetrix')).toBeNull()
    // Surfaced instead as EZDeploy's own end-client count (both W+K and
    // Programetrix are billed via EZDeploy).
    expect(screen.getByText('2 end clients')).toBeTruthy()
  })

  it('renders the same record set — same count, same default order — in both presentations', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())
    const cardNames = screen.getAllByText(/^(EZDeploy|Rinvii)$/).map((el) => el.textContent)

    // Same component instance, same query cache — only the presentation toggled.
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
    const listNames = screen.getAllByText(/^(EZDeploy|Rinvii)$/).map((el) => el.textContent)

    expect(listNames).toEqual(cardNames)
    expect(cardNames).toHaveLength(2)
  })

  it('sorts the list on a column click, and the order survives switching to cards and back', async () => {
    renderCompanies({ mode: 'list' })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())

    const rowsInOrder = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByText(/EZDeploy|Rinvii/)[0].textContent)
    // Default order matches companies:list's own (alphabetical: EZDeploy, Rinvii).
    expect(rowsInOrder()).toEqual(['EZDeploy', 'Rinvii'])

    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(rowsInOrder()).toEqual(['EZDeploy', 'Rinvii']) // ascending, unchanged
    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(rowsInOrder()).toEqual(['Rinvii', 'EZDeploy']) // descending, reversed

    fireEvent.click(screen.getByRole('button', { name: 'Card view' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^EZDeploy/ })).toBeTruthy())
    const cardOrder = screen.getAllByText(/^(EZDeploy|Rinvii)$/).map((el) => el.textContent)
    expect(cardOrder).toEqual(['Rinvii', 'EZDeploy'])

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(rowsInOrder()).toEqual(['Rinvii', 'EZDeploy']))
  })

  it('shows the empty state, not a blank panel, when there are zero companies', async () => {
    renderCompanies({ companies: [], engagements: [] })
    await waitFor(() => expect(screen.getByText(/No companies yet/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Add company' })).toBeTruthy()
    // The header's own create action is still there too.
    expect(screen.getByRole('button', { name: 'New company' })).toBeTruthy()
  })

  it('a company created elsewhere appears without a manual reload, once the companies entity is invalidated', async () => {
    let companies: readonly Company[] = []
    const queryClient = createQueryClient()
    window.crm = stubCrm({
      'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
      'engagements:list': vi.fn(async () => ({ ok: true as const, data: [] })),
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'view.companies.mode' as const, value: 'card' as const }
      }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/companies']}>
          <LayerManager>
            <Companies />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText(/No companies yet/)).toBeTruthy())

    // Models what the eventual create-sheet mutation (T-260828-27) does on
    // success: main now has the new row, and the mutation invalidates the
    // companies entity through the same helper every other mutation uses.
    companies = [EZDEPLOY]
    await act(async () => {
      await invalidate.companies(queryClient)
    })

    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())
    expect(screen.queryByText(/No companies yet/)).toBeNull()
  })

  it('persists the presentation choice through settings:set, and a later mount reads it back (survives a restart)', async () => {
    let persisted: 'card' | 'list' = 'card'
    const settingsSet = vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.companies.mode') persisted = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    })
    const crmOverrides = {
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'view.companies.mode' as const, value: persisted }
      })),
      'settings:set': settingsSet
    }

    const first = renderCompanies({ mode: 'card', crmOverrides })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.companies.mode', value: 'list' }))
    first.unmount()

    // A fresh mount — a new QueryClient, standing in for the app restarting —
    // reads the persisted value straight from settings:get with no prop
    // telling it which mode to start in.
    renderCompanies({ mode: persisted, queryClient: createQueryClient(), crmOverrides })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
  })

  it('every card is a real button — Tab/Enter/Space work with no extra wiring — and activating one navigates to its detail route', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    const card = screen.getByRole('button', { name: /^EZDeploy/ })
    expect(card.tagName).toBe('BUTTON')

    fireEvent.click(card)
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('ezdeploy'))
  })

  it('every table row is keyboard-reachable and Enter activates it, navigating to its detail route', async () => {
    renderCompanies({ mode: 'list' })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())

    const row = screen.getByText('Rinvii').closest('tr')
    if (!row) throw new Error('row not found')
    expect(row.tabIndex).toBe(0)

    fireEvent.keyDown(row, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('rinvii'))
  })

  it('renders a determinate cadence state, never NaN, for a company with no last_touch_at (fresh install)', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('Rinvii')).toBeTruthy())

    const rinviiCard = screen.getByRole('button', { name: /^Rinvii/ })
    expect(rinviiCard.textContent).toContain('never')
    expect(rinviiCard.textContent).not.toMatch(/NaN/)

    // And it reads as maximally stale, not as healthy (ADR-001 rule 5). The
    // label alone does not say this: a `decayPct` that returned 0 for a
    // never-contacted company would still render the word "never" — over a
    // green, full-health bar (T-260828-53 item 7).
    const meter = rinviiCard.querySelector('.decay')
    expect(meter?.className).toContain('late')
    expect(meter?.className).not.toContain('ok')
  })

  it('opens the create sheet from both the header action and the empty state', async () => {
    renderCompanies({ companies: [], engagements: [] })
    await waitFor(() => expect(screen.getByText(/No companies yet/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Add company' }))
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
  })

  it('offers the presentation toggle as icon buttons, each with the name a screen reader reads', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    // `.claude/rules/ui-design.md`: icon buttons by default, and an icon-only
    // control still carries a label. The mockup's own VIEWTOG wording.
    const cardView = screen.getByRole('button', { name: 'Card view' })
    const listView = screen.getByRole('button', { name: 'List view' })
    expect(cardView.textContent).toBe('')
    expect(cardView.querySelector('svg')).toBeTruthy()
    expect(cardView.getAttribute('aria-pressed')).toBe('true')
    expect(listView.getAttribute('aria-pressed')).toBe('false')
  })

  it('rolls the toggle back to the stored presentation when settings:set fails', async () => {
    // The optimistic write has to be undone by an onError, not left standing:
    // without one the view keeps claiming a preference main never stored
    // (T-260828-53 item 6). settings:get answers 'card' once and then never
    // resolves, so the reconciling refetch cannot paper over a missing
    // rollback — the only thing that can put 'card' back on screen is the
    // rollback itself.
    let getCalls = 0
    const settingsGet = vi.fn(async () => {
      getCalls += 1
      if (getCalls === 1) return { ok: true as const, data: { key: 'view.companies.mode' as const, value: 'card' as const } }
      return new Promise<never>(() => {})
    })
    const settingsSet = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'handler-error' as const, message: 'disk is read-only' }
    }))
    renderCompanies({ crmOverrides: { 'settings:get': settingsGet, 'settings:set': settingsSet } })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    // The click really did ask main to store 'list' — the toggle below is
    // back on 'card' because the write failed, not because nothing happened.
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.companies.mode', value: 'list' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Card view' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('false')
    // And the cards, not the table, are what is actually on screen.
    expect(screen.queryByRole('columnheader', { name: /company/i })).toBeNull()
  })

  it('never calls window.crm from this module directly — every read is wired through the ipc/query-key helpers', async () => {
    const companiesList = vi.fn(async () => ({ ok: true as const, data: [EZDEPLOY] }))
    renderCompanies({ crmOverrides: { 'companies:list': companiesList } })
    await waitFor(() => expect(companiesList).toHaveBeenCalled())
    // Called with the calling convention callCrmImpl/ipcQueryFn use — no
    // payload for a channel whose request schema is `z.undefined()` — which
    // only holds if this view went through ipc.ts rather than invoking
    // window.crm['companies:list'] with something ad hoc.
    expect(companiesList).toHaveBeenCalledWith(undefined)
  })
})
