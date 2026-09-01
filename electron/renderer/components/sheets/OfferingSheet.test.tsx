import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { OfferingSheet } from './OfferingSheet'
import type { SheetFormTarget } from '../shell/layer-manager-context'
import type { CrmApi } from '../../../shared/ipc-types'
import type { OfferingCategory, OfferingWithVersions } from '../../../shared/offerings'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const TS = '2026-09-01T00:00:00.000Z'

const CATEGORIES: readonly OfferingCategory[] = [
  { id: 'cat-audits', name: 'Audits', color: null, sort: 0, createdAt: TS, updatedAt: TS }
]

/** A full `offeringWithVersionsSchema`-shaped row — `window.crm` is typed, so every mocked response has to satisfy it even where a test only asserts on what was *sent*. */
const EXISTING: OfferingWithVersions = {
  id: 'o-1',
  name: 'Discovery Audit',
  type: 'service',
  categoryId: 'cat-audits',
  billingModel: 'fixed',
  unit: 'fixed',
  blurb: 'Map a business.',
  active: true,
  createdAt: TS,
  updatedAt: TS,
  versions: [
    {
      id: 'o-1-v2',
      offeringId: 'o-1',
      version: 2,
      rateCents: 450_000,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      createdAt: TS,
      updatedAt: TS
    }
  ]
}

function renderSheet(target: SheetFormTarget, overrides: Partial<CrmApi> = {}) {
  const crm = stubCrm({
    'offerings:listCategories': vi.fn(async () => ({ ok: true as const, data: CATEGORIES })),
    'offerings:get': vi.fn(async () => ({ ok: true as const, data: EXISTING })),
    'offerings:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: EXISTING } })),
    'offerings:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: EXISTING } })),
    ...overrides
  })
  window.crm = crm
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <OfferingSheet onClose={onClose} target={target} />
    </QueryClientProvider>
  )
  return { crm, onClose }
}

describe('OfferingSheet — create', () => {
  it('writes the first version\'s rate along with the offering', async () => {
    const { crm } = renderSheet({ mode: 'create' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Audits' })).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Discovery Audit' } })
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-audits' } })
    fireEvent.click(screen.getByRole('button', { name: 'Product' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retainer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Per month' }))
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '6500' } })
    fireEvent.change(screen.getByLabelText('Blurb'), { target: { value: 'Standing advisory.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(crm['offerings:create']).toHaveBeenCalledWith({
        name: 'Discovery Audit',
        type: 'product',
        categoryId: 'cat-audits',
        billingModel: 'retainer',
        unit: 'mo',
        blurb: 'Standing advisory.',
        // Dollars typed, integer cents sent (CONVENTIONS.md).
        rateCents: 650_000
      })
    )
  })

  it('refuses a rate it cannot read, against the Rate field, without calling the channel', async () => {
    const { crm } = renderSheet({ mode: 'create' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Audits' })).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Discovery Audit' } })
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '$4,500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert').textContent).toMatch(/Rate/)
    expect(crm['offerings:create']).not.toHaveBeenCalled()
  })

  it('offers no price-change control on a record that has no price yet', async () => {
    renderSheet({ mode: 'create' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Audits' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Change price' })).toBeNull()
  })
})

describe('OfferingSheet — edit', () => {
  it('seeds every field from the record it was opened on', async () => {
    renderSheet({ mode: 'edit', id: 'o-1' })

    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Discovery Audit'))
    // The record and the category list are two independent reads, and a
    // `<select>` cannot show a value whose `<option>` has not arrived — the
    // stored id is held in state throughout either way (the "sends only what
    // changed" test proves a submit before this point still carries it).
    await waitFor(() => expect(screen.getByRole('option', { name: 'Audits' })).toBeTruthy())
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat-audits')
    expect((screen.getByLabelText('Blurb') as HTMLTextAreaElement).value).toBe('Map a business.')
    expect(screen.getByRole('button', { name: 'Service' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('sends only what changed, and never a rate', async () => {
    const { crm } = renderSheet({ mode: 'edit', id: 'o-1' })
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Discovery Audit'))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Discovery Audit v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(crm['offerings:update']).toHaveBeenCalledWith({ id: 'o-1', patch: { name: 'Discovery Audit v2' } })
    )
    // The whole point of the diff: `updateOfferingInputSchema` is `.strict()`
    // and has no `rateCents` key, and this form must not build a payload that
    // could carry one. Asserted on the sent object rather than on the schema,
    // because the schema is already proven elsewhere and this is the half
    // that would regress.
    const [[sent]] = (crm['offerings:update'] as ReturnType<typeof vi.fn>).mock.calls
    expect(Object.keys(sent.patch)).not.toContain('rateCents')
  })

  it('saves an untouched record without writing values nobody chose', async () => {
    const { crm } = renderSheet({ mode: 'edit', id: 'o-1' })
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Discovery Audit'))

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(crm['offerings:update']).toHaveBeenCalledWith({ id: 'o-1', patch: {} }))
  })

  it('shows the current price read-only beside a disabled Change price and says why', async () => {
    renderSheet({ mode: 'edit', id: 'o-1' })
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Discovery Audit'))

    expect(screen.getByText('$4,500 · v2')).toBeTruthy()
    // §6.5 and this task's Risks: a working control here would append a
    // version with no effective date. Disabled with an honest caption is the
    // accepted shape until P3-02/P3-08 exist.
    const change = screen.getByRole('button', { name: 'Change price' }) as HTMLButtonElement
    expect(change.disabled).toBe(true)
    expect(screen.getByText(/Engagements keep the rate they were signed at/)).toBeTruthy()
    // And there is no rate input at all on this form.
    expect(screen.queryByLabelText('Rate')).toBeNull()
  })

  it('says so rather than showing an empty form when the record is gone', async () => {
    renderSheet({ mode: 'edit', id: 'o-1' }, { 'offerings:get': vi.fn(async () => ({ ok: true as const, data: null })) })
    expect(await screen.findByText('This offering no longer exists.')).toBeTruthy()
  })
})
