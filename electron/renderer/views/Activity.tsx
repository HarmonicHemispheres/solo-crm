import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { Chip } from '../components/primitives/Chip'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { ipcQueryFn } from '../lib/ipc'
import { queryKeys } from '../lib/query-keys'
import { formatTimestamp, parseTimestamp } from '../../shared/format'
import { dateOnlySchema } from '../../shared/types'
import { ACTIVITY_KINDS, type Activity, type ActivityFilters, type ActivityKind } from '../../shared/activity'
import type { Company } from '../../shared/companies'
import type { Person } from '../../shared/people'
import type { Engagement } from '../../shared/engagements'
import './Activity.css'

/**
 * `/activity` (T-260828-34) — the append-only log across every company,
 * person and engagement, and the smallest place G8 ("activity is append-only")
 * has to be visible in the UI, not only in the repository
 * (`electron/main/db/repositories/activity.ts` exports no update, no delete —
 * see that module's own header for why a SQLite trigger can't stand in for
 * the boundary). This view renders no edit and no delete control anywhere:
 * `Activity.test.tsx` asserts that over the rendered output, not the diff.
 *
 * The mockup's own `views.activity` (lines ~1701-1706) is a plain two-column
 * timeline with no filters, no pagination and no links — this task's Scope
 * asks for all three, so only the timeline-item look (`.tl`/`.tli`, ported
 * into Activity.css) comes from the mockup; the filter bar and windowed
 * "Load more" have no mockup source.
 *
 * Each row is a plain (non-button) timeline item, not `Row` (T-260828-11's
 * primitive): `Row` is one clickable surface with a single `onClick`, and an
 * activity row can carry company, person AND engagement links
 * simultaneously (all three FKs on the row are independently optional) — an
 * anchor nested inside a button is invalid HTML and would fight the outer
 * click besides. Each entity reference is instead its own `<Link>`, the same
 * plain-link pattern `CompanyDetail.tsx` already uses for "billed via" /
 * "introduced by". `Tag` (also in this task's Touches) labels the kind.
 *
 * `activity:list`'s filter schema (`electron/shared/activity.ts`) has no
 * `kind` field — only `companyId`/`personId`/`engagementId`/`occurredFrom`/
 * `occurredTo` cross the IPC boundary and narrow the SQL `WHERE` clause
 * itself (the §8/X-07 concern: keeping the unbounded table off the wire).
 * Kind is the one filter this view narrows after the fact, client-side.
 *
 * No dedicated engagement detail route exists yet — T-260828-32's own scope
 * explicitly declines to add one ("a dedicated engagement detail route is
 * not in the current route table and is not added here") and instead routes
 * its own cards to the engagement's companies. An activity row's engagement
 * link makes the same choice: it points at whichever company the engagement
 * bills to (falling back to the client company), labelled with the
 * engagement's own name.
 */

const KIND_LABEL: Record<ActivityKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note'
}

const KIND_VARIANT: Record<ActivityKind, TagVariant> = {
  call: 'lapis',
  email: 'gold',
  meeting: 'verd',
  note: 'default'
}

const PAGE_SIZE = 50
const EXCERPT_LIMIT = 140

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
 * UTC** (T-260901-26). This used to be `parseDateOnly(dateOnly)`, which is
 * UTC midnight by construction (`shared/format.ts`, and correctly so — that
 * helper exists for date-only *values*, which carry no timezone to get
 * wrong). But `occurred_at` is an instant, and `formatOccurred` above
 * renders every row of it in **local** time. The two frames disagreed by the
 * UTC offset, and west of UTC that is a whole calendar day for part of every
 * evening: a touch logged at 18:00 Pacific on Sep 1 stores as
 * `2026-09-02T01:00Z`, displays "Sep 1, 6:00 PM" on its row, and was
 * *excluded* by From=Sep 1 / To=Sep 1 while being included by Sep 2. The
 * filter and the list were reading the same rows through two different
 * calendars — LESSONS.md line 12.
 *
 * So the day is constructed with the local `Date` constructor and converted
 * to the wire's UTC instant on the way out, which is what makes "the rows
 * that say that day on them" the rows the filter selects. `parseDateOnly`
 * is still the right helper everywhere a date-only value is compared to
 * another date-only value; it is the wrong one here, where a date-only value
 * bounds an instant.
 */
function localDayBounds(dateOnly: string): { start: Date; end: Date } {
  // Parsed field by field rather than through `new Date(dateOnly)`, which
  // the spec defines as *UTC* for the bare `YYYY-MM-DD` form — the exact
  // trap this function exists to avoid, one line further in.
  const [year, month, day] = dateOnlySchema.parse(dateOnly).split('-').map(Number)
  return {
    start: new Date(year, month - 1, day, 0, 0, 0, 0),
    // 23:59:59.999 local, built by field rather than by adding DAY_MS - 1:
    // a day is not always 86,400,000 ms long. On a spring-forward date it is
    // an hour shorter, and the arithmetic version would have run the range
    // an hour into the next day.
    end: new Date(year, month - 1, day, 23, 59, 59, 999)
  }
}

