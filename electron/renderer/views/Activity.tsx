import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Chip } from '../components/primitives/Chip'
import { Tag } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { TimelineKindIcon, TimelineKindTag } from '../components/timeline/TimelineKindTag'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import {
  entryInstant,
  localDayEndTimestamp,
  localDayStartTimestamp,
  mergeTimeline,
  useTimelineKinds,
  type TimelineEntry
} from '../lib/timeline'
import { parseTimestamp } from '../../shared/format'
import { TIMELINE_ENTRY_TYPES, type TimelineEntryType, type TimelineKind } from '../../shared/timeline'
import { dueMeta, formatDueDate, localToday } from './todo-urgency'
import type { ActivityFilters } from '../../shared/activity'
import type { Task, TaskFilter } from '../../shared/tasks'
import type { Company } from '../../shared/companies'
import type { Person } from '../../shared/people'
import type { Engagement } from '../../shared/engagements'
import './Activity.css'

/**
 * `/activity` (T-260828-34, rebuilt) — **one continuous top-to-bottom
 * timeline of everything that has happened and everything that is owed**,
 * events and todos in one chronological stream rather than an event log in a
 * card with the todos on another page.
 *
 * Three things changed here and each is worth stating, because each looks
 * like a regression to a reader who knew the old page:
 *
 * 1. **Todos are in the stream.** An event is an `activity` row and a todo is
 *    a `tasks` row (`electron/shared/timeline.ts` says why they stayed two
 *    tables); `renderer/lib/timeline.ts`'s `mergeTimeline` reads both back as
 *    one list ordered by `entryInstant` — when it happened, or when it is due
 *    if it has not. `/todos` is unchanged and still owns the grouped,
 *    work-through-it view; this is the reading surface.
 * 2. **There is no `Card` around the list.** It is a bare `.tl-log` stream
 *    with one spine running its whole height, which is what "a single
 *    top-to-bottom timeline" means and what a card — a bounded panel with its
 *    own header and padding — actively works against. The rows themselves are
 *    the mockup's `.tli`, unchanged.
 * 3. **The kind filter is the operator's own category list**, read from
 *    `timeline.kinds`, not the four-value enum this file used to hold as
 *    `KIND_LABEL`/`KIND_VARIANT`. Those two maps, plus the byte-identical
 *    glyph maps in `CompanyDetail.tsx` and `PersonDetail.tsx`, are now one
 *    module (`components/timeline/TimelineKindTag.tsx`).
 *
 * **G8 is still visible here.** No row offers an edit or a delete: an event
 * cannot be corrected, only superseded by a new one
 * (`electron/main/db/repositories/activity.ts` exports no update and no
 * delete). A *todo* is editable in principle, and the one mutation this page
 * offers is completing one — a status transition, not an edit of what the row
 * says. `Activity.test.tsx` asserts the absence over the rendered output.
 *
 * **Only the date range and the entity filter narrow the SQL.** `activity:
 * list`'s filter schema has no category field and `tasks:list`'s does, but
 * this page filters category client-side for both so the two halves cannot
 * disagree about what "filtered" means. Type and category are therefore
 * post-fetch; date and entity are the ones that keep the unbounded tables off
 * the wire (§8/X-07).
 *
 * No dedicated engagement detail route exists yet — T-260828-32 declined to
 * add one — so an engagement reference points at whichever company the
 * engagement bills to, labelled with the engagement's own name.
 */

const PAGE_SIZE = 50
const EXCERPT_LIMIT = 140

const TYPE_LABEL: Record<TimelineEntryType, string> = {
  event: 'Event',
  todo: 'Todo'
}

/** Trims and truncates a body to a one-line excerpt — `null`/blank collapses to `null` so the caller can skip the `.note` line entirely rather than rendering an empty one. */
function excerptOf(body: string | null): string | null {
  if (body == null) return null
  const trimmed = body.trim()
  if (trimmed === '') return null
  return trimmed.length > EXCERPT_LIMIT ? `${trimmed.slice(0, EXCERPT_LIMIT).trimEnd()}…` : trimmed
}

