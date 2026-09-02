import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Offerings } from './Offerings'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { CrmApi } from '../../shared/ipc-types'
import type { OfferingCategory, OfferingListItem, OfferingWithVersions } from '../../shared/offerings'
import { keyDownWithUnmountBlur } from '../lib/test-support/unmount-blur'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const TS = '2026-09-01T00:00:00.000Z'

function makeCategory(id: string, name: string, sort: number): OfferingCategory {
  // `color: null` deliberately — a hex literal in a renderer file is what
  // `local/no-literal-colour` exists to catch, and the swatch is decorative
  // (Offerings.tsx's `CategoryDot`), so nothing asserted here depends on it.
  return { id, name, color: null, sort, createdAt: TS, updatedAt: TS }
}

function makeOffering(overrides: Partial<OfferingListItem> & { id: string; name: string }): OfferingListItem {
  const { id } = overrides
  return {
    type: 'service',
    categoryId: null,
    billingModel: 'fixed',
    unit: 'fixed',
    blurb: null,
    active: true,
    createdAt: TS,
    updatedAt: TS,
    currentVersion: {
      id: `${id}-v1`,
      offeringId: id,
      version: 1,
      rateCents: 450_000,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      createdAt: TS,
      updatedAt: TS
    },
    ...overrides
  }
}

/** `offerings:create` / `:duplicate` / `:archive` all answer with an `OfferingWithVersions`; this is the shape those stubs return. */
const CREATED: OfferingWithVersions = {
  id: 'created',
  name: 'Created',
  type: 'service',
  categoryId: null,
  billingModel: 'fixed',
  unit: 'fixed',
  blurb: null,
  active: true,
  createdAt: TS,
  updatedAt: TS,
  versions: []
}

const CATEGORIES = [makeCategory('cat-audits', 'Audits', 0), makeCategory('cat-products', 'Products', 1)]

// Deliberately more than the seed's nine: this task's Risks section says nine
// offerings in five categories will not exercise the filters, so the fixture
// carries a service and a product in two categories, an uncategorised row and
// an archived one — every branch the view has to sort rows into.
const OFFERINGS: readonly OfferingListItem[] = [
  makeOffering({ id: 'o-audit', name: 'Discovery Audit', categoryId: 'cat-audits', blurb: 'Map a business.' }),
  makeOffering({
    id: 'o-retainer',
    name: 'Advisory Retainer',
    categoryId: 'cat-audits',
    billingModel: 'retainer',
    unit: 'mo',
    currentVersion: {
      id: 'o-retainer-v2',
      offeringId: 'o-retainer',
      version: 2,
      rateCents: 650_000,
      effectiveFrom: '2026-03-01',
      effectiveTo: null,
      createdAt: TS,
      updatedAt: TS
    }
  }),
  makeOffering({
    id: 'o-template',
    name: 'Ops Template',
    type: 'product',
    categoryId: 'cat-products',
    currentVersion: {
      id: 'o-template-v1',
      offeringId: 'o-template',
      version: 1,
      rateCents: 29_900,
      effectiveFrom: null,
      effectiveTo: null,
      createdAt: TS,
      updatedAt: TS
    }
  }),
  makeOffering({
    id: 'o-loose',
    name: 'Loose Ends',
    categoryId: null,
    unit: 'from',
    currentVersion: {
      id: 'o-loose-v1',
      offeringId: 'o-loose',
      version: 1,
      rateCents: 1_800_000,
      effectiveFrom: null,
      effectiveTo: null,
      createdAt: TS,
      updatedAt: TS
    }
  }),
  makeOffering({
    id: 'o-old',
    name: 'Retired Sprint',
    categoryId: 'cat-audits',
    active: false,
    currentVersion: {
      id: 'o-old-v1',
      offeringId: 'o-old',
      version: 1,
      rateCents: 120_000,
      effectiveFrom: null,
      effectiveTo: null,
      createdAt: TS,
      updatedAt: TS
    }
  })
]

