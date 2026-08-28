/*
 * Inline SVG icons, taken from the mockup's own `<svg>` markup — no icon
 * font, no icon package. Every glyph draws on `currentColor` so it inherits
 * whatever colour the primitive using it is set to (see IconButton, which
 * relies on this to recolour on hover without a second prop).
 *
 * Only glyphs a *primitive* renders itself belong here. A view's own icons
 * (nav glyphs, activity-kind glyphs, favicons) are that view's concern, not
 * this shared set — see the mockup's per-view ICONS/FAVI tables, which stay
 * with the views that use them.
 */
import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement>

/**
 * The "+" glyph. Taken from the mockup's repeated
 * `<path d="M12 5v14M5 12h14"/>` — used for QuickAdd's leading glyph today,
 * and for any future "add" affordance so it doesn't get redrawn slightly
 * differently each time.
 */
export function PlusIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
