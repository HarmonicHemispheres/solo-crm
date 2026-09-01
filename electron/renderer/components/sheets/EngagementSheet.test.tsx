import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { EngagementSheet } from './EngagementSheet'
import type { SheetFormTarget } from '../shell/layer-manager-context'
import type { EngagementWithOffering } from '../../../shared/engagements'
import type { OfferingListItem } from '../../../shared/offerings'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** A full `engagementSchema`-shaped row — `window.crm` is typed, so a mocked `engagements:create` response has to satisfy it even though these tests only assert on what was *sent*. */
const STUB_ENGAGEMENT_ROW: EngagementWithOffering = {
  id: 'new-eng',
  name: 'stub',
  billingCompanyId: null,
  clientCompanyId: null,
  offeringVersionId: null,
  agreedRateCents: null,
  offeringId: null,
  offeringName: null,
  billingModel: null,
  status: null,
  startedOn: '2026-08-28',
  endsOn: null,
  renewsOn: null,
  hoursIncluded: null,
  contractValueCents: null,
  hourlyRateCents: null,
  estimatedHours: null,
  notToExceedCents: null,
  notes: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

const STUB_COMPANIES = [
  {
    id: 'billing-co',
    name: 'Billing Co',
    kind: null,
    website: null,
    billsDirectly: true,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: null,
    lastTouchAt: null,
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z'
  },
  {
    id: 'client-co',
    name: 'Client Co',
    kind: null,
    website: null,
    billsDirectly: true,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: null,
    lastTouchAt: null,
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z'
  }
]

const TS = '2026-08-28T00:00:00.000Z'

/**
 * The price list the "Sold as" picker reads (T-260901-13). The advisory
 * retainer is deliberately on its **second** version: an engagement created
 * from it must store `ver-advisory-2`, not the offering id and not the first
 * version, and the $3,500 the acceptance names is that version's rate.
 */
function makeOffering(overrides: Partial<OfferingListItem> & { id: string; name: string }): OfferingListItem {
  return {
    type: 'service',
    categoryId: null,
    billingModel: 'retainer',
    unit: 'mo',
    blurb: null,
    active: true,
    createdAt: TS,
    updatedAt: TS,
    currentVersion: null,
    ...overrides
  }
}

const ADVISORY_OFFERING = makeOffering({
  id: 'off-advisory',
  name: 'Advisory retainer',
  currentVersion: {
    id: 'ver-advisory-2',
    offeringId: 'off-advisory',
    version: 2,
    rateCents: 350_000,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: TS,
    updatedAt: TS
  }
})

const RESCUE_OFFERING = makeOffering({
  id: 'off-rescue',
  name: 'Delivery rescue',
  billingModel: 'fixed',
  unit: 'from',
  currentVersion: {
    id: 'ver-rescue-1',
    offeringId: 'off-rescue',
    version: 1,
    rateCents: 1_200_000,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: TS,
    updatedAt: TS
  }
})

const STUB_OFFERINGS = [ADVISORY_OFFERING, RESCUE_OFFERING]

const CREATE: SheetFormTarget = { mode: 'create' }

function renderSheet(onClose = vi.fn(), overrides: Parameters<typeof stubCrm>[0] = {}, target: SheetFormTarget = CREATE) {
  window.crm = stubCrm({
    'companies:list': vi.fn(async () => ({ ok: true as const, data: STUB_COMPANIES })),
    'offerings:list': vi.fn(async () => ({ ok: true as const, data: STUB_OFFERINGS })),
    ...overrides
  })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <EngagementSheet onClose={onClose} target={target} />
    </QueryClientProvider>
  )
  return { onClose }
}

/**
 * An edit sheet opened on `engagement`, with `engagements:get` answering
 * with it. Waits for the form itself, not the placeholder — every edit test
 * below is about what the loaded record put in the fields.
 */
async function renderEditSheet(engagement: EngagementWithOffering, overrides: Parameters<typeof stubCrm>[0] = {}, onClose = vi.fn()) {
  renderSheet(
    onClose,
    { 'engagements:get': vi.fn(async () => ({ ok: true as const, data: engagement })), ...overrides },
    { mode: 'edit', id: engagement.id }
  )
  await screen.findByLabelText('Name')
  return { onClose }
}

function makeEngagement(overrides: Partial<EngagementWithOffering> & { id: string; name: string }): EngagementWithOffering {
  return { ...STUB_ENGAGEMENT_ROW, ...overrides }
}

