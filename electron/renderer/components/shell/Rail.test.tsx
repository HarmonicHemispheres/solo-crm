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

  it('names the product through the wordmark itself, not a text row repeating it', () => {
    renderRail('/')
    // One accessible "Solo CRM" in the brand block, and it is the wordmark —
    // the mark beside it is decorative, and the `.rail-app` name span the
    // mockup carried is gone (T-260829-06).
    const wordmarks = screen.getAllByRole('img', { name: 'Solo CRM' })
    expect(wordmarks).toHaveLength(1)
    expect(wordmarks[0].classList.contains('wordmark')).toBe(true)
    expect(document.querySelector('.rail-app .name')).toBeNull()
  })

  it('renders the database chip linking to Workspace / Data', () => {
    renderRail('/')
    const dbLink = screen.getByRole('link', { name: /solocrm\.db/ })
    expect(dbLink.getAttribute('href')).toBe('/workspace/data')
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
