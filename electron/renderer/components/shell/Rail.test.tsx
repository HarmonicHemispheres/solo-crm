import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Rail } from './Rail'
import { NAV_ITEMS } from '../../nav'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import type { CrmApi } from '../../../shared/ipc-types'
import type { SettingsSnapshot } from '../../../shared/settings'
import type { BrandingSlot, BrandingSlotState } from '../../../shared/branding'

/** A whole snapshot, since `settings:getAll` answers with one — the rail reads
 * `workspace.name` off it for the brand block's accessible name (T-260829-07).
 * Declared here rather than exported out of `stub-crm.ts` for the same reason
 * WorkspaceSettings.test.tsx declares its own: a test that wants a different
 * value wants to say so in the test, next to the assertion it explains. */
const SETTINGS_SNAPSHOT: SettingsSnapshot = {
  'workspace.name': '',
  'workspace.operator': '',
  'workspace.currency': 'USD',
  'workspace.fiscalYearStartMonth': 1,
  'cadence.defaultDays.client': 7,
  'cadence.defaultDays.end_client': 14,
  'cadence.defaultDays.prospect': 14,
  'cadence.defaultDays.advisory': 21,
  'cadence.defaultDays.channel': 30,
  'integrations.stripe.enabled': true,
  'integrations.googleCalendar.enabled': true,
  'integrations.gmail.enabled': false,
  'backup.enabled': true,
  'backup.folder': '',
  'appearance.motion': true,
  'appearance.density': 'comfortable',
  'view.companies.mode': 'card',
  'view.people.mode': 'card',
  'view.todos.groupBy': 'date',
  'view.data.snippets': [],
  'nav.reportsExpanded': true,
  // `true` — this file is about the rail, not about first run. The tour's
  // three conditions are asserted in Tour.test.tsx.
  'onboarding.tourSeen': true
}

/** A stored slot as `branding:get` would answer with it. The `data:` prefix is
 * the assertion in more than one test below: it is the only image transport
 * the renderer's CSP admits (`electron/shared/branding.ts`). */
function presentSlot(slot: BrandingSlot): BrandingSlotState {
  return {
    state: 'present',
    slot,
    contentType: 'image/png',
    dataUrl: `data:image/png;base64,${slot === 'icon' ? 'aWNvbg==' : 'bG9nbw=='}`,
    byteLength: 34816,
    updatedAt: '2026-08-29T00:00:00.000Z'
  }
}

function absentSlot(slot: BrandingSlot): BrandingSlotState {
  return { state: 'absent', slot }
}

function brandingGet(icon: BrandingSlotState, logo: BrandingSlotState) {
  return { 'branding:get': vi.fn(async () => ({ ok: true as const, data: { icon, logo } })) }
}

// T-260829-06: the version chip is a live `app:version` read now, so the rail
// needs a QueryClientProvider and a `window.crm` the same way Shell.test.tsx's
// harness does.
afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function renderRail(path: string, onNavigate = vi.fn(), crmOverrides: Partial<CrmApi> = {}) {
  window.crm = stubCrm(crmOverrides)
  return { onNavigate, ...render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Rail open={false} onNavigate={onNavigate} />
      </MemoryRouter>
    </QueryClientProvider>
  ) }
}

