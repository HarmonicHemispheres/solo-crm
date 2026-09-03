import { useMemo, type CSSProperties } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Button } from '../components/primitives/Button'
import { Card } from '../components/primitives/Card'
import { Stat } from '../components/primitives/Stat'
import { Ring } from '../components/primitives/Ring'
import { Row } from '../components/primitives/Row'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { DecayMeter } from '../components/primitives/DecayMeter'
import { EmptyState } from '../components/primitives/EmptyState'
import { QuickAdd } from '../components/primitives/QuickAdd'
import { IconButton } from '../components/primitives/IconButton'
import { PlusIcon } from '../components/icons'
import {
  useLayerManager,
  type LayerManagerContextValue,
  type SheetKind
} from '../components/shell/layer-manager-context'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { decayForCompany, type Decay } from '../lib/decay'
import { identityColor, initials } from '../lib/identity'
import { RevenueChart, RevenueLegend } from '../components/revenue/RevenueChart'
import { formatMoney, plural } from './offerings-display'
// Imported, never restated — see this file's header and T-260829-14's Risks.
import { localToday, dueMeta, sortByDue } from './todo-urgency'
import { TodoRow } from './Todos'
import { ActivityItem } from './Activity'
import type { Company, CompanyKind } from '../../shared/companies'
import type { Engagement } from '../../shared/engagements'
import type { Person } from '../../shared/people'
import type { CreateTaskInput, Task } from '../../shared/tasks'
import type { Activity as ActivityRow } from '../../shared/activity'
import type { SettingsSnapshot } from '../../shared/settings'
import type { RevenueSummary } from '../../shared/revenue'
import './Today.css'

/**
 * `/` — §6.1's Today view (T-260829-14, plan step P2-04). The route the app
 * opens on, and the requirements' own defence against Solo CRM "becoming a
 * filing cabinet rather than a prompt": it leads with what is *owed* — the
 * relationships past their own cadence and the todos that are late — not
 * with what is stored.
 *
 * Nothing on this page is computed twice. Three numbers in particular come
 * from somewhere that already owns them rather than from an array length
 * this view happens to have to hand:
 *
 * - **Open todos** is `tasks:countOpen`, the one server-side definition of
 *   "open" (`OPEN_STATUS_SQL`, T-260828-23). The "Next up" card below is a
 *   client-side slice of `tasks:list({ open: true })`; deriving the stat
 *   from that slice's length would make the number quietly mean "the five
 *   we drew".
 * - **Going quiet** membership is `decayForCompany(...).band === 'late'`
 *   (`lib/decay.ts`, T-260829-13) — per-relationship cadence, not a global
 *   day threshold this view invents. That module owns days-since-touch, the
 *   band thresholds and the kind-default cadence fallback, which is why this
 *   view fetches `settings:getAll` alongside its other reads.
 * - **The urgency ordering and the local-day boundary** are
 *   `todo-urgency.ts`'s `sortByDue`/`dueMeta`/`localToday`, the same
 *   functions `Todos.tsx` sorts and labels with. A second copy here would
 *   drift at a timezone boundary where nobody is looking.
 *
 * **The money stats and the chart read `revenue:summary`** (T-260902-05,
 * -06). §6.1's hero row is "recurring monthly revenue, fixed backlog, open
 * todos, cadence health", and the mockup computes the first two live off
 * engagement columns (`engagements.reduce((n,e) => n + mrr(e), 0)`), which
 * AGENTS.md forbids porting. Until P3-05 landed, two counts stood in for
 * them; now both figures and the twelve-month chart arrive from the same
 * one channel the Revenue view reads — every number a `SUM` over
 * `revenue_lines` in main (ADR-003). There is still no `mrr()`/`backlog()`-
 * shaped computation over `engagements` anywhere in this file, and adding
 * one is a task that should say ADR-003 in its title. When nothing has been
 * recognised yet (`lineCount` 0) the two tiles say so with a dash rather
 * than a `$0` that claims a fact.
 *
 * The mockup's **linked-systems strip** is absent for the same species of
 * reason: Notion/Drive/Stripe/Calendar last-sync times need adapters that do
 * not exist until Phase 4, and four rows that always read "never" are worse
 * than no strip.
 */

