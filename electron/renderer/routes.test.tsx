import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppRoutes } from './routes'
// Vite ?raw, not node:fs: a renderer module may not touch the filesystem
// (local/no-renderer-node-access, AGENTS.md), and blunting that rule to let a
// test read a file would be trading a real boundary for a convenience. The
// sanity assertion below is what proves this import actually arrived with
// content — .css imports are blanked by vitest css-disable plugin, so an
// empty string is a real possibility worth asserting against, not a paranoia.
import ROUTES_SOURCE from './routes.tsx?raw'
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

  it('resolves person/:id and highlights People, not itself', async () => {
    renderAt('/person/pe_1')
    const people = screen.getByRole('link', { name: 'People' })
    expect(people.getAttribute('aria-current')).toBe('page')
    // T-260828-31's PersonDetail is a real, query-backed view now (matching
    // CompanyDetail's own precedent above) — an id nothing seeded resolves
    // to its "not found" state, not a crash or an infinite spinner.
    // PersonDetail.test.tsx covers this view's real content in depth; this
    // only proves routing wired it in.
    expect(await screen.findByText(/not found/i)).toBeTruthy()
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

  it('resolves /offerings to the real view, not a placeholder', async () => {
    // T-260901-11 replaced this route's `ViewPlaceholder`. The placeholder
    // rendered an `<h1>Offerings</h1>` too, so the heading alone would pass
    // against either — what only the real view produces is its own body,
    // reached through `offerings:list`/`offerings:listCategories` (both empty
    // under `stubCrm`, so the empty state is the honest answer here).
    // Offerings.test.tsx covers this view's content in depth.
    renderAt('/offerings')
    expect(screen.getByRole('heading', { name: 'Offerings' })).toBeTruthy()
    expect(await screen.findByText(/Nothing in the catalogue yet/)).toBeTruthy()
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

  it('opens the quick log with ⌘L from every route in the table, detail routes included', () => {
    // T-260828-35's acceptance. `ShellLayout` registers the shortcut once for
    // the whole tree (`useGlobalShortcuts`), so this is really a check that
    // no route escapes that layout — a view rendered outside it would be the
    // one place ⌘L silently does nothing. Every path ROUTE_META names, which
    // is every leaf plus `company/:id` and `person/:id`.
    for (const meta of ROUTE_META) {
      const path = meta.path.replace(':id', 'test-id')
      const { unmount } = renderAt(path)
      fireEvent.keyDown(document, { key: 'l', metaKey: true })
      expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
      unmount()
    }
  })
})


/**
 * The other direction (T-260828-15).
 *
 * The test above walks `ROUTE_META` and proves every entry resolves. That is
 * one half of an agreement, and it was the only half checked: a `<Route>` added
 * to `AppRoutes` alone — the ordinary way a view is added — highlighted no nav
 * item, showed no breadcrumb, and **every test stayed green**, because nothing
 * ever read the route table from the side that declares it.
 *
 * So this reads `routes.tsx`'s own source and requires each declared path to
 * appear in `ROUTE_META`. Source-scanning rather than introspecting the element
 * tree is deliberate and matches this repo's other structural guards
 * (`connection.test.ts`'s Database-owner walk, the favicon service scan): React
 * Router gives no supported way to enumerate a `<Routes>` subtree without
 * rendering it, and rendering tells you what resolves, never what was declared.
 *
 * Three exclusions, each for a stated reason rather than to make a list fit:
 *
 *  - `*` is the catch-all that redirects to Today. It is not a destination.
 *  - `workspace` is a layout wrapper rendering an `<Outlet />` and an index
 *    redirect; the two real paths under it, `/workspace/settings` and
 *    `/workspace/data`, are both in `ROUTE_META` and are checked here.
 *  - An `index` route has no `path` attribute at all, so it cannot appear in
 *    this scan; `/` is covered by the ROUTE_META direction above.
 */
describe('AppRoutes and ROUTE_META agree in both directions', () => {

  /** Paths that are structural rather than destinations — see the block above. */
  const NOT_DESTINATIONS = new Set(['*', 'workspace'])

  /**
   * `path="x"` on a `<Route>`, in declaration order. Nested routes are matched
   * too, which is why `settings` and `data` need their parent segment restored
   * before they can be compared with ROUTE_META's absolute paths.
   */
  function declaredPaths(): string[] {
    return [...ROUTES_SOURCE.matchAll(/<Route\s+path="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !NOT_DESTINATIONS.has(path))
  }

  function absolutePath(path: string): string {
    return path === 'settings' || path === 'data' ? `/workspace/${path}` : `/${path}`
  }

  it('finds the route table in the source — the scan is not silently matching nothing', () => {
    // Without this, a rename of the file or a change to how routes are written
    // would turn every assertion below into a vacuous pass over an empty list.
    expect(declaredPaths().length).toBeGreaterThanOrEqual(11)
  })

  it.each(declaredPaths())('a route declared as "%s" has a ROUTE_META entry', (path) => {
    const expected = absolutePath(path)
    const meta = ROUTE_META.find((row) => row.path === expected)
    expect(
      meta,
      `<Route path="${path}"> is declared in routes.tsx but ${expected} is missing from ROUTE_META (nav.ts). ` +
        'Without an entry the route renders, highlights no nav item and shows no breadcrumb — silently, with every other test green.'
    ).toBeTruthy()
  })
})