/** A retainer with a value in every shared column, plus an `agreedRateCents` the form must never send back. */
const RETAINER = makeEngagement({
  id: 'eng-retainer',
  name: 'Advisory retainer',
  billingCompanyId: 'billing-co',
  clientCompanyId: 'client-co',
  billingModel: 'retainer',
  status: 'pending',
  startedOn: '2026-02-01',
  endsOn: '2026-12-31',
  hoursIncluded: 12,
  agreedRateCents: 15_000
})

/** The second billing model the acceptance list asks for, with all three of T&M's own columns populated. */
const TM = makeEngagement({
  id: 'eng-tm',
  name: 'Platform advisory',
  billingCompanyId: 'billing-co',
  clientCompanyId: 'billing-co',
  billingModel: 'tm',
  status: 'active',
  startedOn: '2026-03-15',
  endsOn: null,
  hourlyRateCents: 16_500,
  estimatedHours: 30,
  notToExceedCents: 600_000,
  agreedRateCents: 20_000
})

/** The `patch` half of the one `engagements:update` call a test made. */
function patchFrom(update: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  expect(update).toHaveBeenCalledTimes(1)
  const payload = update.mock.calls[0][0] as { id: string; patch: Record<string, unknown> }
  return payload.patch
}

function stubUpdate() {
  return vi.fn(async (payload: unknown) => {
    void payload
    return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
  })
}

/** The "Sold as" select, once `offerings:list` has answered — the same wait `companySelects` makes for the company options. */
async function offeringSelect() {
  const sold = screen.getByLabelText('Sold as') as HTMLSelectElement
  await waitFor(() => expect(within(sold).getByText(/Advisory retainer/)).toBeTruthy())
  return sold
}

async function companySelects() {
  const billedTo = screen.getByLabelText('Billed to') as HTMLSelectElement
  await waitFor(() => expect(within(billedTo).getByText('Billing Co')).toBeTruthy())
  return { billedTo, workIsFor: screen.getByLabelText('Work is for') as HTMLSelectElement }
}

