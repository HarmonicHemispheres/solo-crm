import type { ReactNode } from 'react'
import './Row.css'

export interface RowProps {
  onClick: () => void
  /** Leading visual — a company/person mark, a table icon, etc. */
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Tags, a DecayMeter, a Ring — content that sits after the name/subtitle
   * and stays visible at every width. */
  trailing?: ReactNode
  /** Row-level actions (edit, remove, …) that only reveal on hover/focus —
   * and, per the mockup's 700px rule, stay revealed below that width since
   * there's no hover on touch. Buttons, so they can't nest inside the row's
   * own click target without breaking HTML/ARIA button-in-button rules;
   * when `actions` is given, Row renders the navigable content as an inner
   * button and the actions as its sibling instead of wrapping everything in
   * one outer button. */
  actions?: ReactNode
}

const content = (leading: ReactNode, title: ReactNode, subtitle: ReactNode, trailing: ReactNode) => (
  <>
    {leading}
    <span className="grow">
      <span className="nm trunc">{title}</span>
      {subtitle != null && <span className="sub trunc">{subtitle}</span>}
    </span>
    {trailing}
  </>
)

/** `.row` from the mockup — the clickable list row used for the dashboard's
 * Going quiet list, the SQL console's table list, and a company's people
 * list. Every one of those is a plain `<button>`, which is what this
 * renders whenever there's nothing else in the row competing for clicks. */
export function Row({ onClick, leading, title, subtitle, trailing, actions }: RowProps) {
  if (actions == null) {
    return (
      <button type="button" className="row" onClick={onClick}>
        {content(leading, title, subtitle, trailing)}
      </button>
    )
  }

  return (
    <div className="row row-with-actions">
      <button type="button" className="row-hit" onClick={onClick}>
        {content(leading, title, subtitle, trailing)}
      </button>
      <span className="row-actions">{actions}</span>
    </div>
  )
}
