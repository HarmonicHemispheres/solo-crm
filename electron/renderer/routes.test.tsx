import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes } from './routes'
import { NAV_ITEMS, ROUTE_META } from './nav'
import { LayerManager } from './components/shell/LayerManager'
import { createQueryClient } from './lib/query-client'
import { stubCrm } from './lib/test-support/stub-crm'

// T-260828-28 and -29: the Companies and CompanyDetail routes are query-backed
// now (the first two of the ten views to be) — see Shell.test.tsx's identical
// comment. One teardown covers both; the two branches each added their own.
afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assigns.
  delete window.crm
})

/**
 * T-260828-29's CompanyDetail is the first real view on this tree — every
 * other route here is still a `ViewPlaceholder` that renders with no
 * provider at all, but a real view reads `window.crm` through TanStack
 * Query the same way `App.tsx` sets up for the real app (T-260828-10), so
 * every render here needs both a `QueryClientProvider` (a fresh client per
 * call — no cache bleeding between the loop's iterations) and a `window.crm`
 * stub, exactly like `App.tsx` itself provides in production.
 */
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

  it('resolves company/:id and highlights Companies, not itself', async () => {
    renderAt('/company/co_1')
    const companies = screen.getByRole('link', { name: 'Companies' })
    expect(companies.getAttribute('aria-current')).toBe('page')
    // Confirms the detail route actually rendered CompanyDetail (T-260828-29),
    // not a silent fallback — an id nothing seeded resolves to the "not
    // found" state that task's acceptance requires, not a crash or an
    // infinite spinner. CompanyDetail.test.tsx covers that view's real
    // content in depth; this only proves routing wired it in.
    expect(await screen.findByText(/not found/i)).toBeTruthy()
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
    // 'Workspace', not 'Settings': T-260828-38 replaced the ViewPlaceholder
    // with the real view, whose <h1> matches the mockup's own header for
    // this route verbatim (planning/solo-crm-mockup.html: `H('Workspace',
    // 'settings','')` — the mockup's breadcrumb for this route is
    // 'Workspace' too, see nav.ts's ROUTE_META). The nav link's own label
    // is still 'Settings' (nav.ts's NAV_ITEMS) — only the page's own
    // heading changed when it stopped being a placeholder.
    expect(screen.getByRole('heading', { name: 'Workspace' })).toBeTruthy()
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
