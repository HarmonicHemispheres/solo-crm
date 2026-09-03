import type { ReactElement } from 'react'
import { Link, useLocation } from 'react-router'
import {
  NAV_SUBGROUP_SETTING_KEY,
  getActiveNavId,
  getActiveNavSubgroupId,
  railRowsFor,
  type NavId,
  type NavItem,
  type NavSubgroup,
  type NavSubgroupId
} from '../../nav'
import {
  ActivityIcon,
  CompaniesIcon,
  DataIcon,
  EngagementsIcon,
  NavChevronIcon,
  OfferingsIcon,
  PeopleIcon,
  ReportsIcon,
  RevenueIcon,
  SettingsIcon,
  TimelineIcon,
  TodayIcon,
  TodosIcon,
  type ShellIconProps
} from './icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callCrm, ipcQueryFn, optimisticUpdate, unwrapMutationResult } from '../../lib/ipc'
import { invalidate, queryKeys } from '../../lib/query-keys'
import { SETTINGS_REGISTRY, type SettingsSnapshot } from '../../../shared/settings'
import { SoloCrmMark, SoloCrmWordmark } from './BrandMarks'
import './Rail.css'

const GROUPS: readonly NavItem['group'][] = ['Work', 'Records', 'Workspace']

/** Which nav items carry a `.count` slot in the mockup — Today, Revenue,
 * Activity and Settings have none (lines ~491-507); Todos, Companies,
 * People, Offerings, Engagements and Data (`id="c-rows"`, easy to miss) all
 * do. */
const COUNT_BEARING_NAV_IDS: ReadonlySet<NavId> = new Set([
  'todos',
  'companies',
  'people',
  'offerings',
  'engagements',
  'data'
])

/** One glyph per `NavId`, in `NAV_ITEMS`'s own order. Kept local (not
 * exported from icons.tsx) since a lookup object mixed in with that file's
 * component exports would trip `react-refresh/only-export-components`. */
const NAV_ICONS: Record<NavId, (props: ShellIconProps) => ReactElement> = {
  today: TodayIcon,
  todos: TodosIcon,
  revenue: RevenueIcon,
  timeline: TimelineIcon,
  activity: ActivityIcon,
  companies: CompaniesIcon,
  people: PeopleIcon,
  offerings: OfferingsIcon,
  engagements: EngagementsIcon,
  settings: SettingsIcon,
  data: DataIcon
}

/** One glyph per subgroup header, the same shape `NAV_ICONS` has. */
const NAV_SUBGROUP_ICONS: Record<NavSubgroupId, (props: ShellIconProps) => ReactElement> = {
  reports: ReportsIcon
}

export interface RailProps {
  /** Off-canvas open state below 900px — always `true`'s visual effect
   * above that width via CSS (Rail.css only reads this class inside the
   * `max-width:900px` media query). */
  open: boolean
  /** Called after a nav item navigates, so the off-canvas rail closes
   * itself on mobile — the mockup's `go()` does this unconditionally
   * (`$('#rail').classList.remove('open')`), harmless above 900px since the
   * class has no effect there. */
  onNavigate: () => void
}

/**
 * `<aside class="rail">` from the mockup — brand mark, the three nav groups
 * (Work · Records · Workspace, Pipeline dropped per ADR-005), and the
 * database chip. The active nav item is derived from the route, including a
 * detail route highlighting its list-view parent (`getActiveNavId`).
 */
