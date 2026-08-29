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
  'view.data.snippets': []
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
  it('renders all ten views across three groups, and nothing for the dropped Pipeline view', () => {
    renderRail('/')
    expect(NAV_ITEMS).toHaveLength(10)
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
