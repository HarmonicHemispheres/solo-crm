import type { ReactNode } from 'react'
import './Stat.css'

export type StatTone = 'default' | 'hero' | 'good' | 'bad'

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /**
   * `hero` marks the one gold headline value a view is allowed
   * (ui-design.md: "gold marks exactly one hero value per view") — nothing
   * can enforce that from inside this component, so audit it at the call
   * site, not here. `good`/`bad` colour just the value (Overdue turning red
   * once it's non-zero, Integrity staying green) without touching the
   * card's border the way `hero` does.
   */
  tone?: StatTone
  /** A line below the value — a count, a qualifier ("2 retainers signed").
   * Mutually exclusive with `chart` in every mockup usage, but that's a
   * convention, not something this component enforces. */
  meta?: ReactNode
  /** A sparkline or other small graphic in the `.spark` slot below the
   * value. Building the chart itself is the view's job — this only
   * reserves the slot. */
  chart?: ReactNode
}

/** `.stat` from the mockup — the stat-tile primitive used in every stat
 * row across the app. */
export function Stat({ label, value, tone = 'default', meta, chart }: StatProps) {
  return (
    <div className={tone === 'hero' ? 'stat hero' : 'stat'}>
      <div className="k">{label}</div>
      <div className={tone === 'default' || tone === 'hero' ? 'v' : `v ${tone}`}>{value}</div>
      {meta != null && <div className="meta">{meta}</div>}
      {chart != null && <div className="spark">{chart}</div>}
    </div>
  )
}
