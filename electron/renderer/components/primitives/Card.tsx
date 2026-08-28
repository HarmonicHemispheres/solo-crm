import type { ReactNode } from 'react'
import './Card.css'

export interface CardProps {
  children: ReactNode
}

/** `.card` from the mockup — the bordered surface every list, table and
 * stat group sits in. A card can hold more than one header+body section
 * (the dashboard's "Next up" card also holds a "Linked systems" section
 * below its quickadd) — render multiple `<Card.Header>`s as siblings inside
 * one `<Card>` rather than nesting cards. */
export function Card({ children }: CardProps) {
  return <div className="card">{children}</div>
}

export interface CardHeaderProps {
  title: ReactNode
  /** Renders the `.c` count chip — e.g. how many rows are below. */
  count?: number | string
  /**
   * The right-aligned `.sp` slot. Holds whatever the header needs on its
   * trailing edge: a legend (Revenue's recurring/fixed/T&M key), one or more
   * IconButtons (Next up's "all todos" link), or nothing.
   */
  actions?: ReactNode
}

/**
 * `.card-h` from the mockup, in its three observed shapes — header with a
 * count, header with actions, header with a legend (`actions` covers the
 * legend case too: a legend is just content in the same trailing slot).
 * A header that isn't the card's first child gets its top border from CSS
 * (`.card-h:not(:first-child)`), matching the mockup's second-section
 * `border-top` override without needing a prop for it.
 */
function CardHeader({ title, count, actions }: CardHeaderProps) {
  return (
    <div className="card-h">
      <h2>{title}</h2>
      {count != null && <span className="c">{count}</span>}
      {actions != null && <span className="sp">{actions}</span>}
    </div>
  )
}

Card.Header = CardHeader