export function Rail({ open, onNavigate }: RailProps) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const activeNavId = getActiveNavId(location.pathname)
  const activeSubgroupId = getActiveNavSubgroupId(location.pathname)
  // The chip reads the running app's version over `app:version`
  // (main/ipc/registry.ts) rather than restating a number that has already
  // drifted once — it read v0.1 while package.json said 0.2.0. Until the
  // query answers, the chip shows the `local` claim on its own: a wrong
  // version shown for a frame is worse than a right one shown a frame late.
  const { data: appVersion } = useQuery({
    queryKey: queryKeys.app.version(),
    queryFn: ipcQueryFn('app:version')
  })
  const versionLabel = appVersion ? `v${appVersion.version} · local` : 'local'

  // The operator's own mark and wordmark (T-260829-07), read on the key
  // WorkspaceSettings.tsx uses too. `queryKeys.branding.current()` appearing in
  // both files is what makes opening Settings reuse this cache entry rather
  // than issue a second `branding:get` — the same sharing Shell.tsx and
  // WorkspaceSettings.tsx already have on `queryKeys.settings.list()`.
  const { data: branding } = useQuery({
    queryKey: queryKeys.branding.current(),
    queryFn: ipcQueryFn('branding:get')
  })
  const icon = branding?.icon
  const logo = branding?.logo

  // The brand block's accessible name. On `queryKeys.settings.list()`, the key
  // ShellLayout above this already holds, so it costs no extra request — and an
  // empty `workspace.name` (the default) falls back to the product's own name
  // rather than leaving an image with no name at all.
  const { data: settings } = useQuery({
    queryKey: queryKeys.settings.list(),
    queryFn: ipcQueryFn('settings:getAll')
  })
  const brandName = settings?.['workspace.name'].trim() || 'Solo CRM'

  /**
   * A subgroup's expanded state, read off the snapshot above rather than
   * through a second `settings:get` — this component already holds
   * `queryKeys.settings.list()`, so the state costs no extra round trip.
   *
   * While the snapshot is in flight the registry's own default answers, so a
   * cold start never paints a group shut and then flicks it open. On a
   * machine where the operator has collapsed it, the flash goes the other
   * way for one frame; that is the trade, and it falls on the less common
   * case.
   */
  function isExpanded(id: NavSubgroupId): boolean {
    const key = NAV_SUBGROUP_SETTING_KEY[id]
    const stored = settings?.[key]
    return typeof stored === 'boolean' ? stored : (SETTINGS_REGISTRY[key].default as boolean)
  }

  /**
   * Writes the new state onto the snapshot before the round trip so the group
   * opens on the click rather than on the reply. Through `optimisticUpdate`,
   * which snapshots and rolls back on failure — T-260901-28's rule, and the
   * reason a bare `setQueryData` is not enough: a failed `settings:set` would
   * otherwise leave the rail claiming a state main never stored.
   */
  const setSubgroupExpanded = useMutation({
    mutationFn: ({ id, expanded }: { id: NavSubgroupId; expanded: boolean }) =>
      callCrm('settings:set', { key: NAV_SUBGROUP_SETTING_KEY[id], value: expanded }).then(unwrapMutationResult),
    // `SettingsSnapshot | undefined`, not `SettingsSnapshot`: a click can land
    // while `settings:getAll` is still in flight, and there is no half a
    // snapshot to patch. Leaving the cache untouched in that window is right —
    // `invalidate.settings` on settle reconciles it against what main stored.
    ...optimisticUpdate<SettingsSnapshot | undefined, { id: NavSubgroupId; expanded: boolean }>(
      queryClient,
      queryKeys.settings.list(),
      (current, { id, expanded }) => (current === undefined ? undefined : { ...current, [NAV_SUBGROUP_SETTING_KEY[id]]: expanded }),
      invalidate.settings
    )
  })

  return (
    <aside className={open ? 'rail open' : 'rail'} id="rail">
      {/* The block is one image as far as assistive technology is concerned, and
          it is named from `workspace.name` rather than from the product: once an
          operator supplies their own mark and wordmark, a hard-coded "Solo CRM"
          would be announcing something that is no longer drawn here
          (T-260829-07). Both children are therefore decorative — the built-in
          SVGs are `aria-hidden`, an operator's image is `alt=""`. */}
      <div className="brand" role="img" aria-label={brandName}>
        <div className="mark">
          {/* `absent` is an answer, not a pending read
              (electron/shared/branding.ts) — and so is the `undefined` this
              sees while `branding:get` is still in flight. Both draw the
              built-in default, so the first paint is never a blank box, and
              nothing moves when a custom image arrives: `.mark` and
              `.wordmark` are fixed in both dimensions and the image is
              letterboxed into them (Rail.css). */}
          {icon?.state === 'present' ? <img src={icon.dataUrl} alt="" /> : <SoloCrmMark gradientId="rail-mark-glow" />}
        </div>
        {logo?.state === 'present' ? (
          <img className="wordmark" src={logo.dataUrl} alt="" />
        ) : (
          <SoloCrmWordmark className="wordmark" />
        )}
      </div>
      <div className="rail-app">
        {/* The product name lived here as text while the rail wore another
            company's wordmark. The brand block above states it now — from
            `workspace.name` once there is one — so only the version
            chip remains — and `local` with it, which is a real claim about where
            the data lives, not decoration. */}
        <span className="ver">{versionLabel}</span>
      </div>

      {GROUPS.map((group) => (
        <nav className="navgroup" key={group}>
          <div className="lbl">{group}</div>
          {railRowsFor(group).map((row) =>
            row.kind === 'item' ? (
              <NavRow key={row.item.id} item={row.item} activeNavId={activeNavId} onNavigate={onNavigate} />
            ) : (
              <NavSubgroupRow
                key={row.subgroup.id}
                subgroup={row.subgroup}
                items={row.items}
                expanded={isExpanded(row.subgroup.id)}
                holdsActiveItem={row.subgroup.id === activeSubgroupId}
                activeNavId={activeNavId}
                onNavigate={onNavigate}
                onToggle={(expanded) => setSubgroupExpanded.mutate({ id: row.subgroup.id, expanded })}
              />
            )
          )}
        </nav>
      ))}

      <div className="rail-foot">
        <Link to="/workspace/data" className="dbchip dbchip-link">
          <span className="dot" />
          solocrm.db
        </Link>
      </div>
    </aside>
  )
}

