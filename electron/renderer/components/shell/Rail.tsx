import type { ReactElement } from 'react'
import { Link, useLocation } from 'react-router'
import { NAV_ITEMS, getActiveNavId, type NavId, type NavItem } from '../../nav'
import {
  ActivityIcon,
  CatalogueIcon,
  CompaniesIcon,
  DataIcon,
  EngagementsIcon,
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
import './Rail.css'

const GROUPS: readonly NavItem['group'][] = ['Work', 'Records', 'Workspace']

/** Which nav items carry a `.count` slot in the mockup — Today, Revenue,
 * Activity and Settings have none (lines ~491-507); Todos, Companies,
 * People, Catalogue, Engagements and Data (`id="c-rows"`, easy to miss) all
 * do. */
const COUNT_BEARING_NAV_IDS: ReadonlySet<NavId> = new Set([
  'todos',
  'companies',
  'people',
  'services',
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
  services: CatalogueIcon,
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

  return (
    <aside className={open ? 'rail open' : 'rail'} id="rail">
      <div className="brand">
        <div className="mark">
          {/* assets/solocrm-mark.svg inlined — Solo CRM's own mark, the default a
              workspace shows before an operator supplies one (T-260829-07). Inline SVG
              on tokens is the rule (.claude/rules/ui-design.md); nothing in assets/ is
              reachable from the bundle. The asset's hex literals become the tokens they
              equal on the way in — tokens.css is the only place colour is spelled out.
              Decorative: the wordmark beside it already carries the name, so announcing
              it twice would be noise. */}
          <svg viewBox="0 0 112 112" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <defs>
              <radialGradient id="rail-mark-glow">
                <stop offset="0%" stopColor="var(--verdigris)" stopOpacity={0.2} />
                <stop offset="55%" stopColor="var(--verdigris)" stopOpacity={0.07} />
                <stop offset="100%" stopColor="var(--verdigris)" stopOpacity={0} />
              </radialGradient>
            </defs>
            <circle cx={56} cy={56} r={55.5} fill="var(--obsidian)" stroke="var(--border)" />
            <g transform="translate(56 56) scale(0.9167) translate(-48 -48)">
              <circle cx={48} cy={48} r={42} fill="url(#rail-mark-glow)" />
              <circle cx={48} cy={48} r={34} fill="none" stroke="var(--surface-3)" strokeWidth={5.5} />
              <circle
                cx={48}
                cy={48}
                r={34}
                fill="none"
                stroke="var(--verdigris)"
                strokeWidth={5.5}
                strokeLinecap="round"
                strokeDasharray="162.36 51.27"
                transform="rotate(-90 48 48)"
              />
              <path
                d="M50 36 C51.5 47 53 48.5 64 50 C53 51.5 51.5 53 50 64 C48.5 53 47 51.5 36 50 C47 48.5 48.5 47 50 36 Z"
                fill="var(--gold)"
                transform="translate(48 48) scale(1.55) translate(-50 -50)"
              />
            </g>
          </svg>
        </div>
        {/* assets/solocrm-wordmark.svg — the lockup's glyphs alone, on a viewBox
            tightened to their bounding box (109.5 39.5 183 33). solocrm-logo.svg itself
            is a 322×112 lockup whose glyphs occupy a corner of it; dropped into this
            104px slot as-is it would render mostly empty space, and therefore tiny.
            "Solo" carries no fill so it inherits `.wordmark`'s currentColor
            (--papyrus); "CRM" is the accent and names its token. */}
        <svg
          className="wordmark"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          role="img"
          aria-label="Solo CRM"
          viewBox="109.5 39.5 183 33"
        >
          <title>Solo CRM</title>
          <path d="M121.64 71.63L121.64 71.63Q118.21 71.63 115.69 70.55Q113.17 69.46 111.74 67.44Q110.32 65.42 110.17 62.63L110.17 62.63L114.87 62.63Q115.01 64.29 115.95 65.38Q116.88 66.46 118.38 67Q119.87 67.53 121.62 67.53L121.62 67.53Q123.57 67.53 125.07 66.93Q126.58 66.32 127.46 65.2Q128.34 64.09 128.34 62.61L128.34 62.61Q128.34 61.28 127.57 60.43Q126.81 59.57 125.5 59.01Q124.2 58.45 122.54 58.02L122.54 58.02L118.97 57.03Q115.22 56.03 113.12 54.06Q111.01 52.09 111.01 48.95L111.01 48.95Q111.01 46.31 112.44 44.33Q113.87 42.35 116.32 41.25Q118.77 40.15 121.84 40.15L121.84 40.15Q124.98 40.15 127.37 41.25Q129.76 42.35 131.12 44.25Q132.49 46.16 132.55 48.6L132.55 48.6L128 48.6Q127.77 46.51 126.06 45.36Q124.34 44.21 121.74 44.21L121.74 44.21Q119.89 44.21 118.53 44.79Q117.17 45.36 116.42 46.38Q115.67 47.39 115.67 48.68L115.67 48.68Q115.67 50.14 116.56 51.03Q117.45 51.92 118.74 52.45Q120.02 52.97 121.19 53.28L121.19 53.28L124.16 54.06Q125.62 54.43 127.16 55.05Q128.71 55.68 130.03 56.67Q131.34 57.67 132.15 59.13Q132.96 60.6 132.96 62.67L132.96 62.67Q132.96 65.25 131.63 67.29Q130.29 69.32 127.76 70.47Q125.23 71.63 121.64 71.63M146.63 71.59L146.63 71.59Q143.41 71.59 141 70.12Q138.59 68.64 137.26 65.97Q135.92 63.31 135.92 59.78L135.92 59.78Q135.92 56.21 137.26 53.53Q138.59 50.86 141 49.38Q143.41 47.91 146.63 47.91L146.63 47.91Q149.87 47.91 152.28 49.38Q154.69 50.86 156.02 53.53Q157.36 56.21 157.36 59.78L157.36 59.78Q157.36 63.31 156.02 65.97Q154.69 68.64 152.28 70.12Q149.87 71.59 146.63 71.59M146.63 67.78L146.63 67.78Q148.72 67.78 150.09 66.68Q151.45 65.58 152.12 63.77Q152.78 61.95 152.78 59.78L152.78 59.78Q152.78 57.58 152.12 55.75Q151.45 53.91 150.09 52.82Q148.72 51.72 146.63 51.72L146.63 51.72Q144.56 51.72 143.2 52.82Q141.85 53.91 141.18 55.74Q140.52 57.56 140.52 59.78L140.52 59.78Q140.52 61.95 141.18 63.77Q141.85 65.58 143.2 66.68Q144.56 67.78 146.63 67.78M161.18 40.56L165.69 40.56L165.69 71.12L161.18 71.12L161.18 40.56M180.23 71.59L180.23 71.59Q177.01 71.59 174.6 70.12Q172.19 68.64 170.86 65.97Q169.52 63.31 169.52 59.78L169.52 59.78Q169.52 56.21 170.86 53.53Q172.19 50.86 174.6 49.38Q177.01 47.91 180.23 47.91L180.23 47.91Q183.47 47.91 185.88 49.38Q188.29 50.86 189.62 53.53Q190.95 56.21 190.95 59.78L190.95 59.78Q190.95 63.31 189.62 65.97Q188.29 68.64 185.88 70.12Q183.47 71.59 180.23 71.59M180.23 67.78L180.23 67.78Q182.32 67.78 183.68 66.68Q185.05 65.58 185.71 63.77Q186.38 61.95 186.38 59.78L186.38 59.78Q186.38 57.58 185.71 55.75Q185.05 53.91 183.68 52.82Q182.32 51.72 180.23 51.72L180.23 51.72Q178.16 51.72 176.8 52.82Q175.45 53.91 174.78 55.74Q174.12 57.56 174.12 59.78L174.12 59.78Q174.12 61.95 174.78 63.77Q175.45 65.58 176.8 66.68Q178.16 67.78 180.23 67.78" />
          <path d="M217.4 71.53L217.4 71.53Q213.44 71.53 210.33 69.65Q207.21 67.78 205.42 64.26Q203.64 60.74 203.64 55.86L203.64 55.86Q203.64 50.96 205.42 47.44Q207.21 43.93 210.33 42.04Q213.44 40.15 217.4 40.15L217.4 40.15Q219.82 40.15 221.94 40.85Q224.07 41.55 225.74 42.88Q227.41 44.21 228.51 46.12Q229.6 48.03 229.99 50.45L229.99 50.45L225.3 50.45Q225.01 48.99 224.28 47.87Q223.55 46.76 222.51 45.98Q221.46 45.2 220.17 44.81Q218.88 44.42 217.44 44.42L217.44 44.42Q214.82 44.42 212.73 45.74Q210.65 47.06 209.46 49.62Q208.27 52.17 208.27 55.86L208.27 55.86Q208.27 59.55 209.48 62.11Q210.69 64.66 212.77 65.96Q214.84 67.26 217.44 67.26L217.44 67.26Q218.88 67.26 220.16 66.86Q221.44 66.46 222.5 65.7Q223.55 64.93 224.28 63.8Q225.01 62.67 225.3 61.24L225.3 61.24L230.01 61.24Q229.66 63.49 228.6 65.37Q227.53 67.24 225.87 68.64Q224.21 70.03 222.07 70.78Q219.92 71.53 217.4 71.53M239.01 71.12L234.33 71.12L234.33 40.56L245.28 40.56Q248.81 40.56 251.17 41.78Q253.53 43 254.7 45.18Q255.87 47.35 255.87 50.16L255.87 50.16Q255.87 52.99 254.69 55.11Q253.51 57.24 251.15 58.41Q248.79 59.57 245.24 59.57L245.24 59.57L237.02 59.57L237.02 55.58L244.79 55.58Q247.05 55.58 248.43 54.93Q249.82 54.28 250.47 53.07Q251.13 51.86 251.13 50.16L251.13 50.16Q251.13 48.44 250.47 47.19Q249.82 45.94 248.42 45.25Q247.03 44.56 244.75 44.56L244.75 44.56L239.01 44.56L239.01 71.12M257.01 71.12L251.7 71.12L244.3 57.32L249.49 57.32L257.01 71.12M264.92 71.12L260.37 71.12L260.37 40.56L267.26 40.56L273.93 58.1Q274.21 58.88 274.57 60.07Q274.93 61.26 275.32 62.65Q275.71 64.04 276.06 65.4Q276.41 66.75 276.67 67.84L276.67 67.84L275.69 67.84Q275.96 66.81 276.31 65.47Q276.65 64.13 277.04 62.73Q277.43 61.34 277.8 60.11Q278.17 58.88 278.46 58.1L278.46 58.1L285.02 40.56L291.95 40.56L291.95 71.12L287.3 71.12L287.3 54.67Q287.3 53.73 287.32 52.42Q287.34 51.1 287.37 49.64Q287.4 48.17 287.43 46.67Q287.46 45.18 287.48 43.8L287.48 43.8L287.83 43.8Q287.42 45.3 286.94 46.89Q286.46 48.48 286 49.96Q285.53 51.43 285.11 52.65Q284.69 53.87 284.41 54.67L284.41 54.67L278.15 71.12L274.15 71.12L267.81 54.67Q267.51 53.89 267.11 52.69Q266.71 51.49 266.24 50.03Q265.76 48.56 265.27 46.97Q264.78 45.38 264.29 43.8L264.29 43.8L264.7 43.8Q264.74 45.05 264.77 46.52Q264.8 47.99 264.83 49.48Q264.86 50.98 264.89 52.32Q264.92 53.67 264.92 54.67L264.92 54.67L264.92 71.12" fill="var(--verdigris)" />
        </svg>
      </div>
      <div className="rail-app">
        {/* The product name lived here as text while the rail wore another
            company's wordmark. The wordmark states it now, so only the version
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