describe('Rail', () => {
  it('renders all eleven views across three groups, and nothing for the dropped Pipeline view', () => {
    renderRail('/')
    // Ten from the mockup, minus Pipeline (ADR-005), plus the engagement
    // timeline the mockup draws as a toggle on Engagements (T-260902-16).
    expect(NAV_ITEMS).toHaveLength(11)
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('link', { name: item.label })).toBeTruthy()
    }
    expect(screen.queryByRole('link', { name: /pipeline/i })).toBeNull()
  })

  it('highlights only the nav item matching the current route', () => {
    renderRail('/todos')
    const todos = screen.getByRole('link', { name: 'Todos' })
    expect(todos.getAttribute('aria-current')).toBe('page')
    expect(todos.className).toContain('on')

    const companies = screen.getByRole('link', { name: 'Companies' })
    expect(companies.getAttribute('aria-current')).toBeNull()
    expect(companies.className).not.toContain('on')
  })

  it('highlights Companies from a company detail route', () => {
    renderRail('/company/co_1')
    expect(screen.getByRole('link', { name: 'Companies' }).getAttribute('aria-current')).toBe('page')
  })

  it('highlights People from a person detail route', () => {
    renderRail('/person/pe_1')
    expect(screen.getByRole('link', { name: 'People' }).getAttribute('aria-current')).toBe('page')
  })

  it('calls onNavigate when a nav item is clicked, so the off-canvas rail can close itself', () => {
    const { onNavigate } = renderRail('/')
    fireEvent.click(screen.getByRole('link', { name: 'Todos' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('renders nav items as real links — reachable by Tab, activate on Enter by native anchor semantics', () => {
    renderRail('/')
    const link = screen.getByRole('link', { name: 'Companies' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/companies')
    expect(link.getAttribute('tabindex')).not.toBe('-1')
  })

  it('shows a placeholder, not a zero, on the count-bearing nav items — and marks it decorative', () => {
    renderRail('/')
    const todos = screen.getByRole('link', { name: 'Todos' })
    expect(todos.textContent).toContain('–')
    expect(todos.textContent).not.toMatch(/\d/)
    const countEl = todos.querySelector('.count')
    expect(countEl?.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not show a count slot on nav items the mockup gives none (Today, Revenue, Activity, Settings)', () => {
    renderRail('/')
    for (const label of ['Today', 'Revenue', 'Activity', 'Settings']) {
      const link = screen.getByRole('link', { name: label })
      expect(link.querySelector('.count')).toBeNull()
    }
  })

  /**
   * T-260902-13. Revenue is one report and the engagement timeline (P3-12) is
   * the second, so the rail's flat Revenue item became a Reports group with
   * Revenue nested under it.
   */
  describe('the Reports subgroup', () => {
    /**
     * A `settings` pair that actually remembers. `optimisticUpdate` refetches
     * the snapshot on settle (`invalidate.settings`), so a static
     * `settings:getAll` would answer with the *old* value a beat after every
     * successful write and undo it — the stub, not the rail, would be the
     * thing under test. `stored` is main's row.
     */
    function settingsStore(initial: boolean, { failWrites = false, gate }: { failWrites?: boolean; gate?: Promise<void> } = {}) {
      let stored = initial
      return {
        'settings:getAll': vi.fn(async () => ({
          ok: true as const,
          data: { ...SETTINGS_SNAPSHOT, 'nav.reportsExpanded': stored }
        })),
        'settings:set': vi.fn(async (payload: { key: string; value: unknown }) => {
          // A write held open, so the optimistic window is a real window and
          // not a race with the assertion.
          if (gate) await gate
          if (failWrites) {
            return {
              ok: true as const,
              data: { ok: false as const, error: { code: 'validation' as const, message: 'nope' } }
            }
          }
          if (payload.key === 'nav.reportsExpanded') stored = payload.value as boolean
          return { ok: true as const, data: { ok: true as const, data: payload } }
        })
      } as unknown as Partial<CrmApi>
    }

    function deferred() {
      let release!: () => void
      const promise = new Promise<void>((resolve) => {
        release = resolve
      })
      return { promise, release }
    }

    it('draws Reports as a header, not a link — it has no route of its own', () => {
      renderRail('/')
      expect(screen.getByRole('button', { name: /Reports/ })).toBeTruthy()
      expect(screen.queryByRole('link', { name: 'Reports' })).toBeNull()
    })

    it('nests Revenue inside the group rather than leaving it at the top level', () => {
      renderRail('/')
      expect(screen.getByRole('link', { name: 'Revenue' }).className).toContain('nav-nested')
    })

    it('hides its children when collapsed, so an out-of-view link is not a Tab stop', async () => {
      renderRail('/', vi.fn(), settingsStore(false))
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Revenue' })).toBeNull())
      expect(screen.getByRole('button', { name: /Reports/ }).getAttribute('aria-expanded')).toBe('false')
    })

    it('expands on click and writes the new state through settings:set', async () => {
      renderRail('/', vi.fn(), settingsStore(false))
      const header = screen.getByRole('button', { name: /Reports/ })
      await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('false'))

      fireEvent.click(header)

      await waitFor(() => expect(screen.getByRole('link', { name: 'Revenue' })).toBeTruthy())
      expect(window.crm['settings:set']).toHaveBeenCalledWith({ key: 'nav.reportsExpanded', value: true })
      // Still open after the settle refetch — the write reached the store,
      // so the reconciliation agrees with the optimistic value.
      await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('true'))
    })

    it('collapses on click, and does not spring open again just because Revenue is the active route', async () => {
      // The failure this guards: forcing the group open whenever a child is
      // active makes the collapse control do nothing at all while you are
      // standing on Revenue — which is exactly when it gets reached for.
      renderRail('/revenue', vi.fn(), settingsStore(true))
      const header = screen.getByRole('button', { name: /Reports/ })
      expect(header.getAttribute('aria-expanded')).toBe('true')

      fireEvent.click(header)

      await waitFor(() => expect(screen.queryByRole('link', { name: 'Revenue' })).toBeNull())
      expect(window.crm['settings:set']).toHaveBeenCalledWith({ key: 'nav.reportsExpanded', value: false })
      expect(header.getAttribute('aria-expanded')).toBe('false')
    })

    it('reopens collapsed on the next launch — the state is in settings, not in component state', async () => {
      // The acceptance's "quit and relaunch": a fresh mount reading the row
      // the previous session wrote.
      renderRail('/', vi.fn(), settingsStore(false))
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Revenue' })).toBeNull())
      expect(window.crm['settings:set']).not.toHaveBeenCalled()
    })

    it('marks the header active while collapsed over the active route, so a collapsed group still says where you are', async () => {
      renderRail('/revenue', vi.fn(), settingsStore(false))
      const header = screen.getByRole('button', { name: /Reports/ })
      await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('false'))
      expect(header.className).toContain('on')
      // `true`, not `page`: the header is not itself the page.
      expect(header.getAttribute('aria-current')).toBe('true')
    })

    it('leaves the header unmarked when expanded — the child carries the highlight', () => {
      renderRail('/revenue')
      expect(screen.getByRole('button', { name: /Reports/ }).getAttribute('aria-current')).toBeNull()
      expect(screen.getByRole('link', { name: 'Revenue' }).getAttribute('aria-current')).toBe('page')
    })

    it('rolls back to collapsed when the write fails, rather than claiming a state main never stored', async () => {
      const write = deferred()
      renderRail('/', vi.fn(), settingsStore(false, { failWrites: true, gate: write.promise }))
      const header = screen.getByRole('button', { name: /Reports/ })
      await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('false'))

      fireEvent.click(header)
      // Optimistic, while the write is still in flight.
      await waitFor(() => expect(screen.getByRole('link', { name: 'Revenue' })).toBeTruthy())

      write.release()

      await waitFor(() => expect(screen.queryByRole('link', { name: 'Revenue' })).toBeNull())
      expect(header.getAttribute('aria-expanded')).toBe('false')
    })

    it('defaults to expanded while settings:getAll is still in flight, so a cold start never hides the only report', () => {
      renderRail('/', vi.fn(), { 'settings:getAll': vi.fn(() => new Promise(() => {})) as unknown as CrmApi['settings:getAll'] })
      expect(screen.getByRole('link', { name: 'Revenue' })).toBeTruthy()
    })
  })

  it('applies the off-canvas "open" class only when told to', () => {
    window.crm = stubCrm()
    const client = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <Rail open={false} onNavigate={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(document.getElementById('rail')?.className).not.toContain('open')

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <Rail open onNavigate={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(document.getElementById('rail')?.className).toContain('open')
  })

  it('names the brand block once, and not from a text row repeating it', () => {
    renderRail('/')
    // Still exactly one accessible name in the brand block, and still not the
    // `.rail-app` name span the mockup carried (T-260829-06). What changed in
    // T-260829-07 is *which element owns it*: the wordmark can now be replaced
    // by an operator's own image, so a name attached to the wordmark would go
    // on announcing "Solo CRM" over a picture that no longer says it. The
    // block that contains both images carries the name instead, and both
    // images inside it are decorative.
    const named = screen.getAllByRole('img', { name: 'Solo CRM' })
    expect(named).toHaveLength(1)
    expect(named[0].classList.contains('brand')).toBe(true)
    expect(document.querySelector('.rail-app .name')).toBeNull()
  })

  it('names the brand block from the workspace once one is named', async () => {
    renderRail('/', vi.fn(), {
      'settings:getAll': vi.fn(async () => ({
        ok: true as const,
        data: { ...SETTINGS_SNAPSHOT, 'workspace.name': 'MagicPill Labs' }
      }))
    })
    await waitFor(() => expect(screen.getByRole('img', { name: 'MagicPill Labs' })).toBeTruthy())
    expect(screen.queryByRole('img', { name: 'Solo CRM' })).toBeNull()
  })

  it('falls back to the product name when the workspace has none, rather than an unnamed image', async () => {
    renderRail('/', vi.fn(), {
      'settings:getAll': vi.fn(async () => ({ ok: true as const, data: { ...SETTINGS_SNAPSHOT, 'workspace.name': '   ' } }))
    })
    await waitFor(() => expect(screen.getByRole('img', { name: 'Solo CRM' })).toBeTruthy())
  })

  it('renders the database chip linking to Workspace / Data', () => {
    renderRail('/')
    const dbLink = screen.getByRole('link', { name: /solocrm\.db/ })
    expect(dbLink.getAttribute('href')).toBe('/workspace/data')
  })

  describe('the brand block (T-260829-07)', () => {
    it('draws the built-in mark and wordmark when the operator has set neither', async () => {
      renderRail('/')
      // The stub answers `absent`/`absent`, so this is the ordinary install.
      await waitFor(() => expect(document.querySelector('.mark > svg')).toBeTruthy())
      expect(document.querySelector('svg.wordmark')).toBeTruthy()
      expect(document.querySelectorAll('.brand img')).toHaveLength(0)
    })

    it("draws the operator's own images once both slots are set", async () => {
      renderRail('/', vi.fn(), brandingGet(presentSlot('icon'), presentSlot('logo')))
      await waitFor(() => expect(document.querySelectorAll('.brand img')).toHaveLength(2))

      for (const img of document.querySelectorAll('.brand img')) {
        expect(img.getAttribute('src')?.startsWith('data:image/')).toBe(true)
        // Decorative: the block around them carries the accessible name.
        expect(img.getAttribute('alt')).toBe('')
      }
      expect(document.querySelector('.mark > svg')).toBeNull()
      expect(document.querySelector('svg.wordmark')).toBeNull()
    })

    it('keeps the two slots independent — a custom icon leaves the built-in wordmark alone', async () => {
      renderRail('/', vi.fn(), brandingGet(presentSlot('icon'), absentSlot('logo')))
      await waitFor(() => expect(document.querySelector('.mark > img')).toBeTruthy())

      expect(document.querySelectorAll('.brand img')).toHaveLength(1)
      expect(document.querySelector('svg.wordmark')).toBeTruthy()
      expect(document.querySelector('.mark > svg')).toBeNull()
    })

    it('and the reverse — a custom wordmark leaves the built-in mark alone', async () => {
      renderRail('/', vi.fn(), brandingGet(absentSlot('icon'), presentSlot('logo')))
      await waitFor(() => expect(document.querySelector('img.wordmark')).toBeTruthy())

      expect(document.querySelectorAll('.brand img')).toHaveLength(1)
      expect(document.querySelector('.mark > svg')).toBeTruthy()
      expect(document.querySelector('svg.wordmark')).toBeNull()
    })

    it('draws the default while branding:get is still in flight — never a blank box', () => {
      renderRail('/', vi.fn(), {
        // Never resolves: the first paint is the whole assertion. The layout
        // shift this task's Risks name starts with a brand block that renders
        // empty and then fills, so "the default is already there" is the fix
        // being pinned — the fixed box sizes that stop the *second* half of
        // the shift are pinned in Rail.test.ts, which can read the stylesheet.
        'branding:get': vi.fn(() => new Promise<never>(() => {}))
      })
      expect(document.querySelector('.mark > svg')).toBeTruthy()
      expect(document.querySelector('svg.wordmark')).toBeTruthy()
      expect(document.querySelector('.brand')?.children).toHaveLength(2)
    })

    it('keeps the built-in default when branding:get fails, rather than an empty brand block', async () => {
      renderRail('/', vi.fn(), {
        'branding:get': vi.fn(async () => ({
          ok: false as const,
          error: { code: 'handler-error' as const, message: 'boom' }
        }))
      })
      await waitFor(() => expect(document.querySelector('.mark > svg')).toBeTruthy())
      expect(document.querySelector('svg.wordmark')).toBeTruthy()
      expect(document.querySelectorAll('.brand img')).toHaveLength(0)
    })
  })

  describe('the version chip', () => {
    it('reads the version app:version answers with, not a literal in the markup', async () => {
      // The number this asserts is deliberately not the stub default and not
      // anything package.json says: the only way the chip can show it is by
      // rendering what the channel returned.
      renderRail('/', vi.fn(), {
        'app:version': vi.fn(async () => ({ ok: true as const, data: { version: '7.3.1-rc.2' } }))
      })
      await waitFor(() => {
        expect(document.querySelector('.rail-app .ver')?.textContent).toBe('v7.3.1-rc.2 · local')
      })
    })

    it('follows a different version without any other edit', async () => {
      renderRail('/', vi.fn(), {
        'app:version': vi.fn(async () => ({ ok: true as const, data: { version: '0.9.0' } }))
      })
      await waitFor(() => {
        expect(document.querySelector('.rail-app .ver')?.textContent).toBe('v0.9.0 · local')
      })
    })

    it('shows `local` alone while the query is in flight rather than flashing a wrong number', () => {
      renderRail('/', vi.fn(), {
        // Never resolves: the first paint is the whole assertion.
        'app:version': vi.fn(() => new Promise<never>(() => {}))
      })
      const chip = document.querySelector('.rail-app .ver')
      expect(chip?.textContent).toBe('local')
      expect(chip?.textContent).not.toMatch(/\d/)
    })

    it('keeps the `local` claim when the channel fails, rather than dropping the row', async () => {
      renderRail('/', vi.fn(), {
        'app:version': vi.fn(async () => ({
          ok: false as const,
          error: { code: 'handler-error' as const, message: 'boom' }
        }))
      })
      await waitFor(() => {
        expect(document.querySelector('.rail-app .ver')?.textContent).toBe('local')
      })
    })
  })
})
