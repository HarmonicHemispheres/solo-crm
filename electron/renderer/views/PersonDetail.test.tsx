import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../lib/query-client'
import { keyDownWithUnmountBlur } from '../lib/test-support/unmount-blur'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { CrmApi } from '../../shared/ipc-types'
import type { Company } from '../../shared/companies'
import type { Person, PersonAffiliation, PersonWithAffiliations } from '../../shared/people'
import type { Activity } from '../../shared/activity'
import { PersonDetail } from './PersonDetail'

/**
 * This task's Why in one sentence: a person detail page that shows one
 * current company and nothing else has left the affiliation model's whole
 * value on the floor. The tests below check the two things that failure
 * mode would get wrong — the closed stint still shows with its own date
 * range, and activity follows the person past a company change — not just
 * that the page renders.
 */

const TS = '2026-08-28T00:00:00.000Z'

function makePerson(overrides: Partial<Person> & { id: string; name: string }): Person {
  return {
    email: null,
    phone: null,
    notes: null,
    lastContactAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeCompany(overrides: Partial<Company> & { id: string; name: string }): Company {
  return {
    kind: null,
    website: null,
    billsDirectly: null,
    billedViaCompanyId: null,
    introducedByPersonId: null,
    cadenceDays: null,
    lastTouchAt: null,
    notes: null,
    since: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeAffiliation(
  overrides: Partial<PersonAffiliation> & { id: string; personId: string; companyId: string; started: string; current: boolean }
): PersonAffiliation {
  return {
    title: null,
    isPrimary: null,
    ended: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

function makeActivity(overrides: Partial<Activity> & { id: string }): Activity {
  return {
    occurredAt: TS,
    kind: 'note',
    title: 'Activity',
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

// -- fixture: Priya worked at Rinvii (now closed) before moving to
// EZDeploy, where she's the current, primary contact. One activity row hung
// on each company while she was there. --

const ezdeploy = makeCompany({ id: 'co-ezdeploy', name: 'EZDeploy' })
const rinvii = makeCompany({ id: 'co-rinvii', name: 'Rinvii' })
const lonely = makeCompany({ id: 'co-lonely', name: 'Lonely Co' })

const priya = makePerson({ id: 'pe-priya', name: 'Priya Rao', email: 'priya@example.com' })
const noAffiliations = makePerson({ id: 'pe-solo', name: 'Solo Person' })

const priyaAtRinvii = makeAffiliation({
  id: 'aff-priya-rinvii',
  personId: 'pe-priya',
  companyId: 'co-rinvii',
  title: 'VP Engineering',
  started: '2025-01-10',
  ended: '2026-01-31',
  current: false
})
const priyaAtEzdeploy = makeAffiliation({
  id: 'aff-priya-ezdeploy',
  personId: 'pe-priya',
  companyId: 'co-ezdeploy',
  title: 'CTO',
  started: '2026-02-01',
  current: true,
  isPrimary: true
})

const actAtRinvii = makeActivity({
  id: 'act-rinvii',
  title: 'Kickoff call',
  kind: 'call',
  companyId: 'co-rinvii',
  personId: 'pe-priya',
  occurredAt: '2025-03-01T10:00:00.000Z'
})
const actAtEzdeploy = makeActivity({
  id: 'act-ezdeploy',
  title: 'Renewal note',
  kind: 'note',
  companyId: 'co-ezdeploy',
  personId: 'pe-priya',
  occurredAt: '2026-06-01T10:00:00.000Z'
})

const ALL_COMPANIES = [ezdeploy, rinvii, lonely]

function buildCrm(
  people: Record<string, PersonWithAffiliations>,
  companies: readonly Company[],
  activity: readonly Activity[]
): CrmApi {
  const peopleMap = new Map(Object.entries(people))
  return stubCrm({
    'people:get': vi.fn(async (payload) => ({ ok: true as const, data: peopleMap.get(payload.id) ?? null })),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'people:update': vi.fn(async (payload) => {
      const current = peopleMap.get(payload.id)
      if (!current) {
        return { ok: true as const, data: { ok: false as const, error: { code: 'not-found' as const, message: 'not found' } } }
      }
      const updated: PersonWithAffiliations = { ...current, ...payload.patch, updatedAt: TS }
      peopleMap.set(payload.id, updated)
      return { ok: true as const, data: { ok: true as const, data: updated } }
    }),
    'people:move': vi.fn(async (payload) => {
      const current = peopleMap.get(payload.personId)
      if (!current) {
        return { ok: true as const, data: { ok: false as const, error: { code: 'not-found' as const, message: 'not found' } } }
      }
      const closed = current.affiliations.map((affiliation) =>
        affiliation.current ? { ...affiliation, ended: payload.options.on, current: false } : affiliation
      )
      const opened: PersonAffiliation = {
        id: 'aff-new',
        personId: payload.personId,
        companyId: payload.toCompanyId,
        title: null,
        isPrimary: false,
        started: payload.options.on,
        ended: null,
        current: true,
        createdAt: TS,
        updatedAt: TS
      }
      const updated: PersonWithAffiliations = { ...current, affiliations: [...closed, opened] }
      peopleMap.set(payload.personId, updated)
      return { ok: true as const, data: { ok: true as const, data: opened } }
    }),
    'activity:list': vi.fn(async (payload) => {
      let result = activity
      if (payload?.personId != null) result = result.filter((entry) => entry.personId === payload.personId)
      return { ok: true as const, data: result }
    })
  })
}

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assigns.
  delete window.crm
})

function renderPersonDetail(personId: string, crm: CrmApi) {
  window.crm = crm
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[`/person/${personId}`]}>
        <Routes>
          <Route path="/person/:id" element={<PersonDetail />} />
          <Route path="/people" element={<div>People index</div>} />
          <Route path="/company/:id" element={<div data-testid="company-detail" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('PersonDetail', () => {
  it('shows both affiliations — the closed one with its own date range, the open one marked current', async () => {
    const crm = buildCrm(
      { 'pe-priya': { ...priya, affiliations: [priyaAtRinvii, priyaAtEzdeploy] } },
      ALL_COMPANIES,
      []
    )
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    const affiliationsCard = screen.getByText('Affiliations').closest('.card') as HTMLElement
    expect(within(affiliationsCard).getByText('Rinvii')).toBeTruthy()
    expect(within(affiliationsCard).getByText('EZDeploy')).toBeTruthy()
    // The closed stint's own range — not blank, not "present".
    expect(within(affiliationsCard).getByText(/VP Engineering/)).toBeTruthy()
    expect(within(affiliationsCard).getByText(/Jan 25.*Jan 26/)).toBeTruthy()
    // The open stint reads "present", and only it carries "Current".
    expect(within(affiliationsCard).getByText(/Feb 26.*present/)).toBeTruthy()
    expect(within(affiliationsCard).getByText('Current')).toBeTruthy()
    expect(within(affiliationsCard).getAllByText('Current')).toHaveLength(1)
  })

  it('shows activity involving the person regardless of which company the row carries', async () => {
    const crm = buildCrm(
      { 'pe-priya': { ...priya, affiliations: [priyaAtRinvii, priyaAtEzdeploy] } },
      ALL_COMPANIES,
      [actAtRinvii, actAtEzdeploy]
    )
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    const activityCard = screen.getByText('Shared history').closest('.card') as HTMLElement
    // Priya has since left Rinvii — a companyId filter would miss this row;
    // a personId filter (what this page actually uses) does not.
    expect(within(activityCard).getByText('Kickoff call')).toBeTruthy()
    expect(within(activityCard).getByText('Renewal note')).toBeTruthy()
    expect(crm['activity:list']).toHaveBeenCalledWith({ personId: 'pe-priya' })
  })

  it('renders a person with no affiliation at all without error and without inventing a company', async () => {
    const crm = buildCrm({ 'pe-solo': { ...noAffiliations, affiliations: [] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-solo', crm)
    await screen.findByRole('heading', { name: 'Solo Person' })

    const affiliationsCard = screen.getByText('Affiliations').closest('.card') as HTMLElement
    expect(within(affiliationsCard).getByText('No affiliations yet.')).toBeTruthy()
    const detailsCard = screen.getByText('Details').closest('.card') as HTMLElement
    // "Company" reads "—", never a fabricated name — the Company field's own
    // value cell, not the (also-empty) email/phone/notes fields beside it.
    const companyField = within(detailsCard).getByText('Company').closest('.field') as HTMLElement
    expect(within(companyField).getByText('—')).toBeTruthy()
    // No affiliation at all — the move form offers to assign one, not move
    // "to another" company.
    expect(within(detailsCard).getByText('Assign a company')).toBeTruthy()
  })

  it('shows "not found" for an unknown id, not a crash or an infinite spinner', async () => {
    const crm = buildCrm({}, ALL_COMPANIES, [])
    renderPersonDetail('does-not-exist', crm)
    expect(await screen.findByText(/not found/i)).toBeTruthy()
  })

  it('moving a person to a new company closes the old affiliation with an ended date instead of deleting it, verified by reading both rows back', async () => {
    const crm = buildCrm({ 'pe-priya': { ...priya, affiliations: [priyaAtEzdeploy] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    fireEvent.change(screen.getByLabelText('Company to move to'), { target: { value: 'co-rinvii' } })
    fireEvent.change(screen.getByLabelText('Effective date'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() =>
      expect(crm['people:move']).toHaveBeenCalledWith({
        personId: 'pe-priya',
        toCompanyId: 'co-rinvii',
        options: { on: '2026-09-01' }
      })
    )

    // Reading both rows back: the EZDeploy stint is closed (not gone) with
    // the move's own date, and a new open Rinvii stint exists alongside it.
    const affiliationsCard = await screen.findByText('Affiliations')
    const card = affiliationsCard.closest('.card') as HTMLElement
    await waitFor(() => expect(within(card).getByText('Rinvii')).toBeTruthy())
    expect(within(card).getByText('EZDeploy')).toBeTruthy()
    expect(within(card).getAllByText('Current')).toHaveLength(1)
    expect(within(card).getByText(/Sep 26.*present/)).toBeTruthy()
  })

  it('editing a details-card field writes only that column, verified by reading the row back', async () => {
    const crm = buildCrm({ 'pe-priya': { ...priya, affiliations: [priyaAtEzdeploy] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    fireEvent.click(screen.getByRole('button', { name: 'priya@example.com' }))
    const input = screen.getByLabelText('Email')
    fireEvent.change(input, { target: { value: 'priya@newmail.com' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(crm['people:update']).toHaveBeenCalledWith({ id: 'pe-priya', patch: { email: 'priya@newmail.com' } })
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'priya@newmail.com' })).toBeTruthy())
  })

  it('Escape cancels an in-progress edit without writing anything', async () => {
    const crm = buildCrm({ 'pe-priya': { ...priya, affiliations: [priyaAtEzdeploy] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    fireEvent.click(screen.getByRole('button', { name: 'priya@example.com' }))
    const input = screen.getByLabelText('Email')
    fireEvent.change(input, { target: { value: 'discarded@example.com' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByRole('button', { name: 'priya@example.com' })).toBeTruthy()
    expect(crm['people:update']).not.toHaveBeenCalled()
  })

  // T-260901-25: jsdom fires no blur when a focused element is removed;
  // Chromium does, and it reached `commit` with the discarded draft. See
  // `keyDownWithUnmountBlur` for why a trailing `fireEvent.blur` is not it.
  it('Escape discards the draft even through the blur that unmounting the field carries with it', async () => {
    const crm = buildCrm({ 'pe-priya': { ...priya, affiliations: [priyaAtEzdeploy] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    fireEvent.click(screen.getByRole('button', { name: 'priya@example.com' }))
    const input = screen.getByLabelText('Email')
    fireEvent.change(input, { target: { value: 'discarded@example.com' } })
    await keyDownWithUnmountBlur(input, 'Escape')

    expect(screen.getByRole('button', { name: 'priya@example.com' })).toBeTruthy()
    expect(crm['people:update']).not.toHaveBeenCalled()
  })

  it('Enter commits once — the unmount blur does not write a second time', async () => {
    const crm = buildCrm({ 'pe-priya': { ...priya, affiliations: [priyaAtEzdeploy] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    fireEvent.click(screen.getByRole('button', { name: 'priya@example.com' }))
    const input = screen.getByLabelText('Email')
    fireEvent.change(input, { target: { value: 'priya@newdomain.example' } })
    await keyDownWithUnmountBlur(input, 'Enter')

    await waitFor(() => expect(crm['people:update']).toHaveBeenCalledTimes(1))
  })

  it('following the current company link navigates to that company', async () => {
    const crm = buildCrm({ 'pe-priya': { ...priya, affiliations: [priyaAtEzdeploy] } }, ALL_COMPANIES, [])
    renderPersonDetail('pe-priya', crm)
    await screen.findByRole('heading', { name: 'Priya Rao' })

    const detailsCard = screen.getByText('Details').closest('.card') as HTMLElement
    fireEvent.click(within(detailsCard).getByRole('link', { name: 'EZDeploy' }))

    expect(await screen.findByTestId('company-detail')).toBeTruthy()
  })
})
