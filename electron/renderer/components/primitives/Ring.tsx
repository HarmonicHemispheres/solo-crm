import './Ring.css'

export interface RingProps {
  /** 0–1. Values above 1 are clamped, matching the mockup's `Math.min(pct,1)`. */
  pct: number
  /** Diameter in px. */
  size: number
  /** Stroke colour for the progress arc — a token reference, e.g. `var(--verdigris)`. */
  color: string
  strokeWidth?: number
  /** Only needed when nothing next to the ring already states what it
   * measures (the dashboard's cadence-health stat and the company row's
   * decay ring both have that text as a sibling, so they leave this unset
   * and the ring stays decorative to assistive tech). */
  'aria-label'?: string
}

/** `ring()` from the mockup — the circular progress indicator used for
 * cadence health (dashboard) and per-company decay (company rows). The
 * fraction is drawn via `stroke-dashoffset` on a fixed-circumference
 * circle, transitioning to its target — under `prefers-reduced-motion`,
 * base.css's blanket `transition:none!important` removes the interpolation
 * and the arc renders at `pct` immediately, so no separate reduced-motion
 * case is needed here. */
export function Ring({ pct, size, color, strokeWidth = 4, 'aria-label': ariaLabel }: RingProps) {
  // A non-finite pct (cadence 0, missing data) must not draw a full healthy
  // arc — ADR-001 makes missing touch data maximally stale, so it renders
  // empty, the worst state, until a real value arrives.
  const safe = Number.isFinite(pct) ? pct : 0
  const clamped = Math.min(Math.max(safe, 0), 1)
  // The mockup's ring() uses a constant inset of 3 (`size/2-3`) regardless
  // of stroke width — not `size/2-strokeWidth`.
  const r = size / 2 - 3
  const circumference = 2 * Math.PI * r

  return (
    <svg
      className="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
      />
    </svg>
  )
}
