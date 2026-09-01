import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { Engagements } from './Engagements'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import { engagementAnchorId } from '../nav'
import type { Company } from '../../shared/companies'
import type { EngagementWithOffering, Milestone } from '../../shared/engagements'

/**
 * Under ADR-005 this is the only view of engagement state (this task's
 * "Why") — these tests are built off the task file's own Acceptance list,
 * not just "does it render".
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

// -- fixture: one engagement per billing model, each on a company pairing
// that exercises the same-company / different-company card content. --

const acme = makeCompany({ id: 'co-acme', name: 'Acme' })
const biller = makeCompany({ id: 'co-biller', name: 'Biller Co' })
const client = makeCompany({ id: 'co-client', name: 'Client Co' })

const retainerEngagement = makeEngagement({
  id: 'eng-retainer',
  name: 'Advisory retainer',
  billingCompanyId: 'co-acme',
  clientCompanyId: 'co-acme',
  billingModel: 'retainer',
  status: 'active',
  hoursIncluded: 20,
  endsOn: null
})

const fixedEngagement = makeEngagement({
  id: 'eng-fixed',
  name: 'Fixed-scope build',
  billingCompanyId: 'co-biller',
  clientCompanyId: 'co-client',
  billingModel: 'fixed',
  status: 'active',
  startedOn: '2026-02-10',
  endsOn: '2026-10-15'
})

const tmEngagement = makeEngagement({
  id: 'eng-tm',
  name: 'Platform advisory',
  billingCompanyId: 'co-acme',
  clientCompanyId: 'co-acme',
  billingModel: 'tm',
  status: 'pending',
  estimatedHours: 30,
  notToExceedCents: 500_000
})

const equityEngagement = makeEngagement({
  id: 'eng-equity',
  name: 'Equity position',
  billingCompanyId: 'co-acme',
  clientCompanyId: 'co-acme',
  billingModel: 'equity',
  status: 'held'
})

const noneEngagement = makeEngagement({
  id: 'eng-none',
  name: 'Grant advisory',
  billingCompanyId: 'co-acme',
  clientCompanyId: 'co-acme',
  billingModel: 'none',
  status: 'proposed'
})

const lostEngagement = makeEngagement({
  id: 'eng-lost',
  name: 'Discovery audit',
  billingCompanyId: 'co-acme',
  clientCompanyId: 'co-acme',
  billingModel: 'fixed',
  status: 'lost'
})

const deliveredEngagement = makeEngagement({
  id: 'eng-delivered',
  name: 'VedX support agent',
  billingCompanyId: 'co-acme',
  clientCompanyId: 'co-acme',
  billingModel: 'fixed',
  status: 'delivered'
})

const fixedMilestones = [
  makeMilestone({ id: 'ms-1', engagementId: 'eng-fixed', name: 'Kickoff', sort: 0, completedAt: TS }),
  makeMilestone({ id: 'ms-2', engagementId: 'eng-fixed', name: 'Build', sort: 1 }),
  makeMilestone({ id: 'ms-3', engagementId: 'eng-fixed', name: 'Launch', sort: 2 })
]

const ALL_ENGAGEMENTS = [
  retainerEngagement,
  fixedEngagement,
  tmEngagement,
  equityEngagement,
  noneEngagement,
  lostEngagement,
  deliveredEngagement
]
const ALL_COMPANIES = [acme, biller, client]

/** Detail route stand-in — proves navigation happened, not just that a link renders. */
function CompanyDetailStub() {
  const { id } = useParams()
  return <div data-testid="company-detail">{id}</div>
}

