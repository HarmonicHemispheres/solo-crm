import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import type { SheetFormTarget } from '../shell/layer-manager-context'
import type { Company } from '../../../shared/companies'
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
  introducedByPersonId: null,
  cadenceDays: null,
  lastTouchAt: null,
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
  introducedByPersonId: null,
  cadenceDays: null,
  lastTouchAt: null,
  notes: null,
  since: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

/** The one person `people:list` offers as an introducer (migration 0009: "Introduced by" is a person). */
const REFERRER = {
  id: 'per-dana',
  name: 'Dana Kwan',
  email: null,
  phone: null,
  notes: null,
  lastContactAt: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z'
}

function renderSheet(onClose = vi.fn(), overrides: Parameters<typeof stubCrm>[0] = {}, target: SheetFormTarget = { mode: 'create' }) {
  window.crm = stubCrm(overrides)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CompanySheet onClose={onClose} target={target} />
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
      introducedByPersonId: null,
      cadenceDays: 14,
      since: null,
      // T-260901-14: the sheet is the authoritative writer for a company's
      // columns now, so it carries `notes` too — the Details card that used
      // to be the only way to edit it no longer writes.
      notes: null
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
    fireEvent.click(screen.getByRole('button', { name: '30 days' }))
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-01-15' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Met at the conference' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      name: 'Acme Co',
      kind: 'prospect',
      website: 'acme.com',
      billsDirectly: false,
      billedViaCompanyId: 'partner-1',
      introducedByPersonId: null,
      cadenceDays: 30,
      since: '2026-01-15',
      notes: 'Met at the conference'
    })
  })

  it('picks the introducer from People, and writes a person id (migration 0009)', async () => {
    const create = vi.fn(async (input: unknown) => {
      void input
      return { ok: true as const, data: { ok: true as const, data: STUB_COMPANY_ROW } }
    })
    renderSheet(vi.fn(), {
      'companies:create': create,
      'companies:list': vi.fn(async () => ({ ok: true as const, data: [PARTNER_CO] })),
      'people:list': vi.fn(async () => ({ ok: true as const, data: [REFERRER] }))
    })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Acme Co' } })
    const introducedBy = screen.getByLabelText('Introduced by') as HTMLSelectElement
    await waitFor(() => expect(within(introducedBy).getByText('Dana Kwan')).toBeTruthy())
    // A person picker, not a company one: the partner company is not offered.
    expect(within(introducedBy).queryByText('Partner Co')).toBeNull()
    fireEvent.change(introducedBy, { target: { value: 'per-dana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect((create.mock.calls[0][0] as Record<string, unknown>).introducedByPersonId).toBe('per-dana')
    // And the retired field is not sent under any name.
    expect(create.mock.calls[0][0]).not.toHaveProperty('introducedByCompanyId')
    expect(create.mock.calls[0][0]).not.toHaveProperty('budgetNote')
  })

  it('has no budget note field — the operator asked for it to go', () => {
    renderSheet()
    expect(screen.queryByLabelText('Budget note')).toBeNull()
  })

  it('offers only FORMS.company’s four cadence chips on a create — "Not set" is an edit-only option', () => {
    // The sentinel exists so an edit can clear a cadence the way the inline
    // editor it replaced could. Offering it on a create would be a fifth
    // choice the mockup's form does not have, and `cadenceDays: null` on a
    // brand new company is a gap nobody asked for.
    renderSheet()
    expect(screen.queryByRole('button', { name: 'Not set' })).toBeNull()
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

// ---------------------------------------------------------------------------
// Edit mode (T-260901-14) — the same form bound to a company that already
// exists. This is the authoritative writer for a company's columns; the
// company detail page's Details card renders them and no longer writes any of
// them (asserted in CompanyDetail.test.tsx).
// ---------------------------------------------------------------------------

/** EZDeploy as stored: a 10-day cadence no chip offers, a partner it is billed through, and no notes. */
const STORED_COMPANY: Company = {
  ...STUB_COMPANY_ROW,
  id: 'co-ezdeploy',
  name: 'EZDeploy',
  kind: 'client' as const,
  website: 'ezdeploy.io',
  billsDirectly: false,
  billedViaCompanyId: 'partner-1',
  cadenceDays: 10,
  since: '2026-02-01'
}

function renderEditSheet(company: Company = STORED_COMPANY, overrides: Parameters<typeof stubCrm>[0] = {}) {
  const update = vi.fn(async (payload: unknown) => {
    void payload
    return { ok: true as const, data: { ok: true as const, data: company } }
  })
  const onClose = vi.fn()
  window.crm = stubCrm({
    'companies:get': vi.fn(async () => ({ ok: true as const, data: company })),
    'companies:list': vi.fn(async () => ({ ok: true as const, data: [company, PARTNER_CO] })),
    'companies:update': update,
    ...overrides
  })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CompanySheet onClose={onClose} target={{ mode: 'edit', id: company.id }} />
    </QueryClientProvider>
  )
  return { update, onClose }
}

describe('CompanySheet — edit mode (T-260901-14)', () => {
  it('opens populated with that company’s stored values, under a title that says it is an update', async () => {
    renderEditSheet()

    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('EZDeploy')
    expect(screen.getByRole('dialog', { name: 'Edit company' })).toBeTruthy()
    expect((screen.getByLabelText('Website') as HTMLInputElement).value).toBe('ezdeploy.io')
    expect((screen.getByLabelText('Since') as HTMLInputElement).value).toBe('2026-02-01')
    expect(screen.getByRole('button', { name: 'Client' }).getAttribute('aria-pressed')).toBe('true')
    // A cadence none of FORMS.company's four chips offers is added as its own
    // chip rather than leaving the group with nothing selected — otherwise a
    // save could only ever move a value the operator never touched.
    expect(screen.getByRole('button', { name: '10 days' }).getAttribute('aria-pressed')).toBe('true')
    // Billed through a partner, so that select is showing, and it does not
    // offer the company being edited as its own billing partner.
    // `companies:list` is a second round trip, and jsdom drops a `value` with
    // no matching `<option>` yet — so this waits for the options rather than
    // reading the select the moment the form mounts.
    const partner = screen.getByLabelText('Billing partner') as HTMLSelectElement
    await waitFor(() => expect(partner.value).toBe('partner-1'))
    expect(within(partner).queryByText('EZDeploy')).toBeNull()
  })

  it('sends only the columns the operator actually changed', async () => {
    const { update } = renderEditSheet()
    // The form itself, not the dialog: the loading placeholder wears the same
    // title and `aria-label`, so waiting on the dialog resolves a frame early
    // against a sheet with no fields in it.
    await screen.findByLabelText('Name')

    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'ezdeploy.dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({ id: 'co-ezdeploy', patch: { website: 'ezdeploy.dev' } })
  })

  it('writes nothing at all when nothing was touched — including for columns stored as null', async () => {
    // The mutant this catches: diffing against the *record* rather than
    // against what the form was seeded with. `kind`, `billsDirectly` and
    // `cadenceDays` are nullable columns whose controls cannot show null, so a
    // record-diff would send the control's own default on every save and a
    // company with no kind would silently become a client just for being
    // opened and saved.
    const blank = { ...STUB_COMPANY_ROW, id: 'co-blank', name: 'Blank Co' }
    const { update } = renderEditSheet(blank)
    // The form itself, not the dialog: the loading placeholder wears the same
    // title and `aria-label`, so waiting on the dialog resolves a frame early
    // against a sheet with no fields in it.
    await screen.findByLabelText('Name')

    // Seeded honestly: no cadence on the row reads as "Not set", not as 14.
    expect(screen.getByRole('button', { name: 'Not set' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({ id: 'co-blank', patch: {} })
  })

  it('clears a cadence through the "Not set" chip rather than writing a zero', async () => {
    const { update } = renderEditSheet()
    // The form itself, not the dialog: the loading placeholder wears the same
    // title and `aria-label`, so waiting on the dialog resolves a frame early
    // against a sheet with no fields in it.
    await screen.findByLabelText('Name')

    fireEvent.click(screen.getByRole('button', { name: 'Not set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({ id: 'co-ezdeploy', patch: { cadenceDays: null } })
  })

  it('edits the notes column the read-only Details card can only display', async () => {
    const { update } = renderEditSheet()
    // The form itself, not the dialog: the loading placeholder wears the same
    // title and `aria-label`, so waiting on the dialog resolves a frame early
    // against a sheet with no fields in it.
    await screen.findByLabelText('Name')

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Renewal conversation in October' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({ id: 'co-ezdeploy', patch: { notes: 'Renewal conversation in October' } })
  })

  it('says so rather than showing an empty form when the company no longer exists', async () => {
    const { update } = renderEditSheet(STORED_COMPANY, {
      'companies:get': vi.fn(async () => ({ ok: true as const, data: null }))
    })

    expect(await screen.findByText('This company no longer exists.')).toBeTruthy()
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})
