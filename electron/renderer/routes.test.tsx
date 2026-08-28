import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes } from './routes'
import { NAV_ITEMS, ROUTE_META } from './nav'
import { LayerManager } from './components/shell/LayerManager'
import { createQueryClient } from './lib/query-client'
import { stubCrm } from './lib/test-support/stub-crm'

// T-260828-28: the Companies route is query-backed now (the first of the
// ten views to be) — see Shell.test.tsx's identical comment.
afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function renderAt(path: string) {
  window.crm = stubCrm()
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LayerManager>
          <AppRoutes />
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('AppRoutes', () => {
  it('resolves every one of the ten views and highlights its own nav item', () => {
    for (const item of NAV_ITEMS) {
      const { unmount } = renderAt(item.path)
      const link = screen.getByRole('link', { name: item.label })
      expect(link.getAttribute('aria-current')).toBe('page')
      unmount()
    }
  })

  it('resolves company/:id and highlights Companies, not itself', () => {
    renderAt('/company/co_1')
    const companies = screen.getByRole('link', { name: 'Companies' })
    expect(companies.getAttribute('aria-current')).toBe('page')
    // Confirms the detail route actually rendered (not a silent fallback).
    expect(screen.getByRole('heading', { name: 'Company' })).toBeTruthy()
  })

  it('resolves person/:id and highlights People, not itself', () => {
    renderAt('/person/pe_1')
    const people = screen.getByRole('link', { name: 'People' })
    expect(people.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: 'Person' })).toBeTruthy()
  })

  it('every ROUTE_META row is reachable and highlights the row\'s own navId', () => {
    for (const meta of ROUTE_META) {
      const path = meta.path.replace(':id', 'test-id')
      const { unmount } = renderAt(path)
      const navItem = NAV_ITEMS.find((item) => item.id === meta.navId)
      if (!navItem) throw new Error(`ROUTE_META entry ${meta.path} names an unknown navId ${meta.navId}`)
      const link = screen.getByRole('link', { name: navItem.label })
      expect(link.getAttribute('aria-current')).toBe('page')
      unmount()
    }
  })

  it('nests Settings and Data under /workspace rather than as top-level routes (X-01)', () => {
    // A bare /workspace has no view of its own — it redirects to settings,
    // proving the two children are real nested routes, not synonyms for a
    // single top-level /workspace route.
    renderAt('/workspace')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('redirects an unmatched path to Today rather than rendering nothing', () => {
    renderAt('/this-route-does-not-exist')
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  it('does not render the Pipeline nav item or route (ADR-005)', () => {
    renderAt('/')
    expect(screen.queryByRole('link', { name: /pipeline/i })).toBeNull()
  })
})