function renderOfferings(overrides: Partial<CrmApi> = {}) {
  const crm = stubCrm({
    'offerings:list': vi.fn(async () => ({ ok: true as const, data: OFFERINGS })),
    'offerings:listCategories': vi.fn(async () => ({ ok: true as const, data: CATEGORIES })),
    ...overrides
  })
  window.crm = crm
  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={['/offerings']}>
        <LayerManager>
          <Offerings />
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, crm }
}

/**
 * The `.catblock` whose heading is `name` — the unit every filtering
 * assertion below is made against. Found through the heading role rather than
 * the text, because the category filter chip above carries the same words.
 */
function blockFor(name: string): HTMLElement {
  const head = screen.getByRole('heading', { name }).closest('.catblock')
  if (!(head instanceof HTMLElement)) throw new Error(`no category block for "${name}"`)
  return head
}

describe('Offerings', () => {
  it('renders every offering under its own category, from the channels', async () => {
    renderOfferings()

    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    const audits = blockFor('Audits')
    expect(within(audits).getByText('Discovery Audit')).toBeTruthy()
    expect(within(audits).getByText('Advisory Retainer')).toBeTruthy()
    expect(within(blockFor('Products')).getByText('Ops Template')).toBeTruthy()
    // An offering with no category still has a home rather than vanishing.
    expect(within(blockFor('Uncategorised')).getByText('Loose Ends')).toBeTruthy()
  })

  it('shows each rate in the unit it is quoted in, with its version', async () => {
    renderOfferings()

    await waitFor(() => expect(screen.getByText('Advisory Retainer')).toBeTruthy())

    // A retainer quoted per month says so, a "from" price says from, and the
    // flat price appends no unit it does not have. Cents survive the round
    // trip rather than being rounded into whole dollars.
    expect(screen.getByText('$6,500 / mo')).toBeTruthy()
    expect(screen.getByText('from $18,000')).toBeTruthy()
    expect(screen.getByText('$299')).toBeTruthy()
    expect(screen.getByText('$4,500')).toBeTruthy()
    expect(screen.getByText(/v2 · since 2026-03/)).toBeTruthy()
    // No effective date on record shows the version alone, not a fabricated
    // "since" — `effectiveFrom: null` means unbounded.
    expect(within(blockFor('Products')).getByText('v1')).toBeTruthy()
  })

  it('filters to services and to products', async () => {
    renderOfferings()
    await waitFor(() => expect(screen.getByText('Ops Template')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Services' }))
    expect(screen.queryByText('Ops Template')).toBeNull()
    expect(screen.getByText('Discovery Audit')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Products' }))
    expect(screen.getByText('Ops Template')).toBeTruthy()
    expect(screen.queryByText('Discovery Audit')).toBeNull()
  })

  it('filters to one category', async () => {
    renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Products category' }))
    expect(screen.getByText('Ops Template')).toBeTruthy()
    expect(screen.queryByText('Discovery Audit')).toBeNull()

    // The archived list is narrowed by the same filter — Retired Sprint is
    // archived under Audits, so it stays out of a Products view even with
    // archived rows shown (added at merge review: the block list is narrowed
    // by category on its own, so this is the only place the row predicate
    // shows).
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
    expect(screen.queryByText('Retired Sprint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }))

    fireEvent.click(screen.getByRole('button', { name: 'All categories' }))
    expect(screen.getByText('Discovery Audit')).toBeTruthy()
  })

  it('hides an archived offering by default and brings it back through the filter', async () => {
    renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    expect(screen.queryByText('Retired Sprint')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Archived/ }))
    expect(screen.getByText('Retired Sprint')).toBeTruthy()
    // Reachable, but not editable back into the catalogue: `archiveOffering`
    // has no inverse, so an archived row carries no actions at all.
    expect(screen.queryByRole('button', { name: 'Archive "Retired Sprint"' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Retired Sprint/ })).toBeNull()
  })

  it('archives an offering without deleting it — the two are separate controls', async () => {
    const { crm } = renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Archive "Discovery Audit"' }))
    await waitFor(() => expect(crm['offerings:archive']).toHaveBeenCalledWith({ id: 'o-audit' }))
    // Archiving is not deleting: the row is still there, and nothing was
    // removed on the way. This used to assert that no delete control existed
    // at all; T-260902-09 added one, and what is worth keeping from the old
    // assertion is that the two buttons do different things.
    expect(crm['offerings:delete']).not.toHaveBeenCalled()
  })

  it('deleting an offering asks first, and says the engagements sold from it are kept', async () => {
    const { crm } = renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Delete "Discovery Audit"' }))

    // The dialog, not the delete: nothing has been removed yet.
    const dialog = await screen.findByRole('dialog', { name: /Delete Discovery Audit/ })
    expect(crm['offerings:delete']).not.toHaveBeenCalled()
    await waitFor(() => expect(crm['offerings:deleteImpact']).toHaveBeenCalledWith({ id: 'o-audit' }))

    // And only then, on the second, explicit confirmation.
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(crm['offerings:delete']).toHaveBeenCalledWith({ id: 'o-audit', cascade: true }))
  })

  it('cancelling the delete dialog deletes nothing', async () => {
    const { crm } = renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Delete "Discovery Audit"' }))
    const dialog = await screen.findByRole('dialog', { name: /Delete Discovery Audit/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(crm['offerings:delete']).not.toHaveBeenCalled()
  })

  it('duplicates an offering through the channel, letting the repository name the copy', async () => {
    const { crm } = renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate "Discovery Audit"' }))
    // No `overrides`: appending " (copy)" is `duplicateOffering`'s job, and a
    // second copy of that rule here could disagree with the stored row.
    await waitFor(() => expect(crm['offerings:duplicate']).toHaveBeenCalledWith({ id: 'o-audit' }))
  })

  it('never offers a working price control — a rate is written on create and nowhere else', async () => {
    renderOfferings()
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    // The one thing §6.5 and this task's Risks both single out. If a "Change
    // price" control ever appears in this view it must be disabled, because a
    // working one would write an `offering_versions` rate with no effective
    // date and no record of what was sold at the old one.
    for (const control of screen.queryAllByRole('button', { name: /price/i })) {
      expect((control as HTMLButtonElement).disabled).toBe(true)
    }
  })

  describe('quick-add', () => {
    it.each([
      ['Retainer, 4500/mo', { name: 'Retainer', rateCents: 450_000, unit: 'mo', billingModel: 'retainer' }],
      ['Audit, 4500', { name: 'Audit', rateCents: 450_000, unit: 'fixed', billingModel: 'fixed' }],
      ['Advisory, 175/hr', { name: 'Advisory', rateCents: 17_500, unit: 'hr', billingModel: 'tm' }]
    ])('sends %s at the right unit and billing model', async (typed, expected) => {
      const { crm } = renderOfferings({
        'offerings:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: CREATED } }))
      })
      await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

      const input = screen.getByPlaceholderText(/Add to Audits/)
      fireEvent.change(input, { target: { value: typed } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() =>
        expect(crm['offerings:create']).toHaveBeenCalledWith({ ...expected, categoryId: 'cat-audits', type: 'service' })
      )
    })

    it('refuses text with no price and says so instead of creating a free offering', async () => {
      const { crm } = renderOfferings()
      await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

      const input = screen.getByPlaceholderText(/Add to Audits/)
      fireEvent.change(input, { target: { value: 'Just a name' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(screen.getByRole('alert').textContent).toMatch(/has no price/)
      expect(crm['offerings:create']).not.toHaveBeenCalled()
    })
  })

  describe('categories', () => {
    it('creates one from the single field a category has', async () => {
      const { crm } = renderOfferings()
      await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

      const input = screen.getByPlaceholderText(/New category/)
      fireEvent.change(input, { target: { value: 'Workshops' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(crm['offerings:createCategory']).toHaveBeenCalledWith({ name: 'Workshops' }))
    })

    it('renames one in place', async () => {
      const { crm } = renderOfferings()
      await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Rename "Audits"' }))
      const input = screen.getByRole('textbox', { name: 'Rename "Audits"' })
      fireEvent.change(input, { target: { value: 'Assessments' } })
      // T-260901-25: Enter unmounts the input, and Chromium's unmount blur
      // used to reach `commit` a second time.
      await keyDownWithUnmountBlur(input, 'Enter')

      await waitFor(() =>
        expect(crm['offerings:updateCategory']).toHaveBeenCalledWith({
          id: 'cat-audits',
          patch: { name: 'Assessments' }
        })
      )
      expect(crm['offerings:updateCategory']).toHaveBeenCalledTimes(1)
    })

    it('Escape abandons a rename, including through the blur that unmounting carries', async () => {
      const { crm } = renderOfferings()
      await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Rename "Audits"' }))
      const input = screen.getByRole('textbox', { name: 'Rename "Audits"' })
      fireEvent.change(input, { target: { value: 'Assessments' } })
      await keyDownWithUnmountBlur(input, 'Escape')

      expect(screen.getByRole('button', { name: 'Rename "Audits"' })).toBeTruthy()
      expect(crm['offerings:updateCategory']).not.toHaveBeenCalled()
    })

    it('shows the repository\'s own reason when a category holding offerings is refused, and keeps the category listed', async () => {
      // The refusal `deleteOfferingCategory` actually throws: it names the
      // count and an example, and `runMutation` carries that sentence back as
      // data. Swallowing it and showing "could not delete" is the failure
      // this test exists to prevent.
      const reason =
        'Cannot delete "Audits": 2 offerings are in it (e.g. "Discovery Audit"). Move them to another category before deleting this one.'
      const { crm } = renderOfferings({
        'offerings:deleteCategory': vi.fn(async () => ({
          ok: true as const,
          data: { ok: false as const, error: { code: 'refused' as const, message: reason, blocker: { reason: 'offerings', count: 2 } } }
        }))
      })
      await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Delete "Audits"' }))

      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(reason))
      expect(crm['offerings:deleteCategory']).toHaveBeenCalledWith({ id: 'cat-audits' })
      // Still there — the guard runs inside the same transaction as the
      // DELETE, so nothing was removed and the view must not pretend it was.
      expect(screen.getByRole('heading', { name: 'Audits' })).toBeTruthy()
      expect(screen.getByText('Discovery Audit')).toBeTruthy()
    })

    it('deletes an empty category', async () => {
      const { crm } = renderOfferings()
      await waitFor(() => expect(screen.getByText('Ops Template')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Delete "Products"' }))
      await waitFor(() => expect(crm['offerings:deleteCategory']).toHaveBeenCalledWith({ id: 'cat-products' }))
    })
  })

  it('opens the offering sheet on an existing record from a row', async () => {
    renderOfferings({
      'offerings:get': vi.fn(async () => ({
        ok: true as const,
        data: { ...CREATED, id: 'o-audit', name: 'Discovery Audit', versions: [] }
      }))
    })
    await waitFor(() => expect(screen.getByText('Discovery Audit')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Edit "Discovery Audit"' }))
    expect(await screen.findByRole('dialog', { name: 'Edit offering' })).toBeTruthy()
  })

  it('offers the empty catalogue a way to start', async () => {
    renderOfferings({
      'offerings:list': vi.fn(async () => ({ ok: true as const, data: [] })),
      'offerings:listCategories': vi.fn(async () => ({ ok: true as const, data: [] }))
    })

    await waitFor(() => expect(screen.getByText(/Nothing in the catalogue yet/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Add offering/ }))
    expect(await screen.findByRole('dialog', { name: 'New offering' })).toBeTruthy()
  })
})