describe('EngagementSheet', () => {
  it('writes exactly the columns its footer claims for the default (retainer) model', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fixed scope SOW' } })
    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.name).toBe('Fixed scope SOW')
    expect(payload.billingModel).toBe('retainer')
    expect(payload.hoursIncluded).toBe(12)
    expect(payload.status).toBe('active')
    expect(payload.billingCompanyId).toBeNull()
    expect(payload.clientCompanyId).toBeNull()
    expect(payload.endsOn).toBeNull()
    expect(typeof payload.startedOn).toBe('string')
    // Only this model's own columns — no stray fixed/tm keys.
    expect(payload).not.toHaveProperty('contractValueCents')
    expect(payload).not.toHaveProperty('hourlyRateCents')
  })

  it('"Work is for" mirrors "Billed to" until edited, then holds its own value even when "Billed to" changes again', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })
    const { billedTo, workIsFor } = await companySelects()

    fireEvent.change(billedTo, { target: { value: 'billing-co' } })
    expect(workIsFor.value).toBe('billing-co')

    // Edited directly: now holds its own value.
    fireEvent.change(workIsFor, { target: { value: 'client-co' } })
    expect(workIsFor.value).toBe('client-co')

    // "Billed to" changes again — "Work is for" no longer follows.
    fireEvent.change(billedTo, { target: { value: '' } })
    expect(workIsFor.value).toBe('client-co')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Split billing' } })
    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.billingCompanyId).toBeNull()
    expect(payload.clientCompanyId).toBe('client-co')
  })

  it('an engagement saved with billing != client reads back with both columns distinct', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })
    const { billedTo, workIsFor } = await companySelects()

    fireEvent.change(billedTo, { target: { value: 'billing-co' } })
    fireEvent.change(workIsFor, { target: { value: 'client-co' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Split billing' } })
    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.billingCompanyId).toBe('billing-co')
    expect(payload.clientCompanyId).toBe('client-co')
    expect(payload.billingCompanyId).not.toBe(payload.clientCompanyId)
  })

  it('changing the billing model swaps the model-specific fields and loses nothing typed into the shared fields', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kept across model switches' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lost' }))
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-03-01' } })

    // Retainer's field is visible by default; switch away from it.
    expect(screen.getByLabelText('Hours included')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fixed scope' }))
    expect(screen.queryByLabelText('Hours included')).toBeNull()
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: '28500' } })

    fireEvent.click(screen.getByRole('button', { name: 'T&M' }))
    expect(screen.queryByLabelText('Contract value')).toBeNull()
    fireEvent.change(screen.getByLabelText('Hourly rate'), { target: { value: '165' } })
    fireEvent.change(screen.getByLabelText('Estimated hours'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Not to exceed'), { target: { value: '6000' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    // Shared fields survived every model switch.
    expect(payload.name).toBe('Kept across model switches')
    expect(payload.status).toBe('lost')
    expect(payload.startedOn).toBe('2026-03-01')
    // Only the final model's own columns are present.
    expect(payload.billingModel).toBe('tm')
    expect(payload.hourlyRateCents).toBe(16500)
    expect(payload.estimatedHours).toBe(30)
    expect(payload.notToExceedCents).toBe(600000)
    expect(payload).not.toHaveProperty('hoursIncluded')
    expect(payload).not.toHaveProperty('contractValueCents')
  })

  it('"lost" is selectable as a status', async () => {
    expect(() => renderSheet()).not.toThrow()
    expect(screen.getByRole('button', { name: 'Lost' })).toBeTruthy()
  })

  it('leaving "Ends on" empty stores NULL, not a sentinel', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rolling retainer' } })
    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '10' } })
    // "Ends" is never touched — stays at its default empty value.
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.endsOn).toBeNull()
    expect(payload.endsOn).not.toBe('')
  })

  it('names the field on a validation failure and does not close the sheet or lose input', async () => {
    const create = vi.fn()
    const { onClose } = renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/name/i)
    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Hours included') as HTMLInputElement).value).toBe('10')
  })

  it('renders an invalid amount against the Contract value field, named as the user sees it', async () => {
    const create = vi.fn()
    const { onClose } = renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad amount' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fixed scope' }))
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: '$28,500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    // Not `contractValueCents` — the column name the user has never seen
    // (T-260828-53 item 2).
    expect(alert.textContent).toBe('Contract value: "$28,500" is not a valid amount')
    expect(alert.textContent).not.toMatch(/contractValueCents/)

    // And it is attached to that field, not floating at the top of the sheet:
    // the Contract value input itself points at this message.
    const contractValue = screen.getByLabelText('Contract value')
    expect(contractValue.getAttribute('aria-invalid')).toBe('true')
    expect(contractValue.getAttribute('aria-describedby')).toBe(alert.id)
    expect(alert.id).not.toBe('')

    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves a failure no field owns as the sheet-level banner rather than dropping it', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return {
        ok: true as const,
        data: {
          ok: false as const,
          error: { code: 'refused' as const, message: 'the database is read-only right now' }
        }
      }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Refused' } })
    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('the database is read-only right now')
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull()
  })

  it('sells from an offering by storing that offering\'s current version and a copy of its rate', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })

    const sold = await offeringSelect()
    fireEvent.change(sold, { target: { value: 'off-advisory' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 advisory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    // The *version* id, not the offering id — and the second version, which
    // is the one the price list currently quotes.
    expect(payload.offeringVersionId).toBe('ver-advisory-2')
    expect(payload.offeringVersionId).not.toBe('off-advisory')
    // $3,500, copied at submit. This is the only place in the form that ever
    // sends `agreedRateCents`.
    expect(payload.agreedRateCents).toBe(350_000)
  })

  it('shows the price it is about to copy on the option, so the snapshot is visible when it is taken', async () => {
    renderSheet()
    const sold = await offeringSelect()

    expect(within(sold).getByText('Advisory retainer — $3500.00/mo')).toBeTruthy()
    // `unit: 'from'` reads as a starting price, not a per-unit one.
    expect(within(sold).getByText('Delivery rescue — from $12000.00')).toBeTruthy()
  })

  it('selling from no offering stores NULL and sends no rate at all', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT_ROW } }
    })
    renderSheet(vi.fn(), { 'engagements:create': create })

    // The picker is left at "— none —", the default.
    await offeringSelect()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsold work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.offeringVersionId).toBeNull()
    // Not `null` — absent. There is no snapshot to take, so no key is sent.
    expect(payload).not.toHaveProperty('agreedRateCents')
  })

  it('a create target still opens a blank form headed "New engagement"', async () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'New engagement' })).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })
})

