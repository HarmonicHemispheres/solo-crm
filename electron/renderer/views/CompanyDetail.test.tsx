import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { CrmApi } from '../../shared/ipc-types'
import type { Company } from '../../shared/companies'
import type { Engagement } from '../../shared/engagements'
import { CompanyDetail } from './CompanyDetail'

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

function makeEngagement(overrides: Partial<Engagement> & { id: string; name: string }): Engagement {
  return {
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

/** A stub `CrmApi` backed by a mutable companies map, so `companies:update`
 * persists and a refetch (triggered by the mutation's own
 * `invalidate.companies`) reads back what was actually written — the
 * "verified by reading the row back" half of this task's acceptance. */
function buildCrm(companySeed: readonly Company[], engagementSeed: readonly Engagement[]): CrmApi {
  const companies = new Map(companySeed.map((c) => [c.id, c] as const))
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