const OCCURRED_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

function formatOccurred(occurredAt: string): string {
  return OCCURRED_FORMAT.format(parseTimestamp(occurredAt))
}

/**
 * Inclusive day bounds for the date-range filter's two `<input type="date">`
 * values — a `dateOnlySchema` day, widened to the full `timestampSchema`
 * instant range `occurredFrom`/`occurredTo` compare against.
 *
 * **The bounds are the picked day in the operator's own timezone, not in
 * UTC** (T-260901-26). The two helpers moved into `renderer/lib/timeline.ts`
 * when the merge needed the same widening for a todo's `due_on`; their
 * reasoning moved with them and is worth reading before touching either —
 * `occurred_at` is an instant and every row renders it in *local* time, so a
 * filter built on UTC midnight excluded rows that display inside its own
 * range for part of every evening west of UTC (LESSONS.md 12).
 */
type EntityFilterKeys = 'companyId' | 'personId' | 'engagementId'
type EntityFilter = Pick<ActivityFilters, EntityFilterKeys>

/** Reads the "arrived at from elsewhere" entity filter off the URL
 * (`?companyId=`/`?personId=`/`?engagementId=`). At most one is honoured — a
 * row names at most one company AND one person AND one engagement already, so
 * a combined filter would only ever narrow to the empty set. */
function readEntityFilter(searchParams: URLSearchParams): EntityFilter {
  const companyId = searchParams.get('companyId')
  if (companyId) return { companyId }
  const personId = searchParams.get('personId')
  if (personId) return { personId }
  const engagementId = searchParams.get('engagementId')
  if (engagementId) return { engagementId }
  return {}
}

function describeEntityFilter(
  entityFilter: EntityFilter,
  companiesById: Map<string, Company>,
  peopleById: Map<string, Person>,
  engagementsById: Map<string, Engagement>
): string | null {
  if (entityFilter.companyId != null) return companiesById.get(entityFilter.companyId)?.name ?? entityFilter.companyId
  if (entityFilter.personId != null) return peopleById.get(entityFilter.personId)?.name ?? entityFilter.personId
  if (entityFilter.engagementId != null) return engagementsById.get(entityFilter.engagementId)?.name ?? entityFilter.engagementId
  return null
}

interface EntityLink {
  key: string
  to: string | null
  label: string
}

function buildEntityLinks(
  entry: TimelineEntry,
  companiesById: Map<string, Company>,
  peopleById: Map<string, Person>,
  engagementsById: Map<string, Engagement>
): readonly EntityLink[] {
  const links: EntityLink[] = []
  if (entry.companyId != null) {
    links.push({
      key: `company-${entry.companyId}`,
      to: `/company/${entry.companyId}`,
      label: companiesById.get(entry.companyId)?.name ?? entry.companyId
    })
  }
  if (entry.personId != null) {
    links.push({
      key: `person-${entry.personId}`,
      to: `/person/${entry.personId}`,
      label: peopleById.get(entry.personId)?.name ?? entry.personId
    })
  }
  if (entry.engagementId != null) {
    const engagement = engagementsById.get(entry.engagementId)
    // See this file's header — no engagement detail route exists, so the
    // link (when resolvable) goes to the company the engagement bills to.
    const companyTarget = engagement?.billingCompanyId ?? engagement?.clientCompanyId ?? null
    links.push({
      key: `engagement-${entry.engagementId}`,
      to: companyTarget != null ? `/company/${companyTarget}` : null,
      label: engagement?.name ?? entry.engagementId
    })
  }
  return links
}

function ActivityGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/**
 * One `.tli` row of the stream, for either half.
 *
 * The bullet is what tells an event from a todo without reading: an event
 * gets its category's glyph, a todo gets a real checkbox that completes it.
 * The meta row states the type as text as well, because a shape is not a
 * label and the type filter above offers both by name (ui-design.md).
 *
 * Not built on the shared `Row` primitive, for the reason it never was:
 * `Row` is one clickable surface with a single `onClick`, and one of these
 * carries up to three independent entity links plus, on a todo, a completion
 * button — an anchor nested inside a button is invalid HTML and would fight
 * the outer click besides.
 */