function dayStartTimestamp(dateOnly: string): string {
  return formatTimestamp(localDayBounds(dateOnly).start)
}
function dayEndTimestamp(dateOnly: string): string {
  return formatTimestamp(localDayBounds(dateOnly).end)
}

type EntityFilterKeys = 'companyId' | 'personId' | 'engagementId'
type EntityFilter = Pick<ActivityFilters, EntityFilterKeys>

/** Reads the "arrived at from elsewhere" entity filter off the URL
 * (`?companyId=`/`?personId=`/`?engagementId=`) — this task's Scope names
 * exactly this as a filter kind, alongside kind and date range. Nothing in
 * this wave links here with one of these set yet; reading it is still this
 * task's job so a future link (a company's own activity tab, say) has
 * somewhere to land. At most one is honoured — an activity row names at
 * most one company AND one person AND one engagement already, so a
 * combined filter would only ever narrow to the empty set. */
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
  activity: Activity,
  companiesById: Map<string, Company>,
  peopleById: Map<string, Person>,
  engagementsById: Map<string, Engagement>
): readonly EntityLink[] {
  const links: EntityLink[] = []
  if (activity.companyId != null) {
    links.push({
      key: `company-${activity.companyId}`,
      to: `/company/${activity.companyId}`,
      label: companiesById.get(activity.companyId)?.name ?? activity.companyId
    })
  }
  if (activity.personId != null) {
    links.push({
      key: `person-${activity.personId}`,
      to: `/person/${activity.personId}`,
      label: peopleById.get(activity.personId)?.name ?? activity.personId
    })
  }
  if (activity.engagementId != null) {
    const engagement = engagementsById.get(activity.engagementId)
    // See this file's header — no engagement detail route exists, so the
    // link (when resolvable) goes to the company the engagement bills to.
    const companyTarget = engagement?.billingCompanyId ?? engagement?.clientCompanyId ?? null
    links.push({
      key: `engagement-${activity.engagementId}`,
      to: companyTarget != null ? `/company/${companyTarget}` : null,
      label: engagement?.name ?? activity.engagementId
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

/**
 * One `.tli` timeline row. Exported for the Today view's "Recent" card
 * (T-260829-14, whose Scope asks for five rows "matching `Activity.tsx`'s
 * existing item rendering") — sharing the component is what makes that
 * literally true rather than approximately, and importing it carries
 * `Activity.css`'s `.tl`/`.tli` rules along with the markup.
 */
export function ActivityItem({
  activity,
  companiesById,
  peopleById,
  engagementsById
}: {
  activity: Activity
  companiesById: Map<string, Company>
  peopleById: Map<string, Person>
  engagementsById: Map<string, Engagement>
}) {
  const links = buildEntityLinks(activity, companiesById, peopleById, engagementsById)
  const excerpt = excerptOf(activity.body)

  return (
    <div className="tli">
      <div className="body">
        <span className="t">{activity.title}</span>
        <span className="d">
          <Tag variant={KIND_VARIANT[activity.kind]}>{KIND_LABEL[activity.kind]}</Tag>
          <span>{formatOccurred(activity.occurredAt)}</span>
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

export function Activity() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { openLayer } = useLayerManager()

  const [kindFilter, setKindFilter] = useState<ActivityKind | 'all'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const entityFilter = useMemo(() => readEntityFilter(searchParams), [searchParams])
  const hasEntityFilter = Object.keys(entityFilter).length > 0

  const filters = useMemo<ActivityFilters>(() => {
    const next: ActivityFilters = { ...entityFilter }
    if (fromDate !== '') next.occurredFrom = dayStartTimestamp(fromDate)
    if (toDate !== '') next.occurredTo = dayEndTimestamp(toDate)
    return next
  }, [entityFilter, fromDate, toDate])

  // Windowing (this task's Scope: "Pagination or windowing") resets to the
  // first page whenever any filter narrows or widens the set — otherwise a
  // filter change could land on a page past the end of the newly-filtered
  // rows, rendering nothing while `hasMore` is still true. Adjusted during
  // render rather than in an Effect (React's own "adjusting state when a
  // prop changes" pattern) — comparing against a previous-key snapshot and
  // calling `setState` synchronously here, guarded so it only fires on an
  // actual change, avoids the extra render-then-effect-then-render pass a
  // `useEffect([filterResetKey])` would add on every filter click.
  const filterResetKey = `${kindFilter}|${fromDate}|${toDate}|${searchParams.toString()}`
  const [prevFilterResetKey, setPrevFilterResetKey] = useState(filterResetKey)
  if (filterResetKey !== prevFilterResetKey) {
    setPrevFilterResetKey(filterResetKey)
    setVisibleCount(PAGE_SIZE)
  }

  const activityQuery = useQuery({
    queryKey: queryKeys.activity.list(filters),
    queryFn: ipcQueryFn('activity:list', filters),
    // Kind/date/entity filters each build a new query key (`query-keys.ts`)
    // — without this, every filter change would flip `isPending` back to
    // true and blank the whole view, including the filter bar the user just
    // used, until the new key's data lands. Keeping the previous rows on
    // screen through a background refetch is what makes filtering feel like
    // narrowing a list rather than reloading the page (§8/X-07).
    placeholderData: keepPreviousData
  })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const peopleQuery = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })

  const companiesById = useMemo(() => new Map((companiesQuery.data ?? []).map((company) => [company.id, company] as const)), [companiesQuery.data])
  const peopleById = useMemo(() => new Map((peopleQuery.data ?? []).map((person) => [person.id, person] as const)), [peopleQuery.data])
  const engagementsById = useMemo(
    () => new Map((engagementsQuery.data ?? []).map((engagement) => [engagement.id, engagement] as const)),
    [engagementsQuery.data]
  )

  // `activity:list` already returns `occurred_at DESC` (this task's Risks:
  // ordering by `created_at` instead is the bug that ships looking correct
  // for everything logged live and only breaks on a backdated row) — no
  // client-side re-sort here would risk disagreeing with it.
  const rows = useMemo(() => activityQuery.data ?? [], [activityQuery.data])
  const kindFilteredRows = useMemo(
    () => (kindFilter === 'all' ? rows : rows.filter((row) => row.kind === kindFilter)),
    [rows, kindFilter]
  )
  const visibleRows = kindFilteredRows.slice(0, visibleCount)
  const hasMore = kindFilteredRows.length > visibleRows.length

  const anyFilterActive = kindFilter !== 'all' || fromDate !== '' || toDate !== '' || hasEntityFilter

  function clearFilters() {
    setKindFilter('all')
    setFromDate('')
    setToDate('')
    if (hasEntityFilter) navigate('/activity', { replace: true })
  }

  const isLoading = activityQuery.isPending || companiesQuery.isPending || peopleQuery.isPending || engagementsQuery.isPending
  const loadError = activityQuery.error ?? companiesQuery.error ?? peopleQuery.error ?? engagementsQuery.error
  const entityFilterLabel = hasEntityFilter ? describeEntityFilter(entityFilter, companiesById, peopleById, engagementsById) : null

  const header = (
    <ViewHeader
      icon={<ActivityGlyph />}
      accent="var(--red)"
      title="Activity"
      description="One append-only log across every company, person and engagement. A correction is a new row — there is no edit or delete here."
      actions={
        <Button variant="ghost" onClick={(event) => openLayer('log', event.currentTarget)}>
          <PlusIcon />
          Log a touch
        </Button>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading activity…</p>
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
          <span className="filter-label" id="activity-kind-label">
            Kind
          </span>
          <div className="chiprow" role="group" aria-labelledby="activity-kind-label">
            <Chip selected={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
              All
            </Chip>
            {ACTIVITY_KINDS.map((kind) => (
              <Chip key={kind} selected={kindFilter === kind} onClick={() => setKindFilter(kind)}>
                {KIND_LABEL[kind]}
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

      {kindFilteredRows.length === 0 ? (
        anyFilterActive ? (
          <EmptyState
            action={
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            No activity matches these filters.
          </EmptyState>
        ) : (
          <EmptyState
            action={
              // "Log the first touch", not the header action's "Log a
              // touch" text: the ViewHeader's own action is rendered above
              // this on every branch (same reasoning as Companies.tsx's
              // "Add company" vs. "New company" — see that view's own
              // comment), so the two buttons need distinct accessible names
              // rather than two identically-labelled "Log a touch" buttons
              // on the same page.
              <Button variant="primary" onClick={(event) => openLayer('log', event.currentTarget)}>
                <PlusIcon />
                Log the first touch
              </Button>
            }
          >
            No activity yet. Log a touch (⌘L) to start the record.
          </EmptyState>
        )
      ) : (
        <Card>
          <div className="tl tl-log">
            {visibleRows.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                companiesById={companiesById}
                peopleById={peopleById}
                engagementsById={engagementsById}
              />
            ))}
          </div>
          {hasMore && (
            <div className="load-more">
              <Button variant="ghost" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Load {Math.min(PAGE_SIZE, kindFilteredRows.length - visibleRows.length)} more ({kindFilteredRows.length - visibleRows.length} remaining)
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