// ---------------------------------------------------------------------------
// Identity mark and kind tag — `mark()`/`hue()`/`initials()`/`kindTag()` from
// the mockup. Per-view copies, following Companies.tsx's own header on this
// exact point: T-260828-11's closed primitive list has no `.cmark`, and
// `components/icons.tsx` reserves per-view visuals for the view that uses
// them. Companies, CompanyDetail, People and PersonDetail each hold the same
// pair already; promoting all five into one shared module is a worthwhile
// change and is not this task's diff.
// ---------------------------------------------------------------------------



function CompanyMark({ name, size }: { name: string; size: number }) {
  const color = identityColor(name)
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.37), color }
  return (
    // Decorative: the row's own `.nm` states the full name right beside this,
    // so announcing the initials first would put "EZ" ahead of "EZDeploy" in
    // the row's computed accessible name.
    <span className="cmark" style={style} aria-hidden="true">
      <span>{initials(name)}</span>
    </span>
  )
}

const KIND_LABEL: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}

const KIND_VARIANT: Record<CompanyKind, TagVariant> = {
  client: 'verd',
  end_client: 'lapis',
  advisory: 'lapis',
  channel: 'lapis',
  prospect: 'gold'
}

function KindTag({ kind }: { kind: CompanyKind | null }) {
  if (kind == null) return <Tag>—</Tag>
  return <Tag variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Tag>
}

// ---------------------------------------------------------------------------
// Going quiet
// ---------------------------------------------------------------------------

interface QuietRow {
  readonly company: Company
  readonly decay: Decay
  /** The company's `is_next_step` todo title, when it has one — the row's subtitle. */
  readonly nextStepTitle: string | null
}

/**
 * **By ratio, not by raw days** — P2-04's first acceptance criterion and the
 * entire point of per-company cadence: a `client` on a 7-day cadence quiet
 * for 9 days (`pct` 1.29) is more overdue than a `channel` on 30 days quiet
 * for 20 (`pct` 0.67), even though the channel's day count is larger.
 *
 * A never-touched company has `pct: Infinity` (ADR-001 rule 5) and therefore
 * sorts to the top rather than dropping out. `Infinity === Infinity` is
 * handled by the equality branch first, so two untouched companies never
 * reach `Infinity - Infinity` and hand `Array.prototype.sort` a `NaN`
 * comparator result — which is unspecified behaviour, not a stable tie.
 * Name is the tiebreak, so the order is total and does not shuffle between
 * renders.
 */
function byPctDescending(a: QuietRow, b: QuietRow): number {
  if (a.decay.pct === b.decay.pct) return a.company.name.localeCompare(b.company.name)
  return b.decay.pct - a.decay.pct
}

// ---------------------------------------------------------------------------
// Engagements
// ---------------------------------------------------------------------------

// Stable empty-array fallbacks for a query's `undefined` (still-loading)
// data — a fresh `[]` literal is a new reference every render, which would
// make the memos below see a changed dependency on every render.
const EMPTY_COMPANIES: readonly Company[] = []
const EMPTY_TASKS: readonly Task[] = []
const EMPTY_ENGAGEMENTS: readonly Engagement[] = []
const EMPTY_PEOPLE: readonly Person[] = []
const EMPTY_ACTIVITY: readonly ActivityRow[] = []

/** How many rows "Next up" and "Recent" each draw — the mockup's own `.slice(0,5)` on both. */
const CARD_ROWS = 5