export function TimelineRow({
  entry,
  kinds,
  today,
  companiesById,
  peopleById,
  engagementsById,
  onCompleteTodo
}: {
  entry: TimelineEntry
  kinds: readonly TimelineKind[]
  today: string
  companiesById: Map<string, Company>
  peopleById: Map<string, Person>
  engagementsById: Map<string, Engagement>
  /** Omitted where completing is not on offer (Today's Recent card) — a todo row then draws its state without a control. */
  onCompleteTodo?: (task: Task) => void
}) {
  const links = buildEntityLinks(entry, companiesById, peopleById, engagementsById)
  const excerpt = excerptOf(entry.body)
  const task = entry.source.type === 'todo' ? entry.source.task : null
  const isDone = task?.status === 'done'
  const canComplete = task != null && !isDone && onCompleteTodo != null

  return (
    <div className={isDone ? 'tli done' : 'tli'} data-entry-type={entry.type}>
      {canComplete ? (
        <button
          type="button"
          className={task.status === 'waiting' ? 'bul check wait' : 'bul check'}
          aria-label={`Mark "${entry.title}" done`}
          onClick={() => onCompleteTodo(task)}
        >
          <CheckIcon />
        </button>
      ) : (
        <span className="bul">{isDone ? <CheckIcon /> : <TimelineKindIcon kind={entry.kind} />}</span>
      )}
      <div className="body">
        <span className="t">{entry.title}</span>
        <span className="d">
          <span className="tli-type">{TYPE_LABEL[entry.type]}</span>
          <TimelineKindTag kind={entry.kind} kinds={kinds} />
          {entry.occurredAt != null && <span>{formatOccurred(entry.occurredAt)}</span>}
          {/* A due date is shown as urgency for an open todo ("3d overdue")
              and as a plain date otherwise — a done todo's deadline is
              history, and an event's is a note about a deadline, neither of
              which should read as something owed today. */}
          {entry.dueOn != null &&
            (task != null && !isDone ? (
              <span className={`due ${dueMeta(task, today).cls}`}>due {dueMeta(task, today).label}</span>
            ) : (
              <span>due {formatDueDate(entry.dueOn)}</span>
            ))}
          {isDone && <Tag variant="green">Done</Tag>}
          {task?.status === 'waiting' && <Tag variant="gold">Waiting</Tag>}
          {links.length > 0 && (
            <span className="entlinks">
              {links.map((link) =>
                link.to != null ? (
                  <Link key={link.key} className="entlink" to={link.to}>
                    {link.label}
                  </Link>
                ) : (
                  <span key={link.key} className="entlink-inert">
                    {link.label}
                  </span>
                )
              )}
            </span>
          )}
        </span>
        {excerpt != null && <span className="note">{excerpt}</span>}
      </div>
    </div>
  )
}

// There was an `ActivityItem` wrapper here — `TimelineRow` for a caller
// holding an `Activity` rather than a `TimelineEntry`, which read the
// category list with `useTimelineKinds()` of its own. Its one consumer
// (Today's "Recent" card) now composes `entryOfActivity` + `TimelineRow`
// with the list the page already holds. A hook per row is a `QueryObserver`
// per row for one cached value, and Today's 10x-volume budget test
// (Today.test.tsx, RUNTIME_BOOT_*_FILES) is close enough to §8's 100ms that
// it is worth not paying.

