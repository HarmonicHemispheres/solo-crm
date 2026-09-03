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
  /** `decay.description` — the sentence behind the colour, so a red bar is
   * never the only account of itself. Rendered as a `title` on the whole
   * meter and read out beside the label. */
  description?: string
}

/** `.decay` from the mockup — the cadence bar used on the dashboard's Going
 * quiet list and on company rows/detail. The fill starts at 0 and grows to
 * `--w` on mount; under `prefers-reduced-motion` base.css pins `.decay
 * .fill` to `width:var(--w)` so the bar still reads at its final length
 * with the animation removed. */
export function DecayMeter({ pct, label, description }: DecayMeterProps) {
  // A non-finite pct (no cadence to measure against) must not read as
  // ok/green: there is no interval this company is inside, so it renders
  // late. Whether a *touch* exists is no longer part of this — see
  // `lib/decay.ts` on measuring an untouched company from `created_at`.
  const safe = Number.isFinite(pct) ? pct : 1
  const clamped = Math.min(Math.max(safe, 0), 1)
  const cls = safe >= 1 ? 'late' : safe >= 0.7 ? 'warn' : 'ok'

  return (
    <span className={`decay ${cls}`} title={description}>
      <span className="track">
        <span className="fill" style={{ '--w': `${clamped * 100}%` } as StyleWithCustomWidth} />
      </span>
      <span className="lab">{label}</span>
    </span>
  )
}