function renderEngagements({
  engagements = ALL_ENGAGEMENTS,
  companies = ALL_COMPANIES,
  milestonesByEngagementId = { 'eng-fixed': fixedMilestones },
  queryClient = createQueryClient()
}: {
  engagements?: readonly EngagementWithOffering[]
  companies?: readonly Company[]
  milestonesByEngagementId?: Record<string, readonly Milestone[]>
  queryClient?: QueryClient
} = {}) {
  window.crm = stubCrm({
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'engagements:milestones': vi.fn(async (payload: { engagementId: string }) => ({
      ok: true as const,
      data: milestonesByEngagementId[payload.engagementId] ?? []
    }))
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/engagements']}>
        <LayerManager>
          <Routes>
            <Route path="/engagements" element={<Engagements />} />
            <Route path="/company/:id" element={<CompanyDetailStub />} />
          </Routes>
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function cardFor(name: string): HTMLElement {
  const card = screen.getByText(name).closest('.eng')
  if (!card) throw new Error(`no .eng ancestor for "${name}"`)
  return card as HTMLElement
}

/**
 * Asserts the dialog is `EngagementSheet`, not something merely titled like
 * it — see `Companies.test.tsx`'s counterpart for why the field, not the
 * title, is the load-bearing assertion.
 */
function expectRealEngagementForm(dialog: HTMLElement): void {
  const name = within(dialog).getByLabelText('Name') as HTMLInputElement
  expect(name.placeholder).toBe('Fixed scope SOW')
  fireEvent.change(name, { target: { value: 'Q4 advisory' } })
  expect(name.value).toBe('Q4 advisory')
  const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement
  expect(create.disabled).toBe(false)
}

describe('Engagements', () => {
  it('renders three distinct progress shapes — retainer hours-vs-allowance, fixed milestones, T&M hours-vs-estimate', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    expect(within(cardFor('Advisory retainer')).getByText('0 of 20 hrs this month')).toBeTruthy()
    expect(await within(cardFor('Fixed-scope build')).findByText('1 of 3 milestones')).toBeTruthy()
    expect(within(cardFor('Platform advisory')).getByText('0 of ~30 hrs')).toBeTruthy()
  })

  it('says what an engagement was sold as, and says nothing where it was sold from nothing', async () => {
    renderEngagements({
      engagements: [
        makeEngagement({
          id: 'eng-sold',
          name: 'Sold advisory',
          status: 'active',
          billingCompanyId: 'co-acme',
          clientCompanyId: 'co-acme',
          billingModel: 'retainer',
          offeringVersionId: 'ver-advisory-2',
          offeringId: 'off-advisory',
          offeringName: 'Advisory retainer',
          agreedRateCents: 350_000
        }),
        retainerEngagement
      ]
    })
    await screen.findByText('Sold advisory')

    const sold = cardFor('Sold advisory')
    expect(sold.querySelector('.sold-as')?.textContent).toContain('sold as Advisory retainer')
    // No price on the card. `agreedRateCents` is 350000 on this fixture and
    // the offering is quoted somewhere else entirely; neither belongs here
    // (P3-03 — the card labels the sale, it does not report a rate).
    expect(sold.textContent).not.toMatch(/3500|\$/)

    // Sold from nothing renders no label at all, not an empty one.
    expect(cardFor('Advisory retainer').querySelector('.sold-as')).toBeNull()
  })

  it('renders no progress shape at all for equity or none — the shape reserved for a model it does not apply to', async () => {
    renderEngagements()
    await screen.findByText('Equity position')

    const equityCard = cardFor('Equity position')
    expect(equityCard.querySelector('.bar')).toBeNull()
    expect(equityCard.querySelector('.prog')).toBeNull()

    const noneCard = cardFor('Grant advisory')
    expect(noneCard.querySelector('.bar')).toBeNull()
    expect(noneCard.querySelector('.prog')).toBeNull()
  })

  it('marks every hours-derived figure provisional — retainer and T&M, never the milestone count', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    // Exactly the two hours-derived cards (retainer, T&M) — not the
    // milestone-based fixed card, which isn't derived from time_entries.
    expect(screen.getAllByText('Provisional')).toHaveLength(2)
    expect(within(cardFor('Advisory retainer')).getByText('Provisional')).toBeTruthy()
    expect(within(cardFor('Platform advisory')).getByText('Provisional')).toBeTruthy()
    expect(within(cardFor('Fixed-scope build')).queryByText('Provisional')).toBeNull()
  })

  it('renders a NULL ends_on as "rolling", never blank or a far-future date', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    // retainerEngagement has endsOn: null.
    expect(cardFor('Advisory retainer').textContent).toContain('rolling')
    // fixedEngagement has a real endsOn — shown as a month/year, not "rolling".
    expect(cardFor('Fixed-scope build').textContent).not.toContain('rolling')
  })

  it('names both companies when billing and client differ, and just one when they match', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    const sameCard = cardFor('Advisory retainer')
    expect(within(sameCard).getByRole('link', { name: 'Acme' })).toBeTruthy()
    expect(sameCard.textContent).not.toMatch(/for /)

    const differentCard = cardFor('Fixed-scope build')
    expect(within(differentCard).getByRole('link', { name: 'Biller Co' })).toBeTruthy()
    expect(within(differentCard).getByRole('link', { name: 'Client Co' })).toBeTruthy()
    expect(differentCard.textContent).toContain('for')
  })

  it('shows all six status groups when populated, lost included', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    expect(screen.getByRole('heading', { name: 'Active' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pending' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Proposed' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Held' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Delivered' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Lost' })).toBeTruthy()
  })

  it('omits an empty status group rather than rendering it with a zero count', async () => {
    renderEngagements({ engagements: ALL_ENGAGEMENTS.filter((engagement) => engagement.status !== 'delivered') })
    await screen.findByText('Advisory retainer')

    expect(screen.queryByRole('heading', { name: 'Delivered' })).toBeNull()
    // The rest are unaffected.
    expect(screen.getByRole('heading', { name: 'Lost' })).toBeTruthy()
  })

  it('every company name is a real link — Tab/Enter reach it and it navigates to that company', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    const link = within(cardFor('Advisory retainer')).getByRole('link', { name: 'Acme' })
    expect(link.tagName).toBe('A')
    link.focus()
    expect(document.activeElement).toBe(link)
  })

  it('never calls window.crm from this module directly — every read is wired through the ipc/query-key helpers', async () => {
    const engagementsList = vi.fn(async () => ({ ok: true as const, data: ALL_ENGAGEMENTS }))
    window.crm = stubCrm({
      'engagements:list': engagementsList,
      'companies:list': vi.fn(async () => ({ ok: true as const, data: ALL_COMPANIES })),
      'engagements:milestones': vi.fn(async () => ({ ok: true as const, data: [] }))
    })
    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/engagements']}>
          <LayerManager>
            <Engagements />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await screen.findByText('Advisory retainer')
    // Called with the calling convention callCrmImpl/ipcQueryFn use — no
    // payload for a channel whose request schema is `z.undefined()` — which
    // only holds if this view went through ipc.ts rather than invoking
    // window.crm['engagements:list'] with something ad hoc.
    expect(engagementsList).toHaveBeenCalledWith(undefined)
  })

  it('shows the empty state, not a blank panel, when there are zero engagements', async () => {
    renderEngagements({ engagements: [], companies: [] })
    await screen.findByText(/No engagements yet/)
    expect(screen.getByRole('button', { name: 'Add engagement' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New engagement' })).toBeTruthy()
  })

  /** The T-260829-08 regression — see `Companies.test.tsx`'s own note on why
   * this asserts a field rather than that a dialog opened. */
  it('opens a real engagement form — not a titled shell — from the empty state and from the header', async () => {
    renderEngagements({ engagements: [], companies: [] })
    await screen.findByText(/No engagements yet/)

    fireEvent.click(screen.getByRole('button', { name: 'Add engagement' }))
    const fromEmptyState = screen.getByRole('dialog', { name: 'New engagement' })
    expectRealEngagementForm(fromEmptyState)

    fireEvent.click(within(fromEmptyState).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New engagement' }))
    expectRealEngagementForm(screen.getByRole('dialog', { name: 'New engagement' }))
  })

  it('does not render any dollar amount unless the Scope explicitly calls for one (T&M not-to-exceed)', async () => {
    renderEngagements()
    await screen.findByText('Advisory retainer')

    expect(cardFor('Advisory retainer').textContent).not.toMatch(/\$/)
    expect(cardFor('Fixed-scope build').textContent).not.toMatch(/\$/)
    // The one deliberate exception (this task's Scope).
    expect(within(cardFor('Platform advisory')).getByText(/not to exceed \$5000\.00/)).toBeTruthy()
  })

  // T-260901-10: ADR-005 leaves an engagement with no detail route, so the
  // list is the only place it can be edited from — and until this task there
  // was nothing on a card to edit it with.
  describe('the per-card edit affordance', () => {
    /** The whole fixture, answered by `engagements:get` as well as `engagements:list`. */
    function renderWithGet() {
      renderEngagements()
      const byId = new Map(ALL_ENGAGEMENTS.map((engagement) => [engagement.id, engagement] as const))
      const existing = window.crm
      window.crm = {
        ...existing,
        'engagements:get': vi.fn(async (payload: { id: string }) => ({ ok: true as const, data: byId.get(payload.id) ?? null }))
      }
    }

    it('gives every card a keyboard-reachable control named after its own engagement', async () => {
      renderEngagements()
      await screen.findByText('Advisory retainer')

      for (const engagement of ALL_ENGAGEMENTS) {
        const button = within(cardFor(engagement.name)).getByRole('button', { name: `Edit "${engagement.name}"` })
        button.focus()
        expect(document.activeElement).toBe(button)
      }
    })

    it('reveals the control with opacity, not display — so focus can reach it before any hover happens', async () => {
      renderEngagements()
      await screen.findByText('Advisory retainer')

      // `display: none` would take it out of the tab order entirely, which
      // is the difference between "hover-revealed" and "unreachable". The
      // 700px rule in Engagements.css is the other half of the same point.
      const actions = cardFor('Advisory retainer').querySelector('.eng-actions')
      expect(actions).not.toBeNull()
      expect(actions?.className).toBe('eng-actions')
    })

    it('opens the engagement sheet in edit mode on that card\'s record, populated', async () => {
      renderWithGet()
      await screen.findByText('Advisory retainer')

      fireEvent.click(within(cardFor('Advisory retainer')).getByRole('button', { name: 'Edit "Advisory retainer"' }))

      // The form replaces the loading placeholder once `engagements:get`
      // answers, so the dialog is re-queried rather than held across it.
      const name = await screen.findByLabelText('Name')
      expect((name as HTMLInputElement).value).toBe('Advisory retainer')
      expect((screen.getByLabelText('Hours included') as HTMLInputElement).value).toBe('20')
      expect(screen.getByRole('dialog', { name: 'Edit engagement' })).toBeTruthy()
    })

    it('leaves nothing of one engagement behind when the next one is opened', async () => {
      renderWithGet()
      await screen.findByText('Advisory retainer')

      fireEvent.click(within(cardFor('Advisory retainer')).getByRole('button', { name: 'Edit "Advisory retainer"' }))
      await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Advisory retainer'))
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'half-typed edit' } })
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()

      fireEvent.click(within(cardFor('Platform advisory')).getByRole('button', { name: 'Edit "Platform advisory"' }))
      await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Platform advisory'))
      // T&M's own columns, not the retainer's, and no trace of the edit
      // typed into the previous one.
      expect((screen.getByLabelText('Estimated hours') as HTMLInputElement).value).toBe('30')
      expect(screen.queryByLabelText('Hours included')).toBeNull()
    })

    it('returns focus to the card control the sheet was opened from', async () => {
      renderWithGet()
      await screen.findByText('Advisory retainer')

      const trigger = within(cardFor('Advisory retainer')).getByRole('button', { name: 'Edit "Advisory retainer"' })
      fireEvent.click(trigger)
      await screen.findByRole('dialog', { name: 'Edit engagement' })

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(document.activeElement).toBe(trigger)
    })

    it('leaves the anchor the command palette scrolls to on the card, one per engagement', async () => {
      renderEngagements()
      await screen.findByText('Advisory retainer')

      // The restructured card must not move or duplicate this (this task's
      // Risks) — ⌘K lands on this view and scrolls to the row by id.
      for (const engagement of ALL_ENGAGEMENTS) {
        expect(document.querySelectorAll(`#${CSS.escape(engagementAnchorId(engagement.id))}`)).toHaveLength(1)
      }
    })

    it('saves the edit through engagements:update and the card shows the new name without a reload', async () => {
      renderWithGet()
      await screen.findByText('Advisory retainer')

      const renamed = { ...retainerEngagement, name: 'Advisory retainer (renewed)' }
      const update = vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: renamed } }))
      const list = vi.fn(async () => ({
        ok: true as const,
        data: ALL_ENGAGEMENTS.map((engagement) => (engagement.id === renamed.id ? renamed : engagement))
      }))
      window.crm = { ...window.crm, 'engagements:update': update, 'engagements:list': list }

      fireEvent.click(within(cardFor('Advisory retainer')).getByRole('button', { name: 'Edit "Advisory retainer"' }))
      await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Advisory retainer'))
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Advisory retainer (renewed)' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
      // The list is invalidated on success (useSheetMutation), so the card
      // re-renders from the refetch rather than from a page reload.
      expect(await screen.findByText('Advisory retainer (renewed)')).toBeTruthy()
    })
  })
})