describe('EngagementSheet — edit mode (T-260901-10)', () => {
  it('heads itself "Edit", not "New", in its title, accessible name and submit label', async () => {
    await renderEditSheet(RETAINER)
    const dialog = screen.getByRole('dialog', { name: 'Edit engagement' })
    expect(within(dialog).getByRole('heading', { name: 'Edit engagement' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
  })

  it('populates every field from a retainer record, including its model-specific column', async () => {
    await renderEditSheet(RETAINER)

    // The company selects need their options before a value can stick —
    // `companySelects` waits for `companies:list`, same as the create tests.
    const { billedTo, workIsFor } = await companySelects()

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Advisory retainer')
    expect(billedTo.value).toBe('billing-co')
    expect(workIsFor.value).toBe('client-co')
    expect((screen.getByLabelText('Starts') as HTMLInputElement).value).toBe('2026-02-01')
    expect((screen.getByLabelText('Ends') as HTMLInputElement).value).toBe('2026-12-31')
    expect((screen.getByLabelText('Hours included') as HTMLInputElement).value).toBe('12')
    // The two chip groups carry their selection through aria-pressed.
    expect(screen.getByRole('button', { name: 'Retainer', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pending', pressed: true })).toBeTruthy()
    // The other models' columns are not rendered at all for this model.
    expect(screen.queryByLabelText('Contract value')).toBeNull()
    expect(screen.queryByLabelText('Hourly rate')).toBeNull()
  })

  it("populates a T&M record's three model-specific columns, amounts back in the form they were typed in", async () => {
    await renderEditSheet(TM)

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Platform advisory')
    expect((screen.getByLabelText('Starts') as HTMLInputElement).value).toBe('2026-03-15')
    // `endsOn: null` means rolling — an empty date input, never a sentinel.
    expect((screen.getByLabelText('Ends') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Hourly rate') as HTMLInputElement).value).toBe('165.00')
    expect((screen.getByLabelText('Estimated hours') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('Not to exceed') as HTMLInputElement).value).toBe('6000.00')
    expect(screen.getByRole('button', { name: 'T&M', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Active', pressed: true })).toBeTruthy()
  })

  it('saves through engagements:update carrying only the fields that changed', async () => {
    const update = stubUpdate()
    await renderEditSheet(RETAINER, { 'engagements:update': update })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Advisory retainer (renewed)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const payload = update.mock.calls[0][0] as { id: string; patch: Record<string, unknown> }
    expect(payload.id).toBe('eng-retainer')
    // Nothing else was touched, so nothing else travels — not the untouched
    // shared columns, and not the model the untouched hours belong to.
    expect(payload.patch).toEqual({ name: 'Advisory retainer (renewed)' })
  })

  it('never sends agreedRateCents — not on an ordinary edit, and not when the billing model changes', async () => {
    const update = stubUpdate()
    await renderEditSheet(RETAINER, { 'engagements:update': update })

    fireEvent.click(screen.getByRole('button', { name: 'Fixed scope' }))
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: '28500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // The record carries agreedRateCents: 15000 and the update schema would
    // accept the key — `updateEngagement` drops it silently, which is why
    // "it looked like it worked" is the failure mode this pins. The form
    // never builds a payload that could contain it.
    expect(patchFrom(update)).not.toHaveProperty('agreedRateCents')
  })

  it("switching the billing model sends the new model's columns and none of the old model's", async () => {
    const update = stubUpdate()
    await renderEditSheet(RETAINER, { 'engagements:update': update })

    fireEvent.click(screen.getByRole('button', { name: 'Fixed scope' }))
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: '28500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // Exactly the shape `updateEngagement`'s own "switches billingModel from
    // retainer to fixed writes the new field and clears the old one" test
    // (repositories/engagements.test.ts) proves resets the outgoing model's
    // columns: the discriminant is present and changed, the new model's
    // column is present, the old model's is absent rather than carried over
    // stale.
    expect(patchFrom(update)).toEqual({ billingModel: 'fixed', contractValueCents: 2_850_000 })
  })

  it("a model-specific edit within the same model still carries the discriminant, which is what the update schema's union needs", async () => {
    const update = stubUpdate()
    await renderEditSheet(RETAINER, { 'engagements:update': update })

    fireEvent.change(screen.getByLabelText('Hours included'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // Without `billingModel`, `{ hoursIncluded: 20 }` matches no branch of
    // `updateEngagementInputSchema` — the common-patch branch is .strict()
    // and holds no model-specific key.
    expect(patchFrom(update)).toEqual({ billingModel: 'retainer', hoursIncluded: 20 })
  })

  it('clears a date to NULL rather than an empty string when the user empties it', async () => {
    const update = stubUpdate()
    await renderEditSheet(RETAINER, { 'engagements:update': update })

    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(patchFrom(update)).toEqual({ endsOn: null })
  })

  it('leaves "Work is for" alone when "Billed to" changes — the create form\'s mirror must not overwrite a stored client company', async () => {
    const update = stubUpdate()
    await renderEditSheet(RETAINER, { 'engagements:update': update })

    const { billedTo, workIsFor } = await companySelects()
    fireEvent.change(billedTo, { target: { value: '' } })

    expect(workIsFor.value).toBe('client-co')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(patchFrom(update)).toEqual({ billingCompanyId: null })
  })

  it("shows a stored 'none'-equivalent model as none, and saving an untouched one writes nothing", async () => {
    const update = stubUpdate()
    // billingModel NULL — a row from an import, not the create form, which
    // always sends one. NULL and 'none' say the same thing, so a save that
    // did not touch the model must not write a value nobody chose.
    await renderEditSheet(makeEngagement({ id: 'eng-null-model', name: 'Imported', status: 'active' }), {
      'engagements:update': update
    })

    expect(screen.getByRole('button', { name: 'None', pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(patchFrom(update)).toEqual({})
  })

  it('names what an engagement was sold as, without a price, and saving an untouched one writes nothing', async () => {
    const update = stubUpdate()
    await renderEditSheet(
      makeEngagement({
        id: 'eng-sold',
        name: 'Sold advisory',
        status: 'active',
        offeringVersionId: 'ver-advisory-2',
        offeringId: 'off-advisory',
        offeringName: 'Advisory retainer',
        agreedRateCents: 350_000
      }),
      { 'engagements:update': update }
    )

    const sold = await offeringSelect()
    expect(sold.value).toBe('off-advisory')
    // The option is the bare name. A price here would read as "pick another
    // and the rate follows" — which `updateEngagement` will not do.
    expect(within(sold).getByText('Advisory retainer')).toBeTruthy()
    expect(within(sold).queryByText(/3500/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(patchFrom(update)).toEqual({})
  })

  it('re-points a signed engagement at another offering without re-rating it', async () => {
    const update = stubUpdate()
    await renderEditSheet(
      makeEngagement({
        id: 'eng-sold',
        name: 'Sold advisory',
        status: 'active',
        offeringVersionId: 'ver-advisory-2',
        offeringId: 'off-advisory',
        offeringName: 'Advisory retainer',
        agreedRateCents: 350_000
      }),
      { 'engagements:update': update }
    )

    const sold = await offeringSelect()
    fireEvent.change(sold, { target: { value: 'off-rescue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // The version moves; the agreed rate does not travel at all. The rescue
    // offering is quoted at $12,000 and none of that reaches the patch —
    // `updateEngagement` would have dropped it silently, so the form never
    // builds it.
    expect(patchFrom(update)).toEqual({ offeringVersionId: 'ver-rescue-1' })
    expect(patchFrom(update)).not.toHaveProperty('agreedRateCents')
  })

  it('clears the offering to NULL when the picker is put back to none', async () => {
    const update = stubUpdate()
    await renderEditSheet(
      makeEngagement({
        id: 'eng-sold',
        name: 'Sold advisory',
        status: 'active',
        offeringVersionId: 'ver-advisory-2',
        offeringId: 'off-advisory',
        offeringName: 'Advisory retainer'
      }),
      { 'engagements:update': update }
    )

    fireEvent.change(await offeringSelect(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(patchFrom(update)).toEqual({ offeringVersionId: null })
  })

  it('keeps naming an offering the current price list cannot show, and does not unsell it on save', async () => {
    const update = stubUpdate()
    // Sold from a version that has since been superseded, off an offering
    // that has since been archived — so `offerings:list({ active: true })`
    // carries neither. The record's own join is what names it.
    await renderEditSheet(
      makeEngagement({
        id: 'eng-legacy',
        name: 'Legacy engagement',
        status: 'active',
        offeringVersionId: 'ver-retired-1',
        offeringId: 'off-retired',
        offeringName: 'Retired retainer',
        agreedRateCents: 250_000
      }),
      { 'engagements:update': update }
    )

    const sold = await offeringSelect()
    expect(within(sold).getByText('Retired retainer')).toBeTruthy()
    expect(sold.value).toBe('off-retired')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // Not `{ offeringVersionId: null }` — an untouched picker must not
    // silently unsell the engagement.
    expect(patchFrom(update)).toEqual({})
  })

  it('says so when the record is gone rather than opening an empty form over it', async () => {
    renderSheet(vi.fn(), { 'engagements:get': vi.fn(async () => ({ ok: true as const, data: null })) }, { mode: 'edit', id: 'deleted' })

    expect(await screen.findByText('This engagement no longer exists.')).toBeTruthy()
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit engagement' })).toBeTruthy()
  })
})