export function Today() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openLayer, openSheet } = useLayerManager()

  // Both clocks are read once per mount, not per render: `localToday()` for
  // the todo rows' local-calendar boundary and `now` for decay's instant
  // arithmetic. Reading them inside the memos below would make every render
  // a new dependency value and recompute the whole page for nothing — and
  // would let the two disagree about what "now" is mid-render.
  const today = useMemo(() => localToday(), [])
  const now = useMemo(() => new Date(), [])

  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const openTasksQuery = useQuery({
    queryKey: queryKeys.tasks.openList(),
    queryFn: ipcQueryFn('tasks:list', { open: true })
  })
  const waitingTasksQuery = useQuery({
    queryKey: queryKeys.tasks.waitingList(),
    queryFn: ipcQueryFn('tasks:list', { status: 'waiting' })
  })
  const countOpenQuery = useQuery({ queryKey: queryKeys.tasks.countOpen(), queryFn: ipcQueryFn('tasks:countOpen') })
  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const peopleQuery = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  const activityQuery = useQuery({ queryKey: queryKeys.activity.list(), queryFn: ipcQueryFn('activity:list') })
  // The same key `Shell.tsx` and `Rail.tsx` already hold, so opening this
  // view issues no second `settings:getAll` — it reads the snapshot they
  // cached. Needed here for `decayForCompany`'s kind-default cadence.
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.list(), queryFn: ipcQueryFn('settings:getAll') })
  // The same entry the Revenue view holds, so moving between the two pages
  // is one read. Its failure is kept out of the page's own `loadError`
  // below: the dashboard's todos and cadence have nothing to do with a
  // revenue line, and a hand-edited row that broke the summary must not
  // blank them — the two tiles read "—" and the card says what happened.
  const revenueQuery = useQuery({ queryKey: queryKeys.revenue.summary(), queryFn: ipcQueryFn('revenue:summary') })

  // ---- Completion — the same contract Todos.tsx's own completion uses: the
  // open list and the countOpen summary are both rewritten in onMutate so
  // the row leaves the card and the stat drops in the same render, rolled
  // back together on failure, and reconciled through `invalidate.tasks`
  // either way. Narrower than Todos' version by exactly one cache: "Next up"
  // draws from `tasks:list({ open: true })`, which `OPEN_STATUS_SQL` already
  // excludes `waiting` from, so there is no waiting row here to remove and
  // no case where the count must *not* move.
  const completeMutation = useMutation({
    mutationFn: (task: Task) => callCrm('tasks:update', { id: task.id, patch: { status: 'done' } }).then(unwrapMutationResult),
    onMutate: async (task: Task) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all() })
      const previousOpen = queryClient.getQueryData<readonly Task[]>(queryKeys.tasks.openList())
      const previousCount = queryClient.getQueryData<{ count: number }>(queryKeys.tasks.countOpen())

      queryClient.setQueryData<readonly Task[]>(queryKeys.tasks.openList(), (current) =>
        current?.filter((t) => t.id !== task.id)
      )
      if (previousCount) {
        queryClient.setQueryData(queryKeys.tasks.countOpen(), { count: Math.max(0, previousCount.count - 1) })
      }

      return { previousOpen, previousCount }
    },
    onError: (_error, _task, context) => {
      if (!context) return
      if (context.previousOpen !== undefined) queryClient.setQueryData(queryKeys.tasks.openList(), context.previousOpen)
      if (context.previousCount !== undefined) queryClient.setQueryData(queryKeys.tasks.countOpen(), context.previousCount)
    },
    onSettled: () => invalidate.tasks(queryClient)
  })

  const createMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => callCrm('tasks:create', input).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })

  const companies: readonly Company[] = companiesQuery.data ?? EMPTY_COMPANIES
  const openTasks: readonly Task[] = openTasksQuery.data ?? EMPTY_TASKS
  const waitingTasks: readonly Task[] = waitingTasksQuery.data ?? EMPTY_TASKS
  const engagements: readonly Engagement[] = engagementsQuery.data ?? EMPTY_ENGAGEMENTS
  const people: readonly Person[] = peopleQuery.data ?? EMPTY_PEOPLE
  const activityRows: readonly ActivityRow[] = activityQuery.data ?? EMPTY_ACTIVITY
  const settings: SettingsSnapshot | undefined = settingsQuery.data
  const revenue: RevenueSummary | undefined = revenueQuery.data

  const quiet = useMemo<readonly QuietRow[]>(() => {
    if (!settings) return []
    // One next-step todo per company, the most urgent first so a company with
    // two of them shows the one that is actually next. Open tasks only: a
    // next step that is `waiting` is the other side's move, not the prompt
    // this row is meant to be.
    const nextStepByCompany = new Map<string, Task>()
    for (const task of [...openTasks].sort(sortByDue)) {
      if (!task.isNextStep || task.companyId == null) continue
      if (!nextStepByCompany.has(task.companyId)) nextStepByCompany.set(task.companyId, task)
    }
    return companies
      .map((company) => ({
        company,
        decay: decayForCompany(company, settings, now),
        nextStepTitle: nextStepByCompany.get(company.id)?.title ?? null
      }))
      .filter((row) => row.decay.band === 'late')
      .sort(byPctDescending)
  }, [companies, openTasks, settings, now])

  const nextUp = useMemo(() => [...openTasks].sort(sortByDue).slice(0, CARD_ROWS), [openTasks])
  const recent = useMemo(() => activityRows.slice(0, CARD_ROWS), [activityRows])

  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies])
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const engagementsById = useMemo(
    () => new Map(engagements.map((engagement) => [engagement.id, engagement])),
    [engagements]
  )

  // The overdue half of the Open todos stat's `meta`, taken from the same
  // `dueMeta` that labels each row "3d overdue" — one local-day boundary on
  // the page, not a second one written for the stat.
  const overdueCount = openTasks.filter((task) => dueMeta(task, today).cls === 'over').length
  const currentCompanies = companies.length - quiet.length
  // Nothing recognised yet: the tiles say so rather than reading `$0`.
  const recognised = revenue !== undefined && revenue.lineCount > 0

  const isLoading =
    companiesQuery.isPending ||
    openTasksQuery.isPending ||
    waitingTasksQuery.isPending ||
    countOpenQuery.isPending ||
    engagementsQuery.isPending ||
    peopleQuery.isPending ||
    activityQuery.isPending ||
    settingsQuery.isPending ||
    revenueQuery.isPending
  const loadError =
    companiesQuery.error ??
    openTasksQuery.error ??
    waitingTasksQuery.error ??
    countOpenQuery.error ??
    engagementsQuery.error ??
    peopleQuery.error ??
    activityQuery.error ??
    settingsQuery.error

  const header = (
    <ViewHeader
      icon={<TodayGlyph />}
      accent="var(--verdigris)"
      title="Today"
      description="Every relationship is scored against the cadence you set for it, not a global rule. A retainer client at eight days is a problem; a referral channel at eight days is fine."
      actions={
        <Button variant="ghost" onClick={(event) => openLayer('log', event.currentTarget)}>
          <PlusIcon />
          Log a touch
        </Button>
      }
    />
  )

  // One loading state and one error state for the whole page, decided here
  // rather than per card (T-260829-14's Risks: "Five queries, five loading
  // states... rather than letting three cards each render their own spinner
  // and shift the layout"). The error branch comes *before* the empty-
  // workspace branch on purpose: "no companies yet" and "companies:list
  // failed" must not look the same, or a broken app reads as a fresh one.
  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading today…</p>
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

  if (companies.length === 0) {
    return (
      <div>
        {header}
        <FirstRun onOpenSheet={openSheet} />
      </div>
    )
  }

  return (
    <div>
      {header}
      <div className="grid stats today-stats">
        <Stat
          label="Recurring / month"
          value={recognised ? formatMoney(revenue.metrics.recurringMonthCents) : '—'}
          tone="hero"
          meta={
            recognised
              ? `${plural(revenue.metrics.recurringEngagements, 'retainer')} · ${formatMoney(revenue.metrics.recurringNextYearCents)} next 12 mo`
              : 'nothing recognised yet'
          }
        />
        <Stat
          label="Fixed backlog"
          value={recognised ? formatMoney(revenue.metrics.backlogCents) : '—'}
          meta={recognised ? plural(revenue.metrics.backlogMilestones, 'unbilled milestone') : 'nothing recognised yet'}
        />
        <Stat label="Open todos" value={countOpenQuery.data?.count ?? 0} meta={`${overdueCount} overdue · ${waitingTasks.length} waiting`} />
        <Stat
          label="Cadence health"
          value={currentCompanies}
          meta={`of ${companies.length} current`}
          chart={
            <Ring
              pct={currentCompanies / companies.length}
              size={52}
              color={quiet.length > 0 ? 'var(--orange)' : 'var(--green)'}
            />
          }
        />
      </div>

      <div className="grid today-cards">
        <Card>
          <Card.Header title="Going quiet" count={quiet.length} />
          {quiet.length === 0 ? (
            <EmptyState>Everyone is current.</EmptyState>
          ) : (
            quiet.map(({ company, decay, nextStepTitle }) => (
              <Row
                key={company.id}
                onClick={() => navigate(`/company/${company.id}`)}
                leading={<CompanyMark name={company.name} size={30} />}
                title={company.name}
                // The next step is the action; the cadence is the fallback
                // fact when nobody has named one (P2-05 owns naming it
                // inline — surfacing an existing one is all this row does).
                subtitle={nextStepTitle ?? `every ${decay.cadenceDays}d`}
                trailing={
                  <>
                    <KindTag kind={company.kind} />
                    <DecayMeter pct={decay.pct} label={decay.label} />
                  </>
                }
              />
            ))
          )}
        </Card>

        {/* The mockup's order: Going quiet, then the chart, then Next up. */}
        <Card>
          <Card.Header title="Revenue" actions={<RevenueLegend compact />} />
          {recognised ? (
            <div className="today-chart">
              <RevenueChart window={revenue.window} series={revenue.series} currentMonth={revenue.currentMonth} height={150} />
            </div>
          ) : revenueQuery.error ? (
            <EmptyState>{revenueQuery.error.message}</EmptyState>
          ) : (
            <EmptyState>Nothing recognised yet — a signed engagement with a price puts its months here.</EmptyState>
          )}
        </Card>

        <Card>
          <Card.Header
            title="Next up"
            count={nextUp.length}
            actions={
              <IconButton aria-label="All todos" onClick={() => navigate('/todos')}>
                <AllTodosIcon />
              </IconButton>
            }
          />
          {nextUp.length === 0 ? (
            <EmptyState>Nothing due.</EmptyState>
          ) : (
            nextUp.map((task) => (
              <TodoRow
                key={task.id}
                task={task}
                today={today}
                companies={companies}
                engagements={engagements}
                people={people}
                onComplete={(completed) => completeMutation.mutate(completed)}
                onNavigateCompany={(id) => navigate(`/company/${id}`)}
                onNavigatePerson={(id) => navigate(`/person/${id}`)}
              />
            ))
          )}
          <QuickAdd placeholder="Add a todo" onAdd={(title) => createMutation.mutate({ title, dueOn: null })} />
        </Card>

        <Card>
          <Card.Header
            title="Recent"
            actions={
              // "Add a touch", not the header's "Log a touch": the two open
              // the same layer, and Companies.tsx's own precedent is that two
              // controls on one page do not share an accessible name.
              <IconButton aria-label="Add a touch" onClick={(event) => openLayer('log', event.currentTarget)}>
                <PlusIcon />
              </IconButton>
            }
          />
          {recent.length === 0 ? (
            <EmptyState>Nothing logged yet.</EmptyState>
          ) : (
            <div className="tl tl-log">
              {recent.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  companiesById={companiesById}
                  peopleById={peopleById}
                  engagementsById={engagementsById}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/**
 * The state every fresh install opens on: no companies, so no stats worth
 * showing and nothing to be late about. Four zeroes and three empty cards
 * would be technically accurate and useless — this says what to do first and
 * does it, through the same `openSheet` path the topbar's New menu uses, so
 * there is no second create route to keep working.
 *
 * It stands on its own: T-260829-15's guided tour is an overlay on top of
 * this, not the mechanism that makes it work.
 */
function FirstRun({ onOpenSheet }: { onOpenSheet: LayerManagerContextValue['openSheet'] }) {
  const steps: ReadonlyArray<{ kind: SheetKind; label: string; hint: string }> = [
    { kind: 'company', label: 'Add a company', hint: 'The client, prospect or channel every other record hangs off.' },
    { kind: 'person', label: 'Add a person', hint: 'Who you actually talk to there.' },
    { kind: 'engagement', label: 'Open an engagement', hint: 'The work itself — retainer, fixed scope or time and materials.' }
  ]

  return (
    <Card>
      <Card.Header title="Start here" />
      <ol className="firstrun">
        {steps.map((step, index) => (
          <li key={step.kind}>
            <span className="n" aria-hidden="true">
              {index + 1}
            </span>
            <span className="grow">
              <span className="nm">{step.label}</span>
              <span className="sub">{step.hint}</span>
            </span>
            <Button variant="ghost" onClick={(event) => onOpenSheet(step.kind, event.currentTarget)}>
              <PlusIcon />
              {step.label}
            </Button>
          </li>
        ))}
      </ol>
    </Card>
  )
}

/** `VMETA.today` from the mockup — a clock face, drawn on `--verdigris` (`#5BA4A4`, the token the mockup names it by). */
function TodayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8.4v3.8l2.4 1.6" />
    </svg>
  )
}

/** The mockup's own "all todos" glyph on the Next up card header. */
function AllTodosIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h11M9 18h11M4 6l1.5 1.5L8 5M4 18l1.5 1.5L8 17" />
    </svg>
  )
}
