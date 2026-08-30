import { parseDateOnly, formatDateOnly } from '../../shared/format'
import type { CreateTaskInput, Task } from '../../shared/tasks'

/**
 * The Todos view's pure parts (T-260828-33), lifted verbatim out of
 * `Todos.tsx` by T-260829-14 so the Today view can *import* the urgency
 * ordering and the local-day arithmetic rather than restate them (that
 * task's Risks: "A second copy here is the 'constant or map re-declared in a
 * second place' defect, and it will drift at a timezone boundary where
 * nobody is looking. Import.").
 *
 * A sibling `.ts` module rather than `export`s added to `Todos.tsx` for the
 * same reason `workspace-data-facts.ts` and `nav.ts` are their own files:
 * `react-refresh/only-export-components` (eslint.config.js) disallows a file
 * that exports both components and non-components, so a view file cannot be
 * where a shared helper lives. Nothing here changed in the move — same
 * bodies, same comments, same behaviour.
 */

// ---------------------------------------------------------------------------
// Local-date arithmetic — T-260828-33's Risks: "Date-bucket boundaries
// computed in local time against UTC timestamps... comparing it against a
// timestamp is how 'Today' ends up off by one overnight." `due_on` is a
// date-only value with no timezone of its own (CONVENTIONS.md); the only
// place local vs. UTC actually matters is deciding what *today* is — that
// has to be the user's wall-clock day, not `formatDateOnly`'s UTC one, or a
// user west of UTC sees "Today" flip to "Overdue" hours before their local
// midnight. Everything downstream of that (bucketing, `addDays`) reuses
// `format.ts`'s own UTC-safe date-only helpers, exactly as CONVENTIONS.md
// requires for any other date-only value.
//
// This is emphatically *not* the instant arithmetic `lib/decay.ts` does for
// `last_touch_at` — see that module's `wholeDaysSince` comment for the other
// half of the same distinction.
// ---------------------------------------------------------------------------

/** The user's local calendar day, as a `dateOnlySchema` string — deliberately
 * built from `Date`'s LOCAL accessors (`getFullYear`/`getMonth`/`getDate`),
 * not `formatDateOnly`'s UTC ones, for the reason in the comment above. */
export function localToday(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** `dueOn` minus `today`, in whole days — positive is in the future, negative in the past. Both arguments are `dateOnlySchema` strings, parsed with the UTC-safe helper (safe here: a date-only value carries no timezone to get wrong). */
export function daysUntil(dueOn: string, today: string): number {
  const due = parseDateOnly(dueOn).getTime()
  const from = parseDateOnly(today).getTime()
  return Math.round((due - from) / 86_400_000)
}

/** `dateOnly` shifted by `delta` days, staying in UTC-safe date-only arithmetic throughout (never a local Date method). */
export function addDays(dateOnly: string, delta: number): string {
  const date = parseDateOnly(dateOnly)
  date.setUTCDate(date.getUTCDate() + delta)
  return formatDateOnly(date)
}

/** `Sep 5`, read back in UTC so the same date-only value never displays a day off from what it stores. */
export function formatDueDate(dueOn: string): string {
  return parseDateOnly(dueOn).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function daysSinceTimestamp(timestamp: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 86_400_000))
}

// ---------------------------------------------------------------------------
// Date-mode buckets — Overdue, Today, This week, Later, No date, Waiting
// (T-260828-33's Scope, verbatim). `bucketFor` never reads `waiting` from the
// open-tasks query — it can't: `OPEN_STATUS_SQL` already excludes it — so
// the `waiting` case only ever fires for rows drawn from the separate
// `waitingList()` query, one exact-status ask, not a second "open".
// ---------------------------------------------------------------------------

export type DateGroupKey = 'overdue' | 'today' | 'thisWeek' | 'later' | 'noDate' | 'waiting'

export interface DateGroupSpec {
  readonly key: DateGroupKey
  readonly label: string
}

export const DATE_GROUPS: readonly DateGroupSpec[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'noDate', label: 'No date' },
  { key: 'waiting', label: 'Waiting' }
]

export function bucketFor(task: Task, today: string): DateGroupKey {
  if (task.status === 'waiting') return 'waiting'
  if (task.dueOn == null) return 'noDate'
  const delta = daysUntil(task.dueOn, today)
  if (delta < 0) return 'overdue'
  if (delta === 0) return 'today'
  if (delta <= 7) return 'thisWeek'
  return 'later'
}

/**
 * The `dueOn`/`status` a quick-add under a given date bucket should create
 * so the new row lands in that bucket for real once the create round-trips
 * and the list refetches — T-260828-33's Risks: "Quick-add inheriting the
 * group only visually — the row appears in the right place until the next
 * refetch moves it." Each value here is chosen so `bucketFor` maps it right
 * back to `key`, so there is nothing for a refetch to correct.
 */
export function quickAddDefaultsForDateGroup(key: DateGroupKey, today: string): Pick<CreateTaskInput, 'dueOn' | 'status'> {
  switch (key) {
    case 'overdue':
      return { dueOn: addDays(today, -1) }
    case 'today':
      return { dueOn: today }
    case 'thisWeek':
      return { dueOn: addDays(today, 3) }
    case 'later':
      return { dueOn: addDays(today, 14) }
    case 'noDate':
      return { dueOn: null }
    case 'waiting':
      return { dueOn: null, status: 'waiting' }
  }
}

/**
 * The urgency ordering: earliest `dueOn` first — which is "most overdue
 * first" for a list of open tasks — with undated tasks last and the title as
 * the tiebreak so the order is total and stable. Todos sorts each of its
 * date buckets with this; Today's "Next up" card sorts the whole open set
 * with it and takes the first five (T-260829-14).
 */
export function sortByDue(a: Task, b: Task): number {
  if (a.dueOn == null && b.dueOn == null) return a.title.localeCompare(b.title)
  if (a.dueOn == null) return 1
  if (b.dueOn == null) return -1
  return a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title)
}

// ---------------------------------------------------------------------------
// Due display — text (not colour alone) is what distinguishes an overdue
// row from a due-today one (T-260828-33's Risks / ui-design.md); `cls` only
// tints text that already says "3d overdue" vs. "today" vs. "waiting 6d".
// ---------------------------------------------------------------------------

export interface DueMeta {
  readonly cls: 'over' | 'soon' | 'later' | 'wait'
  readonly label: string
}

export function dueMeta(task: Task, today: string): DueMeta {
  if (task.status === 'waiting') {
    const elapsed = task.waitingSince ? daysSinceTimestamp(task.waitingSince) : 0
    return { cls: 'wait', label: `waiting ${elapsed}d` }
  }
  if (task.dueOn == null) return { cls: 'later', label: 'no date' }
  const delta = daysUntil(task.dueOn, today)
  if (delta < 0) return { cls: 'over', label: `${-delta}d overdue` }
  if (delta === 0) return { cls: 'soon', label: 'today' }
  if (delta === 1) return { cls: 'soon', label: 'tomorrow' }
  if (delta <= 7) return { cls: 'soon', label: formatDueDate(task.dueOn) }
  return { cls: 'later', label: formatDueDate(task.dueOn) }
}
