import { z } from 'zod'

/**
 * The vocabulary the two halves of the timeline share — an **event** (a row
 * in `activity`) and a **todo** (a row in `tasks`) — as PURE zod with no Node
 * imports, typechecked under both `tsconfig.node.json` and `tsconfig.web.json`
 * (see `electron/shared/companies.ts`'s header for the TS6307 reasoning this
 * module inherits unchanged).
 *
 * **Why one module rather than a field on each entity's own schema.** The
 * operator asked for notes and todos to carry the same six things: a short
 * description, a full description, the date it happened, the date it is due,
 * which of the two kinds of thing it is, and a category they can edit. Five
 * of those already existed on one table or the other; this module is the
 * sixth — the category — plus the `event | todo` discriminator that lets one
 * form write either and one list show both.
 *
 * **The two tables stay two tables.** `activity` is append-only (G8,
 * ADR-001) and `tasks` has a status lifecycle, a next-step invariant and its
 * own transition-owned timestamps; a single `timeline_entries` table would
 * have had to give up the first and special-case the second, and would have
 * meant renumbering `search_fts`'s kind codes, which ADR-008 says outright is
 * not renumberable. So `TimelineEntryType` is not a stored column anywhere:
 * an event *is* an `activity` row and a todo *is* a `tasks` row, and the
 * discriminator is which repository the write went to. `renderer/lib/
 * timeline.tsx` is where the two are read back as one list.
 *
 * **The category is the `kind` column, not a second one beside it.**
 * `activity.kind` used to be a closed four-value enum (call | email | meeting
 * | note) declared here as `ACTIVITY_KINDS`. Rather than leave that in place
 * and add a parallel user-editable `category` — two overlapping labels on one
 * row, which is the thing worth avoiding — `kind` itself became the editable
 * category, and `tasks` gained the same column. What crosses the wire is
 * therefore a slug, validated for *shape* only (`timelineKindIdSchema`), not
 * membership of a closed set: the set now lives in `settings`
 * (`timeline.kinds`) and the operator can add to it, rename within it and
 * remove from it at any time.
 *
 * **A removed category must not break the rows that already carry it.** An
 * `activity` row cannot be edited at all (G8), so an id that no longer
 * appears in the settings list is not a state to repair — it is a state to
 * render. `resolveTimelineKind` below is the one place that decision is
 * taken: an unknown id resolves to a title-cased label and the neutral tone,
 * never to a blank, never to a throw.
 */

// ---------------------------------------------------------------------------
// event | todo
// ---------------------------------------------------------------------------

/** Which of the two tables an entry lives in, from the reader's side. Not a
 * column: see this module's header. */
export const TIMELINE_ENTRY_TYPES = ['event', 'todo'] as const
export type TimelineEntryType = (typeof TIMELINE_ENTRY_TYPES)[number]

export const timelineEntryTypeSchema = z.enum(TIMELINE_ENTRY_TYPES)

// ---------------------------------------------------------------------------
// The category ("kind")
// ---------------------------------------------------------------------------

/**
 * The colours a category may be given, as the bare strings `Tag`'s
 * `TagVariant` uses (`renderer/components/primitives/Tag.tsx`). Declared here
 * rather than imported from there because this module may not reach into the
 * renderer — `renderer/lib/timeline.tsx` carries a compile-time proof that
 * every tone below is a real `TagVariant`, so the two cannot drift without
 * failing `npm run typecheck`.
 *
 * Colour is chosen by the operator, so it cannot be load-bearing: every place
 * a category is rendered states its label as text as well (ui-design.md's
 * "never colour alone").
 */
export const TIMELINE_KIND_TONES = ['default', 'verd', 'gold', 'lapis', 'green', 'orange', 'red'] as const
export type TimelineKindTone = (typeof TIMELINE_KIND_TONES)[number]

/**
 * A category's stored id — lowercase, digits, hyphen and underscore, up to 32
 * characters, never leading with a separator. Shape only: whether an id is
 * *declared* is a settings question, not a wire question, and validating
 * membership here would mean a repository refusing to read back a row whose
 * category the operator has since removed.
 *
 * The four values `activity.kind` already held (`call`, `email`, `meeting`,
 * `note`) all satisfy this, which is why migration 0010 needs no backfill on
 * that table.
 */
