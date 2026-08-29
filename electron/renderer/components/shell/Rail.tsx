import type { ReactElement } from 'react'
import { Link, useLocation } from 'react-router'
import { NAV_ITEMS, getActiveNavId, type NavId, type NavItem } from '../../nav'
import {
  ActivityIcon,
  CompaniesIcon,
  DataIcon,
  EngagementsIcon,
  OfferingsIcon,
  PeopleIcon,
  RevenueIcon,
  SettingsIcon,
  TodayIcon,
  TodosIcon,
  type ShellIconProps
} from './icons'
import { useQuery } from '@tanstack/react-query'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
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
  activity: ActivityIcon,
  companies: CompaniesIcon,
  people: PeopleIcon,
  offerings: OfferingsIcon,
  engagements: EngagementsIcon,
  settings: SettingsIcon,
  data: DataIcon
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
  const activeNavId = getActiveNavId(location.pathname)
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
          {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
            const Icon = NAV_ICONS[item.id]
            const isActive = item.id === activeNavId
            return (
              <Link
                key={item.id}
                to={item.path}
                className={isActive ? 'nav on' : 'nav'}
                aria-current={isActive ? 'page' : undefined}
                onClick={onNavigate}
              >
                <Icon className="ic" />
                {item.label}
                {/* Counts wire up as their entities arrive (P1-0x). A real 0
                    reads as "no companies"; an en dash reads as "not loaded
                    yet" and is marked aria-hidden so a screen reader doesn't
                    announce a stray dash as content — the nav item's own
                    label is its accessible name. */}
                {COUNT_BEARING_NAV_IDS.has(item.id) && (
                  <span className="count" aria-hidden="true">
                    –
                  </span>
                )}
              </Link>
            )
          })}
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
