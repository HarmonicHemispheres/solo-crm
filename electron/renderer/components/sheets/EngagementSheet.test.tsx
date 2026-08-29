import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { EngagementSheet } from './EngagementSheet'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** A full `engagementSchema`-shaped row — `window.crm` is typed, so a mocked `engagements:create` response has to satisfy it even though these tests only assert on what was *sent*. */
const STUB_ENGAGEMENT_ROW = {
  id: 'new-eng',
  name: 'stub',
  billingCompanyId: null,
  clientCompanyId: null,
  serviceVersionId: null,
  agreedRateCents: null,
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

function renderSheet(onClose = vi.fn(), overrides: Parameters<typeof stubCrm>[0] = {}) {
  window.crm = stubCrm({ 'companies:list': vi.fn(async () => ({ ok: true as const, data: STUB_COMPANIES })), ...overrides })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <EngagementSheet onClose={onClose} />
    </QueryClientProvider>
  )
  return { onClose }
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

  it('names the field on an invalid amount and does not close the sheet', async () => {
    const create = vi.fn()
    const { onClose } = renderSheet(vi.fn(), { 'engagements:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad amount' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fixed scope' }))
    fireEvent.change(screen.getByLabelText('Contract value'), { target: { value: 'not a number' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/contractValueCents/)
    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
