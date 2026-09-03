/*
 * Inline SVG glyphs used only by the shell — the rail's nav icons, the New
 * menu's item icons, and the topbar's search/menu-toggle icons. `icons.tsx`
 * at the top of `components/` is deliberately scoped to glyphs a *primitive*
 * renders itself (see that file's header comment); nav/view glyphs are each
 * consumer's own concern, and the shell is this file's consumer. Every path
 * below is copied verbatim from the mockup's own `<svg>` markup so the shell
 * matches the authoritative visual spec exactly.
 *
 * Each icon is its own named function component (not built from a shared
 * factory) — `react-refresh/only-export-components` can't verify a
 * factory's return value is a component, and this file exports nothing but
 * components on purpose.
 */
import type { SVGProps } from 'react'

export type ShellIconProps = SVGProps<SVGSVGElement>

const DEFAULT_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

export function TodayIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 8v4l2.5 1.8" />
    </svg>
  )
}

export function TodosIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M4 7l2 2 3.5-3.5M4 17l2 2 3.5-3.5M13 7h7M13 17h7" />
    </svg>
  )
}

export function RevenueIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4" />
    </svg>
  )
}

export function ActivityIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  )
}

export function CompaniesIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M4 21V6l7-3v18M11 21h9V10l-9-3" />
      <path d="M15 11.5v.01M15 15.5v.01" />
    </svg>
  )
}

export function PeopleIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <circle cx={9} cy={8} r={3.2} />
      <path d="M3.5 20c.6-3.4 2.9-5.2 5.5-5.2s4.9 1.8 5.5 5.2M16 5.4a3.2 3.2 0 010 5.7M18.2 20c-.2-2-.8-3.6-1.8-4.7" />
    </svg>
  )
}

export function OfferingsIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M12 3l2.4 5.3 5.6.6-4.2 3.9 1.2 5.6L12 15.6 6.9 18.4l1.2-5.6L4 8.9l5.6-.6z" />
    </svg>
  )
}

export function EngagementsIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <rect x={3} y={7} width={18} height={13} rx={2} />
      <path d="M8 7V5.6A1.6 1.6 0 019.6 4h4.8A1.6 1.6 0 0116 5.6V7" />
    </svg>
  )
}

export function SettingsIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <circle cx={12} cy={12} r={3.2} />
      <path d="M19.4 14.5a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2v.2a2 2 0 11-4 0v-.1a1.7 1.7 0 00-3-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-3l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V3a2 2 0 114 0v.1a1.7 1.7 0 003 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  )
}

export function DataIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <ellipse cx={12} cy={6} rx={8} ry={3} />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  )
}

/**
 * The engagement timeline's glyph (T-260902-16, P3-12). Three bars of
 * different lengths at different offsets — the shape the page itself draws,
 * which is what tells it apart from `RevenueIcon`'s bars rising from a
 * shared baseline. The mockup has no rail item for this view and so no glyph
 * to copy.
 */
export function TimelineIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M3 7h10M7 12h13M3 17h8" />
    </svg>
  )
}

/**
 * The Reports subgroup header's glyph (T-260902-13). The mockup has no
 * subgroups and so no glyph to copy — this is a sheet with two ruled lines,
 * deliberately *not* the bar chart `RevenueIcon` draws: the header and the
 * Revenue item under it sit two rows apart and repeating the bars there
 * would read as the same destination twice.
 */
export function ReportsIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9.5 13h5M9.5 17h5" />
    </svg>
  )
}

/**
 * The subgroup header's disclosure caret, pointing right when collapsed. The
 * rail rotates it to point down when expanded (Rail.css) rather than swapping
 * glyphs, so `prefers-reduced-motion` can drop the rotation's transition and
 * still leave the two states distinguishable.
 */
export function NavChevronIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M9.5 6l6 6-6 6" />
    </svg>
  )
}

/** `.searchbtn`'s magnifier — drawn thinner (1.8) and smaller than the nav
 * glyphs in the mockup. */
export function SearchIcon(props: ShellIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true" {...props}>
      <circle cx={11} cy={11} r={7} />
      <path d="M20 20l-4-4" />
    </svg>
  )
}

/** `.menutoggle`'s hamburger — visible only below 900px (Topbar.css). */
export function MenuToggleIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

/** The New menu's "Company" item glyph — the mockup redraws Companies'
 * outline path without the second decorative window path for the menu. */
export function NewCompanyIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M4 21V6l7-3v18M11 21h9V10l-9-3" />
    </svg>
  )
}

/** The New menu's "Person" item glyph — distinct from `PeopleIcon` (a single
 * head, not the pair the rail draws for "People"), matching the mockup. */
export function NewPersonIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <circle cx={12} cy={8} r={3.4} />
      <path d="M5 20c.7-3.8 3.5-5.6 7-5.6s6.3 1.8 7 5.6" />
    </svg>
  )
}

/** The New menu's "Engagement" item glyph — same outline as the rail's
 * Engagements nav icon (the mockup reuses the box+lid path in both places). */
export function NewEngagementIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <rect x={3} y={7} width={18} height={13} rx={2} />
      <path d="M8 7V5.6A1.6 1.6 0 019.6 4h4.8A1.6 1.6 0 0116 5.6V7" />
    </svg>
  )
}

/** The New menu's "Touch" item glyph — a pen, matching the mockup's log entry. */
export function TouchIcon(props: ShellIconProps) {
  return (
    <svg {...DEFAULT_PROPS} {...props}>
      <path d="M4 19l1-4 10-10 3 3L8 18z" />
    </svg>
  )
}
