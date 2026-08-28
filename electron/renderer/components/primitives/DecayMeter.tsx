import type { CSSProperties } from 'react'
import './DecayMeter.css'

/** `--w` isn't part of the standard style-object typing; this is the same
 * narrow escape hatch every "grow to a custom property" element needs. */
type StyleWithCustomWidth = CSSProperties & { '--w': string }

export interface DecayMeterProps {
  /** days-since-last-touch ÷ cadence. 1 or more is late; the mockup's own
   * `decay()` thresholds (>=1 late, >=.7 warn, else ok) are reproduced here
   * so every consumer means the same thing by "late". */
  pct: number
  /** Precomputed display label — e.g. "today" or "9d". Turning a raw date
   * into that string is the view's job (it knows about "days since" and
   * "cadence"); this primitive only draws the bar. */
  label: string
}

/** `.decay` from the mockup — the cadence bar used on the dashboard's Going
 * quiet list and on company rows/detail. The fill starts at 0 and grows to
 * `--w` on mount; under `prefers-reduced-motion` base.css pins `.decay
 * .fill` to `width:var(--w)` so the bar still reads at its final length
 * with the animation removed. */
export function DecayMeter({ pct, label }: DecayMeterProps) {
  const clamped = Math.min(Math.max(pct, 0), 1)
  const cls = pct >= 1 ? 'late' : pct >= 0.7 ? 'warn' : 'ok'

  return (
    <span className={`decay ${cls}`}>
      <span className="track">
        <span className="fill" style={{ '--w': `${clamped * 100}%` } as StyleWithCustomWidth} />
      </span>
      <span className="lab">{label}</span>
    </span>
  )
}
