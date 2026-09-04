import type { ReactNode } from 'react'
import './Section.css'

export interface SectionProps {
  title: ReactNode
  /** Renders the `.n` count after the title — how many rows the section holds. */
  count?: number | string
  /**
   * A short clause after the title (or after the count, when both are given)
   * — the mockup's "todos and touches, newest first". A caption, not a second
   * heading: it sits outside the `<h2>` so a screen reader announces the
   * section by its name alone.
   */
  caption?: ReactNode
  /** The right-aligned `.act` slot — one quiet link or icon button, never a toolbar. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * `section` / `.sh` from planning/solo-crm-company-page-mockup.html — a
 * heading row *above* a card, not inside it.
 *
 * `Card.Header` puts the title inside the card's border, which is right for
 * a dashboard tile that is one thing. A detail page is a column of several
 * things, and there the mockup lifts every heading out onto the page, so the
 * card is only its rows: the heading, count and action read as the page's
 * furniture, and the cards get their own room. Every section in a column
 * takes the same vertical gap (`.section + .section`), which is the padding
 * the in-card headers never gave — a card ended and the next began on the
 * next pixel row.
 *
 * A `<section>` element, so a page's landmarks are its sections; the `<h2>`
 * is the same level `Card.Header` renders, which is what keeps every test
 * that finds a card by its heading working under either frame.
 */
export function Section({ title, count, caption, actions, children }: SectionProps) {
  return (
    <section className="section">
      <div className="sh">
        <h2>{title}</h2>
        {count != null && <span className="n">{count}</span>}
        {caption != null && <span className="n">{caption}</span>}
        {actions != null && <span className="act">{actions}</span>}
      </div>
      {children}
    </section>
  )
}