export const timelineKindIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, 'A category id is lowercase letters, digits, - and _, up to 32 characters')
export type TimelineKindId = z.infer<typeof timelineKindIdSchema>

/** One row of the operator's category list — the `timeline.kinds` setting is an array of these. */
export const timelineKindSchema = z
  .object({
    id: timelineKindIdSchema,
    label: z.string().min(1, 'A category needs a name').max(32, 'A category name is at most 32 characters'),
    tone: z.enum(TIMELINE_KIND_TONES)
  })
  .strict()
export type TimelineKind = z.infer<typeof timelineKindSchema>

/**
 * The whole list, as the setting stores it. At least one — a list the
 * operator has emptied leaves every form with nothing to pick and every row
 * with an unresolvable category, so the last one cannot be removed — and no
 * duplicate ids, which would make `resolveTimelineKind` depend on array
 * order.
 */
export const timelineKindsSchema = z
  .array(timelineKindSchema)
  .min(1, 'Keep at least one category')
  .refine((kinds) => new Set(kinds.map((kind) => kind.id)).size === kinds.length, {
    error: 'Two categories cannot share an id'
  })

/**
 * What a fresh workspace starts with, and what an existing one is migrated
 * to. The first four are the operator's own stated defaults, in their stated
 * order. `call` and `email` follow because `activity` rows already hold those
 * two ids: dropping them from the list would not delete the label from those
 * rows (nothing can — G8), it would only stop new ones being filed that way
 * while the old ones rendered through the unknown-id fallback. Seeding them
 * is what makes migration 0010 lossless.
 */
export const DEFAULT_TIMELINE_KINDS: readonly TimelineKind[] = [
  { id: 'event', label: 'Event', tone: 'green' },
  { id: 'meeting', label: 'Meeting', tone: 'verd' },
  { id: 'task', label: 'Task', tone: 'orange' },
  { id: 'note', label: 'Note', tone: 'default' },
  { id: 'call', label: 'Call', tone: 'lapis' },
  { id: 'email', label: 'Email', tone: 'gold' }
]

/** The category a new event defaults to in the full timeline form. */
export const DEFAULT_EVENT_KIND_ID = 'note'
/** What `QuickLog` opens on — the mockup's own `let logKind='Call'`: a
 * logged *touch* is a call until said otherwise, so the five-second path
 * never has to visit the field. Declared here beside the other two rather
 * than in the component, so every default category id is greppable in one
 * place the way ADR-002 rule 3 asks of every settings key. */
export const DEFAULT_TOUCH_KIND_ID = 'call'
/** The category a new todo defaults to — also what migration 0010 backfills onto every pre-existing `tasks` row. */
export const DEFAULT_TODO_KIND_ID = 'task'

/**
 * The category a row's `kind` names, or a rendering for an id the operator
 * has since removed (or that arrived from a database written by a newer
 * build). Never throws and never returns `undefined`: an activity row cannot
 * be edited to repair its category, so "unknown" has to be a thing the UI can
 * draw. `null`/`''` — a `tasks` row written before this migration and never
 * touched since — resolves to the same neutral placeholder.
 */
export function resolveTimelineKind(id: string | null | undefined, kinds: readonly TimelineKind[]): TimelineKind {
  if (id == null || id === '') return { id: '', label: 'Uncategorised', tone: 'default' }
  const found = kinds.find((kind) => kind.id === id)
  if (found) return found
  return { id, label: titleCaseSlug(id), tone: 'default' }
}

/** `follow-up` -> `Follow up`. Only ever used on an id with no declared label. */
function titleCaseSlug(id: string): string {
  const words = id.split(/[-_]+/).filter((word) => word.length > 0)
  if (words.length === 0) return id
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ')
}

/**
 * A typed-in category name turned into an id. Used only when the operator
 * adds a category in Settings — an id is never composed anywhere else, and
 * never derived from a label again once stored, so renaming a category leaves
 * every row that carries it intact.
 *
 * Returns `null` when nothing usable survives (a name of only punctuation, or
 * one whose slug would start with a separator), so the caller refuses with a
 * stated reason rather than writing an id that `timelineKindIdSchema` will
 * later reject on the way back in.
 */
export function slugifyKindLabel(label: string): string | null {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, '')
  return timelineKindIdSchema.safeParse(slug).success ? slug : null
}
