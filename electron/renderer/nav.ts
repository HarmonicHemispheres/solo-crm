import { matchPath, type To } from 'react-router'
import type { SearchKind } from '../shared/search'

/**
 * The ten views the mockup ships, minus Pipeline (ADR-005, T-260828-02) — the
 * rail's three nav groups, unchanged. `id` matches the mockup's own
 * `data-view` values so this table reads against the mockup 1:1.
 *
 * Plain data/logic, no JSX — split out of `routes.tsx` so that file can stay
 * component-only (`react-refresh/only-export-components` disallows mixing
 * component and non-component exports in one file; Rail.tsx and
 * Breadcrumb.tsx both need this table and neither should have to import a
 * route-tree module to get it).
 */
export type NavId =
  | 'today'
  | 'todos'
  | 'revenue'
  | 'activity'
  | 'companies'
  | 'people'
  | 'services'
  | 'engagements'
  | 'settings'
  | 'data'

export interface NavItem {
  readonly id: NavId
  readonly label: string
  /** The path a click on this nav item navigates to. Settings/Data resolve
   * under `/workspace` (X-01: nested routes, not top-level) even though the
   * rail still draws them as two independent buttons, exactly as the mockup
   * does. */
  readonly path: string
  readonly group: 'Work' | 'Records' | 'Workspace'
}

/** `.navgroup` order and membership, taken from the mockup's rail verbatim
 * (lines ~489-508) — Pipeline's `data-view="pipeline"` button omitted. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'today', label: 'Today', path: '/', group: 'Work' },
  { id: 'todos', label: 'Todos', path: '/todos', group: 'Work' },
  { id: 'revenue', label: 'Revenue', path: '/revenue', group: 'Work' },
  { id: 'activity', label: 'Activity', path: '/activity', group: 'Work' },
  { id: 'companies', label: 'Companies', path: '/companies', group: 'Records' },
  { id: 'people', label: 'People', path: '/people', group: 'Records' },
  { id: 'services', label: 'Catalogue', path: '/services', group: 'Records' },
  { id: 'engagements', label: 'Engagements', path: '/engagements', group: 'Records' },
  { id: 'settings', label: 'Settings', path: '/workspace/settings', group: 'Workspace' },
  { id: 'data', label: 'Data', path: '/workspace/data', group: 'Workspace' }
]

export interface RouteMeta {
  /** A `matchPath`-compatible pattern, relative to the router root. */
  readonly path: string
  /** Which nav item lights up while this route is active — a detail route
   * names its list-view parent, matching the mockup's own `go()`:
   * `const base = v==='company'?'companies':v==='person'?'people':v`. */
  readonly navId: NavId
  /** `.crumb` text, taken from the mockup's `crumbs` map in `go()`. */
  readonly breadcrumb: string
}

/** Every leaf route the shell resolves — the ten views plus the two detail
 * routes. `routes.tsx`'s `<Routes>` tree and this table are two hand-written
 * descriptions of the same set; `routes.test.tsx` checks they agree so the
 * two can't silently drift apart. */
export const ROUTE_META: readonly RouteMeta[] = [
  { path: '/', navId: 'today', breadcrumb: 'Today' },
  { path: '/todos', navId: 'todos', breadcrumb: 'Todos' },
  { path: '/revenue', navId: 'revenue', breadcrumb: 'Revenue' },
  { path: '/activity', navId: 'activity', breadcrumb: 'Activity' },
  { path: '/companies', navId: 'companies', breadcrumb: 'Companies' },
  { path: '/company/:id', navId: 'companies', breadcrumb: 'Companies /' },
  { path: '/people', navId: 'people', breadcrumb: 'People' },
  { path: '/person/:id', navId: 'people', breadcrumb: 'People /' },
  { path: '/services', navId: 'services', breadcrumb: 'Catalogue' },
  { path: '/engagements', navId: 'engagements', breadcrumb: 'Engagements' },
  { path: '/workspace/settings', navId: 'settings', breadcrumb: 'Workspace' },
  { path: '/workspace/data', navId: 'data', breadcrumb: 'Workspace / Data' }
]

/**
 * DOM id of one engagement's row on `/engagements` (T-260828-37).
 *
 * An engagement has no detail route of its own — ADR-005 made the list view
 * the only view of engagement state — so a command-palette result for one
 * navigates to `/engagements` with this id as the location hash and scrolls
 * to the row. It lives here, beside the route table, because it is the same
 * kind of fact: where a record is found in the UI. Both halves (the palette
 * building the hash, `Engagements.tsx` rendering the id) call this, so
 * neither can drift from the other.
 */
export function engagementAnchorId(id: string): string {
  return `engagement-${id}`
}

/**
 * Where the command palette lands for one search result (T-260828-37's
 * acceptance: one assertion per result kind). Here rather than in
 * `CommandPalette.tsx` because it is a statement about *routes*, made of the
 * same paths `ROUTE_META` above lists — and because a component file may not
 * export a non-component (`react-refresh/only-export-components`, the same
 * rule that split this whole module out of `routes.tsx`).
 *
 * Companies and people have their own detail routes. Engagements, todos and
 * activity notes do not — each lives inside its list view — so the target is
 * that list, with a hash naming the engagement's own row (see
 * `engagementAnchorId`) since that is the one the palette scrolls to.
 *
 * The catalogue is deliberately absent: `SEARCH_KINDS`
 * (`electron/shared/search.ts`) indexes five source tables and services is
 * not one of them, so there is no such result to route.
 */
export function targetForSearchResult(kind: SearchKind, id: string): To {
  switch (kind) {
    case 'company':
      return { pathname: `/company/${id}` }
    case 'person':
      return { pathname: `/person/${id}` }
    case 'engagement':
      return { pathname: '/engagements', hash: `#${engagementAnchorId(id)}` }
    case 'task':
      return { pathname: '/todos' }
    case 'activity':
      return { pathname: '/activity' }
  }
}

/** The nav item a route highlights — `undefined` for a pathname this table
 * doesn't know about (highlights nothing rather than guessing). */
export function getActiveNavId(pathname: string): NavId | undefined {
  return ROUTE_META.find((route) => matchPath({ path: route.path, end: true }, pathname) != null)?.navId
}

/** `.crumb` text for the topbar breadcrumb — falls back to the pathname
 * itself so an unmatched route is visibly wrong rather than silently blank. */
export function getBreadcrumb(pathname: string): string {
  return ROUTE_META.find((route) => matchPath({ path: route.path, end: true }, pathname) != null)?.breadcrumb ?? pathname
}
