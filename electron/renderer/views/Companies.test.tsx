import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { Companies } from './Companies'
import { LayerManager } from '../components/shell/LayerManager'
import { createQueryClient } from '../lib/query-client'
import { invalidate } from '../lib/query-keys'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { Company } from '../../shared/companies'
import type { CompanyImageThumbnail, CompanyImageThumbnails } from '../../shared/company-images'
import type { EngagementWithOffering } from '../../shared/engagements'
import type { SettingEntry } from '../../shared/ipc-types'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const NOW = new Date('2026-08-28T12:00:00.000Z')

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function makeCompany(overrides: Partial<Company> & { id: string; name: string }): Company {
  return {
    kind: 'client',
    website: null,
    billsDirectly: true,
    billedViaCompanyId: null,
    introducedByCompanyId: null,
    cadenceDays: 14,
    lastTouchAt: null,
    budgetNote: null,
    notes: null,
    since: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeEngagement(overrides: Partial<EngagementWithOffering> & { id: string }): EngagementWithOffering {
  return {
    name: 'Engagement',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const EZDEPLOY = makeCompany({ id: 'ezdeploy', name: 'EZDeploy', cadenceDays: 10, lastTouchAt: isoDaysAgo(3) })
const RINVII = makeCompany({ id: 'rinvii', name: 'Rinvii', cadenceDays: 7, lastTouchAt: null })
// The seed fixture's own end-client cases (task Acceptance): billed via
// EZDeploy, so neither appears as a top-level row.
const WK = makeCompany({ id: 'wk', name: 'W+K', kind: 'end_client', billedViaCompanyId: 'ezdeploy' })
const PROGRAMETRIX = makeCompany({
  id: 'programetrix',
  name: 'Programetrix',
  kind: 'end_client',
  billedViaCompanyId: 'ezdeploy'
})

const SAMAY = makeEngagement({
  id: 'samay',
  name: 'Samay',
  billingCompanyId: 'ezdeploy',
  clientCompanyId: 'wk',
  status: 'active'
})

// ---------------------------------------------------------------------------
// Company images (T-260901-15). The fixtures are the shapes
// `companyImages:thumbnails` really answers with — the stored 96 × 96 / 480 ×
// 270 *derivatives* as `data:` URLs, present slots only, a company with no
// images simply absent from the map (ADR-015 §3).
// ---------------------------------------------------------------------------

/** A one-pixel PNG. Its bytes never matter — nothing here decodes it — but a real data URL keeps the fixture honest about what crosses the wire. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PIXEL_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBk='

function makeThumbnail(overrides: Partial<CompanyImageThumbnail> & { slot: 'logo' | 'banner' }): CompanyImageThumbnail {
  const banner = overrides.slot === 'banner'
  return {
    contentType: banner ? 'image/jpeg' : 'image/png',
    dataUrl: banner ? PIXEL_JPEG : PIXEL_PNG,
    width: banner ? 2400 : 512,
    height: banner ? 800 : 512,
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides
  }
}

const EZDEPLOY_IMAGES: CompanyImageThumbnails = {
  ezdeploy: { logo: makeThumbnail({ slot: 'logo' }), banner: makeThumbnail({ slot: 'banner' }) }
}

/** Detail route stand-in — proves navigation actually happened, not just that a handler was called. */
function CompanyDetail() {
  const { id } = useParams()
  return <div data-testid="company-detail">{id}</div>
}

function renderCompanies({
  companies = [EZDEPLOY, RINVII, WK, PROGRAMETRIX],
  engagements = [SAMAY],
  mode = 'card' as 'card' | 'list',
  thumbnails = {} as CompanyImageThumbnails,
  queryClient = createQueryClient(),
  crmOverrides = {}
}: {
  companies?: readonly Company[]
  engagements?: readonly EngagementWithOffering[]
  mode?: 'card' | 'list'
  /** What `companyImages:thumbnails` answers with. Defaults to the empty map — every company drawing its derived mark, the state a seeded database is in. */
  thumbnails?: CompanyImageThumbnails
  queryClient?: QueryClient
  crmOverrides?: Parameters<typeof stubCrm>[0]
} = {}) {
  // Stateful, not a fixed return: settings:set's onSuccess invalidates and
  // refetches settings:get in the background (the real round trip a
  // mutation-then-invalidate does), so a stub that always answered with the
  // render's initial `mode` would clobber an optimistic toggle back to its
  // starting value the moment that refetch lands.
  let currentMode = mode
  window.crm = stubCrm({
    'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
    'engagements:list': vi.fn(async () => ({ ok: true as const, data: engagements })),
    'companyImages:thumbnails': vi.fn(async () => ({ ok: true as const, data: thumbnails })),
    'settings:get': vi.fn(async () => ({
      ok: true as const,
      data: { key: 'view.companies.mode' as const, value: currentMode }
    })),
    'settings:set': vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.companies.mode') currentMode = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    }),
    ...crmOverrides
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/companies']}>
        <LayerManager>
          <Routes>
            <Route path="/companies" element={<Companies />} />
            <Route path="/company/:id" element={<CompanyDetail />} />
          </Routes>
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...result, queryClient }
}

/**
 * Asserts the dialog is `CompanySheet`, not something merely titled like it.
 * The name input is the cheapest thing only the real form has: the shell
 * T-260829-08 deleted had the same title and role and no fields at all.
 */
function expectRealCompanyForm(dialog: HTMLElement): void {
  const name = within(dialog).getByLabelText('Name') as HTMLInputElement
  expect(name.placeholder).toBe('Acme Co')
  fireEvent.change(name, { target: { value: 'Northwind' } })
  expect(name.value).toBe('Northwind')
  const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement
  expect(create.disabled).toBe(false)
}

describe('Companies', () => {
  /**
   * This list used to drop every company with a `billedViaCompanyId`. The
   * tidiness was real and the cost was worse: a company created as billed
   * through another one vanished from the only place you browse companies,
   * findable afterwards only by search or by already knowing which parent to
   * open. These four cover the replacement.
   */
  describe('end clients', () => {
    it('lists an end client alongside its billing partner rather than hiding it', async () => {
      renderCompanies()
      await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

      expect(screen.getByText('Rinvii')).toBeTruthy()
      // The two the old filter dropped. Both are billed via EZDeploy.
      expect(screen.getByText('W+K')).toBeTruthy()
      expect(screen.getByText('Programetrix')).toBeTruthy()
    })

    it('marks an end client with the partner it bills through, so it does not read as a peer', async () => {
      renderCompanies()
      await waitFor(() => expect(screen.getByText('W+K')).toBeTruthy())
      expect(screen.getAllByText('via EZDeploy')).toHaveLength(2)
      // And the partner still states how many hang off it.
      expect(screen.getByText('2 end clients')).toBeTruthy()
    })

    it('hides them again under Direct only', async () => {
      renderCompanies()
      await waitFor(() => expect(screen.getByText('W+K')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Direct only' }))

      await waitFor(() => expect(screen.queryByText('W+K')).toBeNull())
      expect(screen.queryByText('Programetrix')).toBeNull()
      expect(screen.getByText('EZDeploy')).toBeTruthy()
      expect(screen.getByText('2 end clients')).toBeTruthy()
    })

    it('says which control is hiding them when Direct only empties the list, rather than "no companies yet"', async () => {
      renderCompanies({ companies: [WK, PROGRAMETRIX] })
      await waitFor(() => expect(screen.getByText('W+K')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Direct only' }))

      await waitFor(() => expect(screen.getByText(/Every company here bills through a partner/)).toBeTruthy())
      expect(screen.queryByText(/No companies yet/)).toBeNull()
    })

    it('carries the marker into the list presentation too', async () => {
      renderCompanies({ mode: 'list' })
      await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
      expect(screen.getByText('W+K')).toBeTruthy()
      expect(screen.getAllByText('via EZDeploy')).toHaveLength(2)
    })
  })

  it('renders the same record set — same count, same default order — in both presentations', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())
    const cardNames = screen.getAllByText(/^(EZDeploy|Rinvii)$/).map((el) => el.textContent)

    // Same component instance, same query cache — only the presentation toggled.
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
    const listNames = screen.getAllByText(/^(EZDeploy|Rinvii)$/).map((el) => el.textContent)

    expect(listNames).toEqual(cardNames)
    expect(cardNames).toHaveLength(2)
  })

  it('sorts the list on a column click, and the order survives switching to cards and back', async () => {
    // The two direct companies only. This test is about ordering, and the
    // default fixture's end clients carry "via EZDeploy" in their metadata
    // line, which the row-name matcher below would pick up as a third and
    // fourth "EZDeploy".
    renderCompanies({ mode: 'list', companies: [EZDEPLOY, RINVII] })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())

    const rowsInOrder = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByText(/EZDeploy|Rinvii/)[0].textContent)
    // Default order matches companies:list's own (alphabetical: EZDeploy, Rinvii).
    expect(rowsInOrder()).toEqual(['EZDeploy', 'Rinvii'])

    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(rowsInOrder()).toEqual(['EZDeploy', 'Rinvii']) // ascending, unchanged
    fireEvent.click(screen.getByRole('button', { name: 'Company' }))
    expect(rowsInOrder()).toEqual(['Rinvii', 'EZDeploy']) // descending, reversed

    fireEvent.click(screen.getByRole('button', { name: 'Card view' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^EZDeploy/ })).toBeTruthy())
    const cardOrder = screen.getAllByText(/^(EZDeploy|Rinvii)$/).map((el) => el.textContent)
    expect(cardOrder).toEqual(['Rinvii', 'EZDeploy'])

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(rowsInOrder()).toEqual(['Rinvii', 'EZDeploy']))
  })

  it('shows the empty state, not a blank panel, when there are zero companies', async () => {
    renderCompanies({ companies: [], engagements: [] })
    await waitFor(() => expect(screen.getByText(/No companies yet/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Add company' })).toBeTruthy()
    // The header's own create action is still there too.
    expect(screen.getByRole('button', { name: 'New company' })).toBeTruthy()
  })

  it('a company created elsewhere appears without a manual reload, once the companies entity is invalidated', async () => {
    let companies: readonly Company[] = []
    const queryClient = createQueryClient()
    window.crm = stubCrm({
      'companies:list': vi.fn(async () => ({ ok: true as const, data: companies })),
      'engagements:list': vi.fn(async () => ({ ok: true as const, data: [] })),
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'view.companies.mode' as const, value: 'card' as const }
      }))
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/companies']}>
          <LayerManager>
            <Companies />
          </LayerManager>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText(/No companies yet/)).toBeTruthy())

    // Models what the eventual create-sheet mutation (T-260828-27) does on
    // success: main now has the new row, and the mutation invalidates the
    // companies entity through the same helper every other mutation uses.
    companies = [EZDEPLOY]
    await act(async () => {
      await invalidate.companies(queryClient)
    })

    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())
    expect(screen.queryByText(/No companies yet/)).toBeNull()
  })

  it('persists the presentation choice through settings:set, and a later mount reads it back (survives a restart)', async () => {
    let persisted: 'card' | 'list' = 'card'
    const settingsSet = vi.fn(async (entry: SettingEntry) => {
      if (entry.key === 'view.companies.mode') persisted = entry.value
      return { ok: true as const, data: { ok: true as const, data: entry } }
    })
    const crmOverrides = {
      'settings:get': vi.fn(async () => ({
        ok: true as const,
        data: { key: 'view.companies.mode' as const, value: persisted }
      })),
      'settings:set': settingsSet
    }

    const first = renderCompanies({ mode: 'card', crmOverrides })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.companies.mode', value: 'list' }))
    first.unmount()

    // A fresh mount — a new QueryClient, standing in for the app restarting —
    // reads the persisted value straight from settings:get with no prop
    // telling it which mode to start in.
    renderCompanies({ mode: persisted, queryClient: createQueryClient(), crmOverrides })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
  })

  it('every card is a real button — Tab/Enter/Space work with no extra wiring — and activating one navigates to its detail route', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    const card = screen.getByRole('button', { name: /^EZDeploy/ })
    expect(card.tagName).toBe('BUTTON')

    fireEvent.click(card)
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('ezdeploy'))
  })

  it('every table row is keyboard-reachable and Enter activates it, navigating to its detail route', async () => {
    renderCompanies({ mode: 'list' })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())

    const row = screen.getByText('Rinvii').closest('tr')
    if (!row) throw new Error('row not found')
    expect(row.tabIndex).toBe(0)

    fireEvent.keyDown(row, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('rinvii'))
  })

  it('renders a determinate cadence state, never NaN, for a company with no last_touch_at (fresh install)', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('Rinvii')).toBeTruthy())

    const rinviiCard = screen.getByRole('button', { name: /^Rinvii/ })
    expect(rinviiCard.textContent).toContain('never')
    expect(rinviiCard.textContent).not.toMatch(/NaN/)

    // And it reads as maximally stale, not as healthy (ADR-001 rule 5). The
    // label alone does not say this: a `decayPct` that returned 0 for a
    // never-contacted company would still render the word "never" — over a
    // green, full-health bar (T-260828-53 item 7).
    const meter = rinviiCard.querySelector('.decay')
    expect(meter?.className).toContain('late')
    expect(meter?.className).not.toContain('ok')
  })

  /**
   * The T-260829-08 regression. Both these buttons opened a sheet with the
   * right title, a disabled Create button and no fields, because they called
   * `openSheet` without a kind — so an assertion that "a dialog named 'New
   * company' is open" passed against the broken build and is worth nothing
   * here. What separates the real form from that placeholder is a field, so
   * that is what these assert: the company name input, by its label, its
   * placeholder and its editability, plus a Create button that is enabled.
   *
   * The empty state runs first because an empty database is where a
   * first-run user meets these buttons — and where the empty-state one is
   * the only way in.
   */
  it('opens a real company form — not a titled shell — from the empty state and from the header', async () => {
    renderCompanies({ companies: [], engagements: [] })
    await waitFor(() => expect(screen.getByText(/No companies yet/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Add company' }))
    const fromEmptyState = screen.getByRole('dialog', { name: 'New company' })
    expectRealCompanyForm(fromEmptyState)

    fireEvent.click(within(fromEmptyState).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'New company' }))
    expectRealCompanyForm(screen.getByRole('dialog', { name: 'New company' }))
  })

  it('opens a real company form from the grid\'s own "Add company" card', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Add company' }))
    expectRealCompanyForm(screen.getByRole('dialog', { name: 'New company' }))
  })

  it('offers the presentation toggle as icon buttons, each with the name a screen reader reads', async () => {
    renderCompanies({ mode: 'card' })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    // `.claude/rules/ui-design.md`: icon buttons by default, and an icon-only
    // control still carries a label. The mockup's own VIEWTOG wording.
    const cardView = screen.getByRole('button', { name: 'Card view' })
    const listView = screen.getByRole('button', { name: 'List view' })
    expect(cardView.textContent).toBe('')
    expect(cardView.querySelector('svg')).toBeTruthy()
    expect(cardView.getAttribute('aria-pressed')).toBe('true')
    expect(listView.getAttribute('aria-pressed')).toBe('false')
  })

  it('rolls the toggle back to the stored presentation when settings:set fails', async () => {
    // The optimistic write has to be undone by an onError, not left standing:
    // without one the view keeps claiming a preference main never stored
    // (T-260828-53 item 6). settings:get answers 'card' once and then never
    // resolves, so the reconciling refetch cannot paper over a missing
    // rollback — the only thing that can put 'card' back on screen is the
    // rollback itself.
    let getCalls = 0
    const settingsGet = vi.fn(async () => {
      getCalls += 1
      if (getCalls === 1) return { ok: true as const, data: { key: 'view.companies.mode' as const, value: 'card' as const } }
      return new Promise<never>(() => {})
    })
    const settingsSet = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'handler-error' as const, message: 'disk is read-only' }
    }))
    renderCompanies({ crmOverrides: { 'settings:get': settingsGet, 'settings:set': settingsSet } })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    // The click really did ask main to store 'list' — the toggle below is
    // back on 'card' because the write failed, not because nothing happened.
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ key: 'view.companies.mode', value: 'list' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Card view' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe('false')
    // And the cards, not the table, are what is actually on screen.
    expect(screen.queryByRole('columnheader', { name: /company/i })).toBeNull()
  })

  it('draws a company\'s banner behind its card as a wash layer, with every existing element of the card still there', async () => {
    renderCompanies({ mode: 'card', thumbnails: EZDEPLOY_IMAGES })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    const card = screen.getByRole('button', { name: /^EZDeploy/ })
    const wash = card.querySelector('.ccard-wash') as HTMLElement | null
    if (!wash) throw new Error('no banner layer rendered')

    // The layer carries the derivative the one thumbnails read returned —
    // not an original, and not a URL the card fetched for itself.
    expect(wash.style.backgroundImage).toContain(PIXEL_JPEG)
    expect(card.className).toContain('has-banner')

    // A background layer must not change what is clickable or what the card
    // is called: still one button, still named for the company, and the
    // layer is hidden from the accessibility tree entirely.
    expect(card.tagName).toBe('BUTTON')
    expect(wash.getAttribute('aria-hidden')).toBe('true')
    expect(within(card).queryAllByRole('button')).toHaveLength(0)

    // Nothing the card used to show has been displaced by the image.
    expect(within(card).getByText('EZDeploy')).toBeTruthy()
    expect(within(card).getByText('Client')).toBeTruthy()
    expect(within(card).getByText('1 active')).toBeTruthy()
    expect(within(card).getByText('2 end clients')).toBeTruthy()
    expect(card.querySelector('.decay')).toBeTruthy()
    expect(card.textContent).toContain('every 10d')

    fireEvent.click(card)
    await waitFor(() => expect(screen.getByTestId('company-detail').textContent).toBe('ezdeploy'))
  })

  it('shows a company\'s logo in place of the initials mark, on the card and in the table\'s 26px mark', async () => {
    const cardMode = renderCompanies({ mode: 'card', thumbnails: EZDEPLOY_IMAGES })
    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())

    const ezdeployCard = screen.getByRole('button', { name: /^EZDeploy/ })
    const logo = ezdeployCard.querySelector('.cmark img') as HTMLImageElement | null
    if (!logo) throw new Error('no logo rendered on the card')
    expect(logo.getAttribute('src')).toBe(PIXEL_PNG)
    // The derived initials are gone, not stacked underneath the image.
    expect(ezdeployCard.querySelector('.cmark')?.textContent).toBe('')
    // Decorative on both counts: the name is right beside it.
    expect(logo.getAttribute('alt')).toBe('')
    // Rinvii has no images, so it still draws its initials.
    expect(screen.getByRole('button', { name: /^Rinvii/ }).querySelector('.cmark')?.textContent).toBe('R')
    cardMode.unmount()

    renderCompanies({ mode: 'list', thumbnails: EZDEPLOY_IMAGES })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
    const row = screen.getByText('EZDeploy').closest('tr')
    if (!row) throw new Error('row not found')
    expect((row.querySelector('.cmark img') as HTMLImageElement | null)?.getAttribute('src')).toBe(PIXEL_PNG)
    // "A table row is not a canvas" — the logo travels to the list
    // presentation, the banner does not, anywhere in the document.
    expect(document.querySelector('.ccard-wash')).toBeNull()
    expect(row.innerHTML).not.toContain(PIXEL_JPEG)
  })

  it('renders a company with no banner exactly as it did before company images existed', async () => {
    // The comparison the acceptance asks for: the same card, rendered once
    // with nothing in the thumbnails map at all and once with another
    // company's images in it, has to come out identical — no placeholder, no
    // empty band, no extra element, no extra class.
    const withoutImages = renderCompanies({ mode: 'card', thumbnails: {} })
    await waitFor(() => expect(screen.getByText('Rinvii')).toBeTruthy())
    const before = screen.getByRole('button', { name: /^Rinvii/ }).outerHTML
    withoutImages.unmount()

    renderCompanies({ mode: 'card', thumbnails: EZDEPLOY_IMAGES })
    await waitFor(() => expect(screen.getByText('Rinvii')).toBeTruthy())
    const rinvii = screen.getByRole('button', { name: /^Rinvii/ })

    expect(rinvii.outerHTML).toBe(before)
    expect(rinvii.className).toBe('ccard')
    expect(rinvii.querySelector('.ccard-wash')).toBeNull()
    expect(rinvii.querySelector('img')).toBeNull()
    expect(rinvii.querySelector('[style]')?.getAttribute('style')).not.toContain('background')
    // The other half of "unchanged" — that no *rule* reaches an un-bannered
    // card either — is asserted against the stylesheet itself, in
    // `Companies.css.test.ts`.
  })

  it('reads every card\'s images in one call regardless of how many cards there are — never one fetch per card', async () => {
    // ADR-015's list read, asserted by counting. Sixty companies each pulling
    // their own full-size banner is 83.9 MB of base64 and is invisible on a
    // seeded database with no images at all, so the count is the only thing
    // standing between the grid and that regression.
    const companies = Array.from({ length: 30 }, (_, i) =>
      makeCompany({ id: `co-${i}`, name: `Company ${String(i).padStart(2, '0')}`, lastTouchAt: isoDaysAgo(i) })
    )
    const thumbnails = vi.fn(async () => ({ ok: true as const, data: EZDEPLOY_IMAGES }))
    renderCompanies({ mode: 'card', companies, engagements: [], crmOverrides: { 'companyImages:thumbnails': thumbnails } })

    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Company \d\d/ })).toHaveLength(30))
    expect(thumbnails).toHaveBeenCalledTimes(1)
    // And through `ipcQueryFn`'s calling convention — no payload for a
    // channel whose request schema is `z.undefined()`, so nobody has quietly
    // narrowed it to "the ids on screen" either.
    expect(thumbnails).toHaveBeenCalledWith(undefined)

    // Switching presentation is the same data through a second renderer, not
    // a second read: the table is ADR-015's other reader of this one map.
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /company/i })).toBeTruthy())
    expect(thumbnails).toHaveBeenCalledTimes(1)
  })

  it('still paints the grid when the images read fails — a missing thumbnail is not a missing company', async () => {
    const thumbnails = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'handler-error' as const, message: 'blob read failed' }
    }))
    renderCompanies({ mode: 'card', crmOverrides: { 'companyImages:thumbnails': thumbnails } })

    await waitFor(() => expect(screen.getByText('EZDeploy')).toBeTruthy())
    expect(screen.queryByText('blob read failed')).toBeNull()
    expect(screen.getByRole('button', { name: /^EZDeploy/ }).className).toBe('ccard')
  })

  it('never calls window.crm from this module directly — every read is wired through the ipc/query-key helpers', async () => {
    const companiesList = vi.fn(async () => ({ ok: true as const, data: [EZDEPLOY] }))
    renderCompanies({ crmOverrides: { 'companies:list': companiesList } })
    await waitFor(() => expect(companiesList).toHaveBeenCalled())
    // Called with the calling convention callCrmImpl/ipcQueryFn use — no
    // payload for a channel whose request schema is `z.undefined()` — which
    // only holds if this view went through ipc.ts rather than invoking
    // window.crm['companies:list'] with something ad hoc.
    expect(companiesList).toHaveBeenCalledWith(undefined)
  })
})
