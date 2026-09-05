import { useQuery } from '@tanstack/react-query'
import { ipcQueryFn } from './ipc'
import { queryKeys } from './query-keys'
import { formatTimestamp } from '../../shared/format'
import { dateOnlySchema } from '../../shared/types'
import {
  DEFAULT_TIMELINE_KINDS,
  type TimelineEntryType,
  type TimelineKind,
  resolveTimelineKind
} from '../../shared/timeline'
import type { Activity } from '../../shared/activity'
import type { Task } from '../../shared/tasks'

/**
 * The reader's side of `electron/shared/timeline.ts`: the operator's category
 * list as a hook, and the two tables read back as one chronological list.
 *
 * **Why the merge happens here and not in main.** An event is an `activity`
 * row and a todo is a `tasks` row (that module's header says why they stayed
 * two tables), so a single ordered list has to come from somewhere. A
 * `timeline:list` channel doing a `UNION ALL` in SQL was the alternative; it
 * was not taken because both lists are already fetched, in full, by views
 * this app has shipped since P1 — `activity:list` has never been paginated at
 * the SQL level and `tasks:list` never has either — so a third channel would
 * add a wire shape, a query key and a set of filters that duplicate two that
 * exist, to move work that is already done. If §8's 20k-row target ever makes
 * the unbounded read itself the problem, that is one change in main affecting
 * both lists, not a reason to have three readers now.
 *
 * A pure module (no JSX) so `react-refresh/only-export-components` is not in
 * play — the category's *rendering* lives in
 * `components/timeline/TimelineKindTag.tsx`, which is components only.
 */

// ---------------------------------------------------------------------------
// The category list
// ---------------------------------------------------------------------------

/** ADR-002 rule 3: the key is declared once, never composed at a call site. */
export const TIMELINE_KINDS_SETTING_KEY = 'timeline.kinds' as const

/**
 * The operator's categories, or `DEFAULT_TIMELINE_KINDS` while the read is in
 * flight. The fallback is the registry's own default rather than an empty
 * array on purpose: an empty list would make every category chip row render
 * blank and every existing row resolve through the unknown-id path for the
 * duration of one round trip, which reads as data loss rather than as
 * loading.
 */
export function useTimelineKinds(): readonly TimelineKind[] {
  const query = useQuery({
    queryKey: queryKeys.settings.detail(TIMELINE_KINDS_SETTING_KEY),
    queryFn: ipcQueryFn('settings:get', { key: TIMELINE_KINDS_SETTING_KEY })
  })
  const entry = query.data
  if (entry && entry.key === TIMELINE_KINDS_SETTING_KEY) return entry.value
  return DEFAULT_TIMELINE_KINDS
}

export { resolveTimelineKind }

// ---------------------------------------------------------------------------
// One list out of two tables
// ---------------------------------------------------------------------------

/**
 * An event or a todo, flattened to the six facts they now share plus the
 * three entity references both carry. `source` keeps the original row so a
 * renderer that needs something only one of them has — a todo's `status` and
 * `waitingSince` for its completion control, an event's `source` — reaches it
 * without this type growing a nullable column per table.
 */
export interface TimelineEntry {
  readonly id: string
  readonly type: TimelineEntryType
  /** Short description. */
  readonly title: string
  /** Full description. */
  readonly body: string | null
  /** When it happened. Always set for an event; `null` for a todo that has only a due date. */
  readonly occurredAt: string | null
  /** When it is due. Usually `null` for an event. */
  readonly dueOn: string | null
  readonly kind: string | null
  readonly companyId: string | null
  readonly personId: string | null
  readonly engagementId: string | null
  readonly source: { readonly type: 'event'; readonly activity: Activity } | { readonly type: 'todo'; readonly task: Task }
}

export function entryOfActivity(activity: Activity): TimelineEntry {
  return {
    id: `event:${activity.id}`,
    type: 'event',
    title: activity.title,
    body: activity.body,
    occurredAt: activity.occurredAt,
    dueOn: activity.dueOn,
    kind: activity.kind,
    companyId: activity.companyId,
    personId: activity.personId,
    engagementId: activity.engagementId,
    source: { type: 'event', activity }
  }
}

export function entryOfTask(task: Task): TimelineEntry {
  return {
    id: `todo:${task.id}`,
    type: 'todo',
    title: task.title,
    body: task.body,
    occurredAt: task.occurredAt,
    dueOn: task.dueOn,
    kind: task.kind,
    companyId: task.companyId,
    personId: task.personId,
    engagementId: task.engagementId,
    source: { type: 'todo', task }
  }
}

/**
 * The instant an entry sits at on the timeline: when it happened if it has
 * happened, otherwise when it is due, otherwise nothing.
 *
 * A due date is a date-only value and `occurredAt` is an instant, so the two
 * cannot be string-compared directly — `2026-09-04` sorts before every
 * `2026-09-04T…Z` and after every `2026-09-03T…Z`, which is *nearly* right
 * and wrong exactly on the day that matters. The date is widened to that
 * day's local start, matching how `Activity`'s date-range filter widens the
 * operator's picked day and for the same reason: the row renders its date in
 * local time, so it has to sort in local time too (LESSONS.md 12).
 *
 * `null` for an entry with neither — an undated todo. Those sort last.
 */
export function entryInstant(entry: TimelineEntry): string | null {
  if (entry.occurredAt != null) return entry.occurredAt
  if (entry.dueOn != null) return localDayStartTimestamp(entry.dueOn)
  return null
}

/**
 * A `YYYY-MM-DD` day as the instant it begins in the operator's own timezone.
 * Built field by field rather than through `new Date(dateOnly)`, which the
 * language spec defines as *UTC* for the bare form — the exact trap this
 * helper exists to avoid.
 */
export function localDayStartTimestamp(dateOnly: string): string {
  const [year, month, day] = dateOnlySchema.parse(dateOnly).split('-').map(Number)
  return formatTimestamp(new Date(year, month - 1, day, 0, 0, 0, 0))
}

/** As `localDayStartTimestamp`, for the last millisecond of the day. Built by field, not by adding `DAY_MS - 1`: a day is not always 86,400,000 ms long. */
export function localDayEndTimestamp(dateOnly: string): string {
  const [year, month, day] = dateOnlySchema.parse(dateOnly).split('-').map(Number)
  return formatTimestamp(new Date(year, month - 1, day, 23, 59, 59, 999))
}

/**
 * Both tables as one list, newest first, undated entries last and the title
 * as the tiebreak so the order is total and stable (two rows logged in the
 * same millisecond otherwise swap places between renders).
 */
export function mergeTimeline(activity: readonly Activity[], tasks: readonly Task[]): readonly TimelineEntry[] {
  const entries = [...activity.map(entryOfActivity), ...tasks.map(entryOfTask)]
  return entries.sort((a, b) => {
    const left = entryInstant(a)
    const right = entryInstant(b)
    if (left == null && right == null) return a.title.localeCompare(b.title)
    if (left == null) return 1
    if (right == null) return -1
    return right.localeCompare(left) || a.title.localeCompare(b.title)
  })
}
