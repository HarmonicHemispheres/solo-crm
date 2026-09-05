import type { ReactNode } from 'react'
import { Tag, type TagVariant } from '../primitives/Tag'
import { resolveTimelineKind, type TimelineKind, type TimelineKindTone } from '../../../shared/timeline'

/**
 * How a timeline category renders — its label as a `Tag`, and its glyph.
 *
 * One module, because there were three copies before this: `Activity.tsx`
 * held `KIND_LABEL` + `KIND_VARIANT`, `CompanyDetail.tsx` held
 * `ACTIVITY_KIND_PATHS` + `ACTIVITY_KIND_LABEL`, and `PersonDetail.tsx` held
 * a byte-identical `ACTIVITY_ICON_PATHS`. All three were
 * `Record<ActivityKind, …>` — total maps over a closed enum, which is exactly
 * what a user-editable category list stops being. A `Record` lookup on a
 * category the operator invented returns `undefined` and renders nothing at
 * all, silently; every lookup here goes through `resolveTimelineKind`'s
 * fallback instead.
 *
 * **Colour is never the only signal.** The operator picks each category's
 * tone, so it carries no fixed meaning — `TimelineKindTag` always renders the
 * label as text (ui-design.md), and the glyph is `aria-hidden`.
 */

/**
 * Compile-time proof that every tone the shared module offers is a real
 * `TagVariant`. `TIMELINE_KIND_TONES` cannot import `TagVariant` (it is
 * renderer-only and the shared module is typechecked under
 * `tsconfig.node.json` too), so the two are separate declarations of the same
 * set — and this line is what stops them drifting: a tone added there without
 * a matching variant here fails `npm run typecheck`, not review. Purely
 * type-level, erased at compile time.
 */
type AssertExtends<Sub extends Super, Super> = Sub
export type _TimelineKindTonesAreTagVariants = AssertExtends<TimelineKindTone, TagVariant>

/**
 * The glyphs, keyed by the ids `DEFAULT_TIMELINE_KINDS` ships. Deliberately a
 * partial map with a fallback rather than a total one: a category the
 * operator adds has no glyph of its own and gets the neutral dot, which is a
 * design decision (a per-category icon picker is a lot of surface for a mark
 * 12 pixels wide) rather than a gap.
 *
 * Presentation attributes live once on the wrapping `<svg>` below — SVG
 * `fill`/`stroke` inherit down — matching the `.tli .bul svg` rule the detail
 * views' CSS already applies.
 */
const KIND_GLYPHS: Record<string, ReactNode> = {
  call: <path d="M5 4h3l2 5-2 1a10 10 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />,
  email: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3.5 7.5L12 13l8.5-5.5" />
    </>
  ),
  meeting: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  note: <path d="M4 19l1-4 10-10 3 3L8 18z" />,
  event: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  task: <path d="M5 13l4 4L19 7" />
}

const FALLBACK_GLYPH: ReactNode = <circle cx="12" cy="12" r="4.5" />

/** The category's glyph, or the neutral dot for one this build ships no icon for. Decorative — the label beside it carries the meaning. */
export function TimelineKindIcon({ kind }: { kind: string | null | undefined }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {(kind != null && KIND_GLYPHS[kind]) || FALLBACK_GLYPH}
    </svg>
  )
}

/** The category's label as a `Tag`, in the tone the operator chose for it. */
export function TimelineKindTag({ kind, kinds }: { kind: string | null | undefined; kinds: readonly TimelineKind[] }) {
  const resolved = resolveTimelineKind(kind, kinds)
  return <Tag variant={resolved.tone}>{resolved.label}</Tag>
}
