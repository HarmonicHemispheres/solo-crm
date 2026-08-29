import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { CompanySheet } from './CompanySheet'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** A full `companySchema`-shaped row — `window.crm` is typed, so a mocked `companies:create` response has to satisfy it even though these tests only assert on what was *sent*, not what came back. */
const STUB_COMPANY_ROW = {
  id: 'new-co',
  name: 'stub',
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
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

/** The one company `companies:list` offers as a billing partner / introducer in these tests. */
const PARTNER_CO = {
  id: 'partner-1',
  name: 'Partner Co',
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

function renderSheet(onClose = vi.fn(), overrides: Parameters<typeof stubCrm>[0] = {}) {
  window.crm = stubCrm(overrides)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CompanySheet onClose={onClose} />
    </QueryClientProvider>
  )
  return { onClose }
}

describe('CompanySheet', () => {
  it('writes exactly the columns its footer claims, field for field', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_COMPANY_ROW } }
    })
    renderSheet(vi.fn(), { 'companies:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      name: 'Acme Co',
      kind: 'client',
      website: null,
      billsDirectly: true,
      billedViaCompanyId: null,
      introducedByCompanyId: null,
      cadenceDays: 14,
      budgetNote: null,
      since: null
    })
  })

  it('picks up every field a caller actually fills in', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_COMPANY_ROW } }
    })
    renderSheet(vi.fn(), {
      'companies:create': create,
      'companies:list': vi.fn(async () => ({ ok: true as const, data: [PARTNER_CO] }))
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prospect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Billed through a partner' }))

    // Wait for companies:list to resolve and populate the <option> before
    // selecting it — jsdom silently ignores a `value` with no matching
    // <option>, which would otherwise leave the select at its empty default.
    const billingPartner = (await screen.findByLabelText('Billing partner')) as HTMLSelectElement
    await waitFor(() => expect(within(billingPartner).getByText('Partner Co')).toBeTruthy())
    fireEvent.change(billingPartner, { target: { value: 'partner-1' } })

    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'acme.com' } })
    fireEvent.change(screen.getByLabelText('Budget note'), { target: { value: '$25,000 approved' } })
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-01-15' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      name: 'Acme Co',
      kind: 'prospect',
      website: 'acme.com',
      billsDirectly: false,
      billedViaCompanyId: 'partner-1',
      introducedByCompanyId: null,
      cadenceDays: 30,
      budgetNote: '$25,000 approved',
      since: '2026-01-15'
    })
  })

  it('sends no billing partner once "Who invoices" is switched back to direct', async () => {
    // The `billsDirectly ? null : billedVia || null` guard, tested directly:
    // with it deleted, `billedVia || null` still holds 'partner-1' from the
    // moment it was picked, and a company that bills directly is written
    // with a billing partner — the row says two contradictory things at once.
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_COMPANY_ROW } }
    })
    renderSheet(vi.fn(), {
      'companies:create': create,
      'companies:list': vi.fn(async () => ({ ok: true as const, data: [PARTNER_CO] }))
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Billed through a partner' }))
    const billingPartner = (await screen.findByLabelText('Billing partner')) as HTMLSelectElement
    await waitFor(() => expect(within(billingPartner).getByText('Partner Co')).toBeTruthy())
    fireEvent.change(billingPartner, { target: { value: 'partner-1' } })

    // Changed their mind: they pay me directly after all.
    fireEvent.click(screen.getByRole('button', { name: 'They pay me directly' }))
    expect(screen.queryByLabelText('Billing partner')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.billsDirectly).toBe(true)
    expect(payload.billedViaCompanyId).toBeNull()
  })

  it('names the field on a validation failure and does not close the sheet or lose input', async () => {
    const create = vi.fn()
    const { onClose } = renderSheet(vi.fn(), { 'companies:create': create })

    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const alert = await screen.findByRole('alert')
    // Against the Name field, under the label the form gives it.
    expect(alert.textContent).toBe('Name is required')
    const nameField = screen.getByLabelText('Name')
    expect(nameField.getAttribute('aria-invalid')).toBe('true')
    expect(nameField.getAttribute('aria-describedby')).toBe(alert.id)
    expect(create).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    // The website typed before the failed submit is still there.
    expect((screen.getByLabelText('Website') as HTMLInputElement).value).toBe('acme.com')
  })

  it('closes the sheet once the write succeeds', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_COMPANY_ROW } }
    })
    const { onClose } = renderSheet(vi.fn(), { 'companies:create': create })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
