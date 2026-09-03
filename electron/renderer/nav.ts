import { matchPath, type To } from 'react-router'
import type { SearchKind } from '../shared/search'
import type { SettingKey } from '../shared/settings'

/**
 * The ten views the mockup ships, minus Pipeline (ADR-005, T-260828-02), plus
 * the engagement timeline the mockup draws as a toggle on Engagements and
 * this app gives its own route (T-260902-16, P3-12) — the rail's three nav
 * groups. `id` matches the mockup's own `data-view` values so this table
 * reads against the mockup 1:1, `timeline` excepted: the mockup has no
 * `data-view` for it.
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
  | 'timeline'
  | 'activity'
  | 'companies'
  | 'people'
  | 'offerings'
  | 'engagements'
  | 'settings'
  | 'data'

/**
 * A rail row that is a header over other rows rather than a destination of
 * its own (T-260902-13). Clicking it expands and collapses; it has no route,
 * which is why it is a separate vocabulary from `NavId` rather than an
 * eleventh member of it — `ROUTE_META`, `getActiveNavId` and
 * `routes.test.tsx` all assume a `NavId` resolves to a page, and a
 * pathless member would be a special case in each.
 */
export type NavSubgroupId = 'reports'

export interface NavItem {
  readonly id: NavId
  readonly label: string
  /** The path a click on this nav item navigates to. Settings/Data resolve
   * under `/workspace` (X-01: nested routes, not top-level) even though the
   * rail still draws them as two independent buttons, exactly as the mockup
   * does. */
  readonly path: string
  readonly group: 'Work' | 'Records' | 'Workspace'
  /** When set, the rail draws this item nested under that subgroup's header
   * instead of at the top level of `group`. */
  readonly parent?: NavSubgroupId
}

export interface NavSubgroup {
  readonly id: NavSubgroupId
  readonly label: string
  readonly group: NavItem['group']
}

/**
 * The subgroup headers, one row each. A subgroup takes the position of its
 * first member in `NAV_ITEMS` (see `railRowsFor`), so ordering lives in one
 * table rather than two.
 *
 * Reports exists because Revenue is one report and the engagement timeline
 * (P3-12) is the second. A flat item named after one of them has nowhere to
 * put the other.
 */
export const NAV_SUBGROUPS: readonly NavSubgroup[] = [{ id: 'reports', label: 'Reports', group: 'Work' }]

/**
 * Which `settings` key holds a subgroup's expanded state — the same shape
 * `CADENCE_SETTING_KEY` uses in `shared/settings.ts`, and for the same
 * reason: ADR-002 rule 3 calls a key composed at a call site a defect, and a
 * literal map lets `tsc` prove each value is a real `SettingKey`.
 *
 * `as const satisfies`, not an annotation: `settings:set`'s payload is a
 * discriminated union over the key, so a lookup widened to all of
 * `SettingKey` would make `{ key, value: boolean }` unassignable. This keeps
 * each entry's literal type while still failing the build if one names a key
 * the registry does not declare.
 */
export const NAV_SUBGROUP_SETTING_KEY = {
  reports: 'nav.reportsExpanded'
} as const satisfies Record<NavSubgroupId, SettingKey>

/** `.navgroup` order and membership, taken from the mockup's rail verbatim
 * (lines ~489-508) — Pipeline's `data-view="pipeline"` button omitted, and
 * Revenue nested under Reports since T-260902-13. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'today', label: 'Today', path: '/', group: 'Work' },
  { id: 'todos', label: 'Todos', path: '/todos', group: 'Work' },
  { id: 'revenue', label: 'Revenue', path: '/revenue', group: 'Work', parent: 'reports' },
  { id: 'timeline', label: 'Timeline', path: '/timeline', group: 'Work', parent: 'reports' },
  { id: 'activity', label: 'Activity', path: '/activity', group: 'Work' },
  { id: 'companies', label: 'Companies', path: '/companies', group: 'Records' },
  { id: 'people', label: 'People', path: '/people', group: 'Records' },
  { id: 'offerings', label: 'Offerings', path: '/offerings', group: 'Records' },
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
  // 'Reports / Revenue', the way '/workspace/data' reads 'Workspace / Data':
  // the crumb names the rail group the route sits in, not only the page.
  { path: '/revenue', navId: 'revenue', breadcrumb: 'Reports / Revenue' },
  { path: '/timeline', navId: 'timeline', breadcrumb: 'Reports / Timeline' },
  { path: '/activity', navId: 'activity', breadcrumb: 'Activity' },
  { path: '/companies', navId: 'companies', breadcrumb: 'Companies' },
  { path: '/company/:id', navId: 'companies', breadcrumb: 'Companies /' },
  { path: '/people', navId: 'people', breadcrumb: 'People' },
  { path: '/person/:id', navId: 'people', breadcrumb: 'People /' },
  { path: '/offerings', navId: 'offerings', breadcrumb: 'Offerings' },
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
 * Offerings is deliberately absent: `SEARCH_KINDS`
 * (`electron/shared/search.ts`) indexes five source tables — companies,
 * people, engagements, tasks and activity — and `offerings` is not one of
 * them, so there is no such result to route. That absence is also why
 * T-260829-10's rename needed no search-index rebuild: no kind code moved.
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

/** The subgroup the active route sits inside, or `undefined` when it sits at
 * the top level. The rail uses it to mark a collapsed Reports header as
 * active — a collapsed group still has to say "you are in here". */
export function getActiveNavSubgroupId(pathname: string): NavSubgroupId | undefined {
  const activeNavId = getActiveNavId(pathname)
  return NAV_ITEMS.find((item) => item.id === activeNavId)?.parent
}

/** One row of one `.navgroup`, in render order: either a plain nav item or a
 * subgroup header with the items nested under it. */
export type RailRow = { readonly kind: 'item'; readonly item: NavItem } | { readonly kind: 'subgroup'; readonly subgroup: NavSubgroup; readonly items: readonly NavItem[] }

/**
 * The rows of one nav group, in `NAV_ITEMS`' own order, with each subgroup
 * emitted at the position of its first member. Here rather than in `Rail.tsx`
 * so the ordering rule is one testable function instead of nested `filter`
 * calls inside JSX — and so `Rail.tsx` stays a component file, which under
 * `react-refresh/only-export-components` may not export this anyway.
 *
 * A subgroup with no members is not drawn: a header that expands to nothing
 * is worse than an absent one.
 */
export function railRowsFor(group: NavItem['group']): readonly RailRow[] {
  const rows: RailRow[] = []
  const emitted = new Set<NavSubgroupId>()
  for (const item of NAV_ITEMS) {
    if (item.group !== group) continue
    if (item.parent === undefined) {
      rows.push({ kind: 'item', item })
      continue
    }
    if (emitted.has(item.parent)) continue
    const subgroup = NAV_SUBGROUPS.find((candidate) => candidate.id === item.parent)
    if (subgroup === undefined) {
      // A `parent` naming no declared subgroup would otherwise drop the item
      // out of the rail entirely — silently, which is the failure mode this
      // whole module's two-table check exists to prevent. Draw it flat.
      rows.push({ kind: 'item', item })
      continue
    }
    emitted.add(item.parent)
    rows.push({ kind: 'subgroup', subgroup, items: NAV_ITEMS.filter((member) => member.parent === subgroup.id) })
  }
  return rows
}