export function Activity() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { openSheet } = useLayerManager()
  const queryClient = useQueryClient()
  const kinds = useTimelineKinds()
  const today = useMemo(() => localToday(), [])

  const [typeFilter, setTypeFilter] = useState<TimelineEntryType | 'all'>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const entityFilter = useMemo(() => readEntityFilter(searchParams), [searchParams])
  const hasEntityFilter = Object.keys(entityFilter).length > 0

  const activityFilters = useMemo<ActivityFilters>(() => {
    const next: ActivityFilters = { ...entityFilter }
    if (fromDate !== '') next.occurredFrom = localDayStartTimestamp(fromDate)
    if (toDate !== '') next.occurredTo = localDayEndTimestamp(toDate)
    return next
  }, [entityFilter, fromDate, toDate])

  // Deliberately *not* given the date range. `tasks:list`'s `dueFrom`/`dueTo`
  // bound `due_on` alone, and an entry's place on this timeline is
  // `entryInstant` — `occurred_at` when it has one, `due_on` only as the
  // fallback. Passing the range here would filter half the todos by the wrong
  // column and silently drop a todo that happened inside the window but is
  // due outside it. The range is applied to both halves client-side, once,
  // against the same value that ordered them.
  const taskFilters = useMemo<TaskFilter>(() => {
    const next: TaskFilter = {}
    if (entityFilter.companyId != null) next.companyId = entityFilter.companyId
    if (entityFilter.personId != null) next.personId = entityFilter.personId
    if (entityFilter.engagementId != null) next.engagementId = entityFilter.engagementId
    return next
  }, [entityFilter])

  // Windowing resets to the first page whenever any filter narrows or widens
  // the set — otherwise a filter change could land on a page past the end of
  // the newly-filtered rows, rendering nothing while `hasMore` is still true.
  // Adjusted during render rather than in an Effect (React's own "adjusting
  // state when a prop changes" pattern), guarded so it only fires on an
  // actual change.
  const filterResetKey = `${typeFilter}|${kindFilter}|${fromDate}|${toDate}|${searchParams.toString()}`
  const [prevFilterResetKey, setPrevFilterResetKey] = useState(filterResetKey)
  if (filterResetKey !== prevFilterResetKey) {
    setPrevFilterResetKey(filterResetKey)
    setVisibleCount(PAGE_SIZE)
  }

  const activityQuery = useQuery({
    queryKey: queryKeys.activity.list(activityFilters),
    queryFn: ipcQueryFn('activity:list', activityFilters),
    // Every filter change builds a new query key — without this, each one
    // would flip `isPending` back to true and blank the whole view, including
    // the filter bar the user just used, until the new key's data lands.
    placeholderData: keepPreviousData
  })
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.list(taskFilters),
    queryFn: ipcQueryFn('tasks:list', taskFilters),
    placeholderData: keepPreviousData
  })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const peopleQuery = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })

  // Completing from the timeline is a status transition, not an edit of what
  // the row says — see this file's header on G8. No optimistic write: unlike
  // the Todos view, where a completed row leaves its group and the owed count
  // moves, here the row stays put and only gains its Done tag, so the
  // refetch (a local SQLite read) is the whole of the update.
  const completeMutation = useMutation({
    mutationFn: (task: Task) => callCrm('tasks:update', { id: task.id, patch: { status: 'done' } }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })

  const companiesById = useMemo(() => new Map((companiesQuery.data ?? []).map((company) => [company.id, company] as const)), [companiesQuery.data])
  const peopleById = useMemo(() => new Map((peopleQuery.data ?? []).map((person) => [person.id, person] as const)), [peopleQuery.data])
  const engagementsById = useMemo(
    () => new Map((engagementsQuery.data ?? []).map((engagement) => [engagement.id, engagement] as const)),
    [engagementsQuery.data]
  )

  const entries = useMemo(
    () => mergeTimeline(activityQuery.data ?? [], tasksQuery.data ?? []),
    [activityQuery.data, tasksQuery.data]
  )

  const filteredEntries = useMemo(() => {
    const from = fromDate === '' ? null : localDayStartTimestamp(fromDate)
    const to = toDate === '' ? null : localDayEndTimestamp(toDate)
    return entries.filter((entry) => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
      if (from == null && to == null) return true
      const instant = entryInstant(entry)
      // An undated todo has no place in a dated window. It is still in the
      // stream with no range set, at the bottom, which is where `mergeTimeline`
      // puts it.
      if (instant == null) return false
      if (from != null && instant < from) return false
      if (to != null && instant > to) return false
      return true
    })
  }, [entries, typeFilter, kindFilter, fromDate, toDate])

  const visibleEntries = filteredEntries.slice(0, visibleCount)
  const remaining = filteredEntries.length - visibleEntries.length

  const anyFilterActive = typeFilter !== 'all' || kindFilter !== 'all' || fromDate !== '' || toDate !== '' || hasEntityFilter

  function clearFilters() {
    setTypeFilter('all')
    setKindFilter('all')
    setFromDate('')
    setToDate('')
    if (hasEntityFilter) navigate('/activity', { replace: true })
  }

  const isLoading =
    activityQuery.isPending || tasksQuery.isPending || companiesQuery.isPending || peopleQuery.isPending || engagementsQuery.isPending
  const loadError = activityQuery.error ?? tasksQuery.error ?? companiesQuery.error ?? peopleQuery.error ?? engagementsQuery.error
  const entityFilterLabel = hasEntityFilter ? describeEntityFilter(entityFilter, companiesById, peopleById, engagementsById) : null

  const header = (
    <ViewHeader
      icon={<ActivityGlyph />}
      accent="var(--red)"
      title="Activity"
      description="Everything that happened and everything that is owed, in one stream. An event is a matter of record — a correction is a new row, never an edit."
      actions={
        <Button variant="ghost" onClick={(event) => openSheet('entry', event.currentTarget)}>
          <PlusIcon />
          New entry
        </Button>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading the timeline…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        {header}
        <EmptyState>{loadError.message}</EmptyState>
      </div>
    )
  }

  return (
    <div>
      {header}

      {entityFilterLabel != null && (
        <div className="entity-banner">
          <span>Filtered to {entityFilterLabel}</span>
          <Button variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        </div>
      )}

      <div className="filterbar">
        <div className="filter-group">
          <span className="filter-label" id="activity-type-label">
            Type
          </span>
          <div className="chiprow" role="group" aria-labelledby="activity-type-label">
            <Chip selected={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
              All
            </Chip>
            {TIMELINE_ENTRY_TYPES.map((type) => (
              <Chip key={type} selected={typeFilter === type} onClick={() => setTypeFilter(type)}>
                {TYPE_LABEL[type]}
              </Chip>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label" id="activity-kind-label">
            Category
          </span>
          <div className="chiprow" role="group" aria-labelledby="activity-kind-label">
            <Chip selected={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
              All
            </Chip>
            {kinds.map((kind) => (
              <Chip key={kind.id} selected={kindFilter === kind.id} onClick={() => setKindFilter(kind.id)}>
                {kind.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label" id="activity-from-label">
            From
          </span>
          <input
            type="date"
            className="filter-input"
            aria-labelledby="activity-from-label"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>
        <div className="filter-group">
          <span className="filter-label" id="activity-to-label">
            To
          </span>
          <input
            type="date"
            className="filter-input"
            aria-labelledby="activity-to-label"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
        {anyFilterActive && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {filteredEntries.length === 0 ? (
        anyFilterActive ? (
          <EmptyState
            action={
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            Nothing on the timeline matches these filters.
          </EmptyState>
        ) : (
          <EmptyState
            action={
              // "Add the first entry", not the header action's "New entry":
              // the ViewHeader's own action is rendered above this on every
              // branch, so the two buttons need distinct accessible names
              // rather than two identically-labelled ones on the same page.
              <Button variant="primary" onClick={(event) => openSheet('entry', event.currentTarget)}>
                <PlusIcon />
                Add the first entry
              </Button>
            }
          >
            Nothing here yet. Add an event or a todo, or log a touch with ⌘L.
          </EmptyState>
        )
      ) : (
        <>
          <div className="tl tl-log tl-stream">
            {visibleEntries.map((entry) => (
              <TimelineRow
                key={entry.id}
                entry={entry}
                kinds={kinds}
                today={today}
                companiesById={companiesById}
                peopleById={peopleById}
                engagementsById={engagementsById}
                onCompleteTodo={(task) => completeMutation.mutate(task)}
              />
            ))}
          </div>
          {remaining > 0 && (
            <div className="load-more">
              <Button variant="ghost" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Load {Math.min(PAGE_SIZE, remaining)} more ({remaining} remaining)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
