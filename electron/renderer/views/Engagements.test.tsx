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
  // The hours basis, so the edit sheet opened on this card shows the pair
  // that prices it (migration 0008) rather than the flat-amount default.
  retainerBasis: 'hours',
  monthlyAmountCents: null,
  hoursIncluded: 20,
  // 20 hrs x $165 = $3,300/mo. The card states that product, so the rate has
  // to be here — a retainer with an allowance and no rate is exactly the
  // half-priced state migration 0008 exists to make visible.
  hourlyRateCents: 16_500,
  endsOn: null
})

const fixedEngagement = makeEngagement({
  id: 'eng-fixed',
  name: 'Fixed-scope build',
  billingCompanyId: 'co-biller',
  clientCompanyId: 'co-client',
  billingModel: 'fixed',
  status: 'active',
  contractValueCents: 1_800_000,
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
  hourlyRateCents: 16_500,
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
    'milestones:list': vi.fn(async (payload: { engagementId: string }) => ({
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
  it('states what each engagement is worth, in the shape its billing model is priced in', async () => {
    // T-260902-10. These cards used to read "0 of 20 hrs this month" and
    // "0 of ~30 hrs" — a hardcoded 0 out of an allowance, waiting on a
    // timelog import the app is not going to have. What a card can say is
    // the engagement's own headline price, which ADR-003 names as one of its
    // two explicit exceptions to "revenue comes from revenue_lines".
    renderEngagements()
    await screen.findByText('Advisory retainer')

    // 20 hrs x $165.
    expect(within(cardFor('Advisory retainer')).getByText('$3300.00 / mo')).toBeTruthy()
    expect(within(cardFor('Advisory retainer')).getByText('20 hrs × $165.00')).toBeTruthy()

    expect(within(cardFor('Fixed-scope build')).getByText('$18000.00')).toBeTruthy()
    expect(await within(cardFor('Fixed-scope build')).findByText('1 of 3 milestones')).toBeTruthy()

    // 30 hrs x $165 is $4,950, under the $5,000 cap, so the cap does not bite.
    expect(within(cardFor('Platform advisory')).getByText('$4950.00')).toBeTruthy()
    expect(within(cardFor('Platform advisory')).getByText('~30 hrs × $165.00 / hr')).toBeTruthy()
  })

  it('a T&M estimate above its not-to-exceed is stated at the cap, not above it', async () => {
    // The cap is the number that will actually be invoiced, so it is the
    // number the card shows. 40 x $165 = $6,600 against a $5,000 ceiling.
    renderEngagements({
      engagements: [makeEngagement({ ...tmEngagement, id: 'eng-capped', name: 'Capped work', estimatedHours: 40 })]
    })
    await screen.findByText('Capped work')

    expect(within(cardFor('Capped work')).getByText('$5000.00')).toBeTruthy()
    expect(within(cardFor('Capped work')).queryByText('$6600.00')).toBeNull()
  })

  it('an unpriced engagement says so rather than showing a zero', async () => {
    // A retainer written before migration 0008 has no basis and no amount.
    // "$0.00 / mo" would be a claim about its terms; "No price set" is the
    // truth and is also the prompt to go and fix it.
    renderEngagements({
      engagements: [
        makeEngagement({
          id: 'eng-unpriced',
          name: 'Unpriced retainer',
          billingModel: 'retainer',
          status: 'active',
          retainerBasis: null,
          monthlyAmountCents: null,
          hoursIncluded: null
        })
      ]
    })
    await screen.findByText('Unpriced retainer')

    expect(within(cardFor('Unpriced retainer')).getByText('No price set')).toBeTruthy()
    expect(cardFor('Unpriced retainer').textContent).not.toContain('$0')
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

  it('claims no hours at all — no "Provisional", no consumed figure, no empty bar', async () => {
    // The inverse of what this test used to assert. Two cards carried a
    // "Provisional" tag because the hours beside it were a hardcoded 0
    // waiting on a timelog import (P4-05). T-260902-10 removed the figure,
    // so the tag that excused it has nothing left to excuse — and the app no
    // longer implies it tracks hours, which it does not and is not going to.
    renderEngagements()
    await screen.findByText('Advisory retainer')

    expect(screen.queryAllByText('Provisional')).toHaveLength(0)
    expect(screen.queryByText(/0 of \d+ hrs/)).toBeNull()
    expect(screen.queryByText(/hrs this month/)).toBeNull()
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
      'milestones:list': vi.fn(async () => ({ ok: true as const, data: [] }))
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

  it('states one engagement\'s own price and never a total across them', async () => {
    // This test used to assert that a card showed no dollar amount at all,
    // which was the right rule read one notch too strictly: ADR-003 forbids
    // *aggregation and attribution*, and explicitly permits "a single
    // engagement's own headline price ... it states the engagement's terms;
    // it does not aggregate."
    //
    // What must still be absent is anything summed: no total across the
    // cards, and no annualised projection of one — "$3,300/mo x 12" is an
    // attribution to periods, which is `revenue_lines`' job and the
    // generator's (P3-05 / T-260902-03), not a card's.
    renderEngagements()
    await screen.findByText('Advisory retainer')

    expect(within(cardFor('Advisory retainer')).getByText('$3300.00 / mo')).toBeTruthy()
    // No annual figure anywhere: 20 x 165 x 12 = $39,600.
    expect(screen.queryByText(/39600/)).toBeNull()
    expect(screen.queryByText(/\/ *yr/)).toBeNull()
    // And no portfolio total: the three priced cards come to $26,250.
    expect(screen.queryByText(/26250/)).toBeNull()
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
      expect((screen.getByLabelText('Hours per month') as HTMLInputElement).value).toBe('20')
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
      expect(screen.queryByLabelText('Hours per month')).toBeNull()
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
