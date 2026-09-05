/**
 * How wide a month is drawn on `/timeline`. `auto` fits every column into
 * the card, which is the only mode there was until the operator asked for a
 * way to see more detail: at "Everything" over a few years, twelve-plus
 * columns per year squeezed a bar's term to an ellipsis and a milestone
 * tick to a smudge.
 *
 * The fixed levels give a month a stated pixel width and let the plot scroll
 * sideways *inside the card* — the one place ui-design.md allows horizontal
 * scrolling ("wide content scrolls inside its own container; the page body
 * never scrolls horizontally"). The label column stays put while the plot
 * scrolls under it, so a bar never loses its name.
 *
 * Its own module rather than a constant in `Timeline.tsx` because the test
 * reads the widths and a view file may export only components
 * (react-refresh/only-export-components).
 */
export const ZOOMS = [
  { value: 'auto', label: 'Auto' },
  { value: 'x1', label: '1×' },
  { value: 'x2', label: '2×' },
  { value: 'x4', label: '4×' }
] as const
export type ZoomKey = (typeof ZOOMS)[number]['value']

/** Pixels per month column at each fixed zoom. `auto` has no entry: the width is whatever the card allows. */
export const MONTH_WIDTH_PX: Record<Exclude<ZoomKey, 'auto'>, number> = { x1: 48, x2: 96, x4: 192 }
