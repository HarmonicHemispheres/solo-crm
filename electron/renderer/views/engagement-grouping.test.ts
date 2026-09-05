import { describe, expect, it } from 'vitest'
import { UNGROUPED_KEY, filterCounts, filterEngagements, groupEngagements } from './engagement-grouping'
import type { Company } from '../../shared/companies'
import type { EngagementWithOffering } from '../../shared/engagements'

/**
 * The ordering and counting rules, stated directly rather than read out of a
 * rendered list. `Engagements.test.tsx` covers what the page does with them.
 */

const TS = '2026-08-28T00:00:00.000Z'

function engagement(overrides: Partial<EngagementWithOffering> & { id: string; name: string }): EngagementWithOffering {
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

function company(id: string, name: string): Company {
  return {
    id,
    name,
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
    updatedAt: TS
  }
}

const COMPANIES = new Map([
  ['co-zebra', company('co-zebra', 'Zebra Co')],
  ['co-acme', company('co-acme', 'Acme')],
  ['co-mid', company('co-mid', 'Midway')]
])

describe('groupEngagements — by client', () => {
  it('files an engagement under the party that is invoiced, not the one the work is for', () => {
    // Split billing is the case this page has to get right: work delivered
    // for an end client but billed through a partner belongs to the partner,
    // because that is whose invoice it is on.
    const rows = [engagement({ id: 'a', name: 'A', billingCompanyId: 'co-acme', clientCompanyId: 'co-mid' })]
    const groups = groupEngagements(rows, 'client', COMPANIES)

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Acme')
    expect(groups[0].companyId).toBe('co-acme')
  })

  it('sorts clients alphabetically and puts engagements with no billing party last', () => {
    // Alphabetical, not by size: someone comes to this page looking for one
    // client, and "biggest first" makes every card's position depend on data
    // that moves.
    const rows = [
      engagement({ id: 'z', name: 'Z', billingCompanyId: 'co-zebra' }),
      engagement({ id: 'n', name: 'N', billingCompanyId: null }),
      engagement({ id: 'a', name: 'A', billingCompanyId: 'co-acme' }),
      engagement({ id: 'm', name: 'M', billingCompanyId: 'co-mid' })
    ]

    expect(groupEngagements(rows, 'client', COMPANIES).map((group) => group.label)).toEqual(['Acme', 'Midway', 'Zebra Co', 'No billing party'])
  })

  it('keeps a company the list does not know rather than dropping its engagements', () => {
    // A stale id still has real work under it. Silently losing those rows is
    // worse than a card headed with an id.
    const rows = [engagement({ id: 'a', name: 'A', billingCompanyId: 'co-gone' })]
    const groups = groupEngagements(rows, 'client', COMPANIES)

    expect(groups[0].label).toBe('co-gone')
    expect(groups[0].rows).toHaveLength(1)
  })

  it('puts live work above finished work inside a group, most recent first within a band', () => {
    const rows = [
      engagement({ id: 'old-active', name: 'Old active', billingCompanyId: 'co-acme', status: 'active', startedOn: '2024-01-01' }),
      engagement({ id: 'lost', name: 'Lost', billingCompanyId: 'co-acme', status: 'lost', startedOn: '2026-05-01' }),
      engagement({ id: 'new-active', name: 'New active', billingCompanyId: 'co-acme', status: 'active', startedOn: '2026-03-01' }),
      engagement({ id: 'delivered', name: 'Delivered', billingCompanyId: 'co-acme', status: 'delivered', startedOn: '2026-06-01' })
    ]

    expect(groupEngagements(rows, 'client', COMPANIES)[0].rows.map((row) => row.name)).toEqual([
      'New active',
      'Old active',
      'Delivered',
      'Lost'
    ])
  })

  it('sorts a status the vocabulary does not name to the end rather than to the front', () => {
    // `status` is nullable on the row. Ranking an unknown at 0 would put
    // every unclassified engagement above the live work.
    const rows = [
      engagement({ id: 'null', name: 'Unclassified', billingCompanyId: 'co-acme', status: null }),
      engagement({ id: 'active', name: 'Active', billingCompanyId: 'co-acme', status: 'active' })
    ]

    expect(groupEngagements(rows, 'client', COMPANIES)[0].rows.map((row) => row.name)).toEqual(['Active', 'Unclassified'])
  })
})

describe('groupEngagements — by status and model', () => {
  it('keeps the vocabulary’s own order and omits a group with nothing in it', () => {
    const rows = [
      engagement({ id: 'l', name: 'L', status: 'lost' }),
      engagement({ id: 'a', name: 'A', status: 'active' })
    ]

    expect(groupEngagements(rows, 'status', COMPANIES).map((group) => group.label)).toEqual(['Active', 'Lost'])
  })

  it('gives a status group its own status, so the header can draw a swatch', () => {
    const groups = groupEngagements([engagement({ id: 'a', name: 'A', status: 'active' })], 'status', COMPANIES)
    expect(groups[0].status).toBe('active')
    expect(groups[0].companyId).toBeNull()
  })

  it('collects engagements with no billing model into their own group, last', () => {
    const rows = [
      engagement({ id: 'x', name: 'X', billingModel: null }),
      engagement({ id: 'r', name: 'R', billingModel: 'retainer' })
    ]
    const groups = groupEngagements(rows, 'model', COMPANIES)

    expect(groups.map((group) => group.label)).toEqual(['Retainer', 'No billing model'])
    expect(groups[1].key).toBe(UNGROUPED_KEY)
  })

  it('accounts for every engagement exactly once, in every mode', () => {
    // The property that makes a grouping trustworthy: nothing quietly falls
    // between two groups because its status or model is null.
    const rows = [
      engagement({ id: '1', name: 'One', billingCompanyId: 'co-acme', status: 'active', billingModel: 'retainer' }),
      engagement({ id: '2', name: 'Two', billingCompanyId: null, status: null, billingModel: null }),
      engagement({ id: '3', name: 'Three', billingCompanyId: 'co-mid', status: 'lost', billingModel: 'equity' })
    ]

    for (const mode of ['client', 'model'] as const) {
      const seen = groupEngagements(rows, mode, COMPANIES).flatMap((group) => group.rows.map((row) => row.id))
      expect([...seen].sort(), `${mode} lost or duplicated a row`).toEqual(['1', '2', '3'])
    }
    // Status is the exception, and deliberately: a row with no status is not
    // in any of the six groups, because there is no group it belongs to and
    // inventing a seventh would put one row's missing field in the nav.
    expect(groupEngagements(rows, 'status', COMPANIES).flatMap((group) => group.rows.map((row) => row.id)).sort()).toEqual(['1', '3'])
  })
})

describe('filtering', () => {
  const ROWS = [
    engagement({ id: 'ar', name: 'Active retainer', status: 'active', billingModel: 'retainer' }),
    engagement({ id: 'af', name: 'Active fixed', status: 'active', billingModel: 'fixed' }),
    engagement({ id: 'df', name: 'Delivered fixed', status: 'delivered', billingModel: 'fixed' })
  ]

  it('applies both axes together', () => {
    expect(filterEngagements(ROWS, 'active', 'all').map((row) => row.id)).toEqual(['ar', 'af'])
    expect(filterEngagements(ROWS, 'all', 'fixed').map((row) => row.id)).toEqual(['af', 'df'])
    expect(filterEngagements(ROWS, 'active', 'fixed').map((row) => row.id)).toEqual(['af'])
  })

  it('counts each axis against the other, so a chip’s number is what pressing it produces', () => {
    // Counting the unfiltered list instead would show "Delivered 1" beside a
    // chosen Retainer filter and then produce nothing.
    const counts = filterCounts(ROWS, 'all', 'fixed')
    expect(counts.byStatus.get('active')).toBe(1)
    expect(counts.byStatus.get('delivered')).toBe(1)
    expect(counts.total).toBe(2)

    const underActive = filterCounts(ROWS, 'active', 'all')
    expect(underActive.byModel.get('fixed')).toBe(1)
    expect(underActive.byModel.get('retainer')).toBe(1)
  })

  it('never counts a combination that would be empty as available', () => {
    // The guarantee the chips rest on: every status offered under a model
    // filter leaves at least one row. `delivered` + `retainer` is empty here,
    // so `delivered` must not be counted under `retainer`.
    const counts = filterCounts(ROWS, 'all', 'retainer')
    expect(counts.byStatus.get('delivered')).toBeUndefined()
    expect(counts.byStatus.get('active')).toBe(1)
  })

  it('leaves a row with a null status or model out of both counts without dropping it from the total', () => {
    const rows = [...ROWS, engagement({ id: 'x', name: 'Unclassified' })]
    const counts = filterCounts(rows, 'all', 'all')

    expect(counts.total).toBe(4)
    expect([...counts.byStatus.values()].reduce((sum, n) => sum + n, 0)).toBe(3)
    expect([...counts.byModel.values()].reduce((sum, n) => sum + n, 0)).toBe(3)
  })
})
