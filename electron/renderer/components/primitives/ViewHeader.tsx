import { type CSSProperties, type ReactNode } from 'react'
import { InfoPopover } from './InfoPopover'
import './ViewHeader.css'

/** `--c` isn't part of the standard style-object typing. */
type StyleWithAccent = CSSProperties & { '--c': string }

export interface ViewHeaderProps {
  /** The view's icon, as an inline `<svg>` (see components/icons.tsx or a
   * view-local icon — nav/view glyphs are per-view, not part of this
   * shared set). Drawn on `--c`, this header's accent colour. */
  icon: ReactNode
  /** A token reference (e.g. `"var(--verdigris)"`), not a literal colour —
   * every view in the mockup picks one of the existing palette tokens for
   * its `--c`, it doesn't introduce new ones. */
  accent: string
  title: ReactNode
  /** Enables the "About this view" info button + popover when given. */
  description?: ReactNode
  /** Right-aligned `.acts` slot — a Toggle, an addBtn-alike, or nothing. */
  actions?: ReactNode
}

/** `H()` from the mockup — every view's opening header: accent icon, `<h1>`
 * title, an optional info popover, and a right-aligned actions slot.
 *
 * The popover itself is `InfoPopover` (T-260901-06) — the same `.info-wrap`
 * / `.info` / `.pop` markup this file used to render inline, extracted so a
 * settings section or a single row can carry one too. This header's own
 * label stays "About this view"; a caller elsewhere names its own section. */
export function ViewHeader({ icon, accent, title, description, actions }: ViewHeaderProps) {
  return (
    <div className="vhead">
      <div className="t">
        <span className="vicon" style={{ '--c': accent } as StyleWithAccent}>
          {icon}
        </span>
        <h1>{title}</h1>
        {description != null && <InfoPopover aria-label="About this view">{description}</InfoPopover>}
      </div>
      {actions != null && <div className="acts">{actions}</div>}
    </div>
  )
}
