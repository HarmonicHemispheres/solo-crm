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

  return (
    <aside className={open ? 'rail open' : 'rail'} id="rail">
      <div className="brand">
        <div className="mark">
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="MagicPill Labs">
            <rect
              x={15}
              y={33}
              width={70}
              height={34}
              rx={17}
              transform="rotate(-45 50 50)"
              stroke="var(--verdigris)"
              strokeWidth={5}
            />
            <path
              d="M50 33 H68 A17 17 0 0 1 68 67 H50"
              transform="rotate(-45 50 50)"
              fill="none"
              stroke="var(--gold)"
              strokeWidth={5}
              strokeLinecap="round"
            />
            <path
              d="M50 36 C51.5 47 53 48.5 64 50 C53 51.5 51.5 53 50 64 C48.5 53 47 51.5 36 50 C47 48.5 48.5 47 50 36 Z"
              fill="var(--gold)"
            />
          </svg>
        </div>
        <svg
          className="wordmark"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          aria-label="MagicPill Labs"
          viewBox="80 307 1879 550"
        >
          <title>MagicPill Labs</title>
          <g id="wordmark">
            <path d="M100 482.7v156h70.6l.3-79.6.4-79.6 34 63.9 34.1 64 16.8.4c16.4.3 17.1.3 18.8-2.7a4790 4790 0 0 0 34.3-65.7c17.9-34.5 32.9-63.2 33.5-64s1.2 34.7 1.2 81.1v82.3h70.6V493.7c0-79.7-.4-149.9-.9-156l-.8-10.9h-61.8l-20.4 39.6-41.6 80.4-26.1 50.3a69 69 0 0 1-5.2 9.2c-.1-.1-21.6-40.4-47.6-89.6l-47.3-89.2-31.3-.4-31.5-.3v156zm905.1-154.6c-22.1 3.2-37.2 20.9-35.3 41.3q1.8 21.6 23.6 31.7c6.3 2.9 9.2 3.5 20.7 3.5s14.3-.4 20.7-3.5c15.6-7.3 22.9-17.7 23.7-34 .9-15.6-6.3-27.6-20.9-35.2a90 90 0 0 0-24.1-5.2l-8.3 1.3zm337.6 154.6v156l38.4-.3 38.3-.4.4-40.4.3-40.3h24.4c44.3 0 65.3-3.7 88.1-15.7a83 83 0 0 0 22.7-17.1 97 97 0 0 0 29.1-55.2c3.5-16.7 2.8-46.1-1.3-61.3a104 104 0 0 0-77.5-76c-16-4.1-37.7-5.3-102.4-5.3h-60.4zm141.5-85.6a39 39 0 0 1 21.1 20.1c3.1 6.7 3.5 9.1 3.5 22.1 0 12.5-.4 15.7-3.1 21.5a40 40 0 0 1-19.6 19.5c-6.3 2.8-8.7 3.1-36.3 3.5l-29.7.4v-91.1l28.4.5c25.2.5 29.1.9 35.7 3.5m166.2-69c-21.9 3.1-37.2 21.1-35.3 41.2a36 36 0 0 0 22 30.9c8.3 4.1 9.9 4.4 22.3 4.4 11.6 0 14.3-.4 20.7-3.5 15.5-7.2 22.8-17.7 23.7-33.6 1.6-26.5-21.9-43.9-53.3-39.5zm92.3 154.6v156h73.4v-312h-73.4zm122.6 0v156h73.4v-312h-73.4zM529.5 426.8a202 202 0 0 0-37.2 8.7c-10.4 3.5-27.6 11.6-28.9 13.7-.7 1.3 22.7 49.5 24 49.5a112 112 0 0 1 46.2-16.4c18.7-2.4 36.1 1.3 45.6 9.5A41 41 0 0 1 588 511v3.7h-27.1c-39.6 0-56.8 2.5-75.2 11.3a53 53 0 0 0-31.5 42.9c-4.9 33.7 17.3 62.8 53.9 70.5 15.1 3.2 42.9 2 54.7-2.4a58 58 0 0 0 26-18.5l3.9-5.6.4 12.8.4 12.9 34.3-.3 34.3-.4.4-56c.4-59.2-.7-80.9-4.9-95.6-11.6-40.4-47.3-61.5-103.5-60.9-8.8.1-19.9.7-24.5 1.3zM588 562.5c0 11.2-1.1 14.4-7.3 21.2a37 37 0 0 1-28 11.3c-17.6.1-27.3-7.3-27.3-20.8q0-11.3 8.3-16.3c6.8-3.9 10.4-4.4 32.8-4.5l21.6-.1v9.2zm191.3-135.2a99 99 0 0 0-77.6 72.7 145 145 0 0 0 0 53.3 99 99 0 0 0 50.9 62.7 98 98 0 0 0 48.7 10.9c24.7.1 40-4.7 55.6-17.3l7.5-6.1-.8 10c-2 23.7-10.3 36-28.7 42.9-6.7 2.5-10.3 2.9-28.3 2.8a102 102 0 0 1-31.3-2.9 136 136 0 0 1-34.1-15.1c-2.3-1.6-4.3-2.7-4.5-2.4-.8.9-26 49.9-26 50.5a94 94 0 0 0 21.6 12.5c10.5 4.7 28.5 9.6 44.4 12.3a299 299 0 0 0 68.7.7q64.3-11.4 83.5-62.4c7.7-20.5 7.6-18 8.1-126.8l.5-100.3H868l-.1 12.3v13.3c.3 2.3-1.9.8-9.3-6.3a71 71 0 0 0-34.8-17.2 135 135 0 0 0-44.4-.1zm62.4 61.7c8.8 4.4 14 9.6 19.1 18.9 2 3.7 2.5 7.5 2.5 18 0 11.6-.4 14.1-3.3 19.7-8.5 16.8-28.5 25.9-49.5 22.4a42 42 0 0 1-25.2-12.1 36 36 0 0 1-11.7-27.3c-.7-13.5 2.5-22.8 10.7-31.1 10-10.4 19.3-13.7 36.5-13.2 10.5.3 13.3.9 20.9 4.7m135.6 43v106.7h73.4V425.3h-73.4zm209.5-104.5a112 112 0 0 0-64.8 33.1c-20 20.3-28.7 42.4-28.7 73.3 0 63.1 49.1 107.3 118.8 107.5 35.5 0 59.1-8.5 79.2-28.7 10.8-10.7 20.8-26.4 18.5-28.7-1.7-1.7-53.2-28-54.8-28-.7 0-1.9 1.3-2.7 2.9a61 61 0 0 1-19.6 19.7c-17.9 8.5-41.6 4.3-53.7-10a57 57 0 0 1-11.1-44.4c3.5-24.4 18.7-38.8 42-40q26.3-1.4 40.5 20.9l4.3 6.5 27.6-14.1 28.3-14.5c.3-.3-1.5-4.5-4-9.5a94 94 0 0 0-51.6-41.7 151 151 0 0 0-68.3-4.4zM1622.7 532v106.7h73.4V425.3h-73.4z" />
          </g>
          <g id="labs">
            <path d="M1869.3 668.8c-18.7 3.1-30 7.9-38.1 16.1-15.6 15.6-15.3 44.7.5 57.7 7.9 6.5 16.5 10.1 44.3 18.1 14.3 4.1 28.1 8.5 30.8 9.9 19.9 10.1 19.1 35.2-1.5 45.6-19.6 10-57.7 5.5-76.7-9.1l-6.4-4.5c-.3 0-1.9 2.9-3.6 6.5l-3.1 6.7 3.9 3.3a90 90 0 0 0 30.8 14.3c20.1 5.5 49.5 3.5 64.8-4.3a43 43 0 0 0 21.9-49.3c-4.8-16.5-16.5-23.9-55.6-34.7-27.3-7.6-32-9.6-38.3-16.1-10.3-10.7-6.8-30.1 6.8-38.5a56 56 0 0 1 29.6-6.7c14 0 25.6 2.5 37.1 8.3 4.4 2.1 8.3 3.9 8.8 3.9s2.3-2.9 3.7-6.7l2.8-6.7-9.6-4.7c-5.3-2.5-13.6-5.5-18.3-6.5-9.2-2.1-29.1-3.6-34.7-2.7zm-526.6 83.9V836h110.6v-16h-93.4V669.4h-17.4v83.3zm186.8-77.1c-8.3 17.2-72.1 157.7-72.1 158.9 0 .9 3.5 1.5 8.5 1.5h8.4l10-22.4 10.1-22.3h92.4l9.9 22 9.9 22 8.7.4q8.8.4 8.8-1.1c0-1.2-62.4-138.7-72.8-160.4-2.4-4.9-2.4-4.9-10.5-4.9h-8.1l-3.1 6.3zm31.2 57.1c10 22.7 18.7 42.1 18.9 42.9.5 1.3-7.7 1.7-38.8 1.7a515 515 0 0 1-39.5-.8c0-.5 7.3-17.2 16.3-37.1l19.3-43.3c1.7-4 3.7-6.7 4.3-6s9.3 19.7 19.5 42.5zm92-61.8c-.4.9-.5 38.3-.4 83.1l.4 81.3 45.3-.1c48.4 0 55.6-.7 68.5-6.5 20.1-9.2 28.8-29.9 22-52.7a39 39 0 0 0-23.6-23.3l-7.6-2.5 4.3-2.3a44 44 0 0 0 17.2-18.1c2.5-5.2 3.2-8.4 3.1-17.1-.3-13.3-3.5-20.9-12.7-29.2-12.9-11.6-27.1-14.1-80.9-14.1-26.8 0-35.2.4-35.6 1.6zm92.8 16.8c8 3.2 14.8 9.3 17.2 15.6 2.5 6.7 2 18.3-1.2 24.5a33 33 0 0 1-21.6 14.7c-3.7.8-20.8 1.5-37.9 1.5h-31.3v-60.2l33.7.5c30.8.5 34.3.8 41.1 3.5zm8 74.7q21.8 8.6 19.5 31.6a24 24 0 0 1-12.3 20c-10 5.9-20.8 7.3-56.9 7.3h-33.1v-63l37.7.5c34.9.5 38.1.8 45.1 3.5z" />
          </g>
        </svg>
      </div>
      <div className="rail-app">
        <span className="name">Solo CRM</span>
        <span className="ver">v0.1 · local</span>
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