/** One `.nav` row — a real `<a>`, so Tab reaches it and Enter activates it
 * by native anchor semantics rather than a keydown handler. `nested` only
 * changes the indent (Rail.css); the markup is identical either way. */
function NavRow({
  item,
  activeNavId,
  onNavigate,
  nested = false
}: {
  item: NavItem
  activeNavId: NavId | undefined
  onNavigate: () => void
  nested?: boolean
}) {
  const Icon = NAV_ICONS[item.id]
  const isActive = item.id === activeNavId
  return (
    <Link
      to={item.path}
      className={`nav${isActive ? ' on' : ''}${nested ? ' nav-nested' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
    >
      <Icon className="ic" />
      {item.label}
      {/* Counts wire up as their entities arrive (P1-0x). A real 0 reads as
          "no companies"; an en dash reads as "not loaded yet" and is marked
          aria-hidden so a screen reader doesn't announce a stray dash as
          content — the nav item's own label is its accessible name. */}
      {COUNT_BEARING_NAV_IDS.has(item.id) && (
        <span className="count" aria-hidden="true">
          –
        </span>
      )}
    </Link>
  )
}

/**
 * A subgroup header and the rows under it (T-260902-13).
 *
 * The header is a `<button aria-expanded>` controlling the list by id — the
 * standard disclosure pattern — and never a link, because it has no route:
 * `NavSubgroup` deliberately carries no path (nav.ts). `aria-controls` is set
 * only while expanded: the children are unmounted when collapsed, so naming
 * the id there would be a dangling reference, and `aria-expanded` alone is
 * the honest state in that half of the cycle.
 *
 * **A collapsed group still says where you are.** When the active route is
 * one of its children, the header takes `.on` and `aria-current="true"`
 * (`"true"` rather than `"page"`: the header is not itself the page). The
 * alternative — forcing the group open whenever a child is active — makes
 * the collapse control do nothing at all while you are standing on Revenue,
 * which is exactly when an operator reaches for it.
 */
function NavSubgroupRow({
  subgroup,
  items,
  expanded,
  holdsActiveItem,
  activeNavId,
  onNavigate,
  onToggle
}: {
  subgroup: NavSubgroup
  items: readonly NavItem[]
  expanded: boolean
  holdsActiveItem: boolean
  activeNavId: NavId | undefined
  onNavigate: () => void
  onToggle: (expanded: boolean) => void
}) {
  const Icon = NAV_SUBGROUP_ICONS[subgroup.id]
  const listId = `nav-subgroup-${subgroup.id}`
  const marksActive = holdsActiveItem && !expanded
  return (
    <>
      <button
        type="button"
        className={`nav nav-subgroup${marksActive ? ' on' : ''}`}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-current={marksActive ? 'true' : undefined}
        onClick={() => onToggle(!expanded)}
      >
        <Icon className="ic" />
        {subgroup.label}
        <NavChevronIcon className="chev" />
      </button>
      {/* Rendered only when expanded, rather than hidden with CSS: an
          off-screen link is still a Tab stop, which is the same trap the
          off-canvas rail had to fix with `visibility: hidden` (Rail.css). */}
      {expanded && (
        <div className="nav-children" id={listId}>
          {items.map((item) => (
            <NavRow key={item.id} item={item} activeNavId={activeNavId} onNavigate={onNavigate} nested />
          ))}
        </div>
      )}
    </>
  )
}
