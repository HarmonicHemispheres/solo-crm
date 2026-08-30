import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Toggle } from '../components/primitives/Toggle'
import { Card } from '../components/primitives/Card'
import { Stat } from '../components/primitives/Stat'
import { QuickAdd } from '../components/primitives/QuickAdd'
import { EmptyState } from '../components/primitives/EmptyState'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
// The date arithmetic, the buckets and the urgency ordering live in their
// own module so the Today view can import them instead of restating them
// (T-260829-14) — `react-refresh/only-export-components` is why they cannot
// simply be exported from this file. Nothing about them changed in the move.
import {
  DATE_GROUPS,
  bucketFor,
  dueMeta,
  localToday,
  quickAddDefaultsForDateGroup,
  sortByDue,
  type DateGroupKey
} from './todo-urgency'
import type { CreateTaskInput, Task } from '../../shared/tasks'
import type { Company } from '../../shared/companies'
import type { Engagement } from '../../shared/engagements'
import type { Person } from '../../shared/people'
import type { SettingEntry } from '../../shared/ipc-types'
import type { TodoGroupByMode } from '../../shared/settings'
import './Todos.css'

/**
 * §6.13/T-260828-33's Todos view body — see this task's "Why": the same
 * open+waiting tasks partitioned two ways (by date, by client), never a
 * third status filter this view invents itself. `tasks:countOpen`
 * (T-260828-23's one exported "open" definition) is the only source for the
 * owed count; every other number on this page is a length of an array
 * already fetched through a server-declared filter (`open: true` or
 * `status: 'waiting'`), not a locally re-derived predicate.
 */

interface TaskGroup {
  readonly key: string
  readonly label: string
  readonly tasks: readonly Task[]
  /** `undefined` for the date-mode groups; a company id or `null` (Unassigned) for client-mode groups — carried through to the group's own quick-add so it can scope the new task correctly. */
  readonly companyId?: string | null
}

function buildDateGroups(tasks: readonly Task[], today: string): readonly TaskGroup[] {
  const buckets = new Map<DateGroupKey, Task[]>(DATE_GROUPS.map((group) => [group.key, []]))
  for (const task of tasks) {
    buckets.get(bucketFor(task, today))?.push(task)
  }
  return DATE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    tasks: [...(buckets.get(group.key) ?? [])].sort(sortByDue)
  }))
}

const UNASSIGNED_KEY = '__unassigned__'

function buildClientGroups(tasks: readonly Task[], companies: readonly Company[]): readonly TaskGroup[] {
  const byCompany = new Map<string, Task[]>()
  const unassigned: Task[] = []
  for (const task of tasks) {
    if (task.companyId == null) {
      unassigned.push(task)
      continue
    }
    const list = byCompany.get(task.companyId) ?? []
    list.push(task)
    byCompany.set(task.companyId, list)
  }

  const companyGroups = [...byCompany.entries()]
    .map(([companyId, list]) => ({
      key: companyId,
      label: companies.find((c) => c.id === companyId)?.name ?? companyId,
      companyId,
      tasks: [...list].sort(sortByDue)
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return [
    ...companyGroups,
    { key: UNASSIGNED_KEY, label: 'Unassigned', companyId: null, tasks: [...unassigned].sort(sortByDue) }
  ]
}

// ---------------------------------------------------------------------------
// The persisted date/client toggle — same settings.ts pattern as
// Companies.tsx's card/list mode, a different key (`view.todos.groupBy`,
// this task's own addition to the registry).
// ---------------------------------------------------------------------------

const GROUP_BY_SETTING_KEY = 'view.todos.groupBy' as const

function groupByFromEntry(entry: SettingEntry | undefined): TodoGroupByMode {
  if (entry && entry.key === GROUP_BY_SETTING_KEY) return entry.value
  return 'date'
}

const GROUP_BY_OPTIONS = [
  { value: 'date' as const, label: 'By date' },
  { value: 'client' as const, label: 'By client' }
]

// Stable empty-array fallbacks for a query's `undefined` (still-loading)
// data — see their use below for why a fresh `[]` literal isn't used instead.
const EMPTY_TASKS: readonly Task[] = []
const EMPTY_COMPANIES: readonly Company[] = []
const EMPTY_ENGAGEMENTS: readonly Engagement[] = []
const EMPTY_PEOPLE: readonly Person[] = []

export function Todos() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const today = useMemo(() => localToday(), [])

  const openTasksQuery = useQuery({
    queryKey: queryKeys.tasks.openList(),
    queryFn: ipcQueryFn('tasks:list', { open: true })
  })
  const waitingTasksQuery = useQuery({
    queryKey: queryKeys.tasks.waitingList(),
    queryFn: ipcQueryFn('tasks:list', { status: 'waiting' })
  })
  const countOpenQuery = useQuery({
    queryKey: queryKeys.tasks.countOpen(),
    queryFn: ipcQueryFn('tasks:countOpen')
  })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const peopleQuery = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  const groupByQuery = useQuery({
    queryKey: queryKeys.settings.detail(GROUP_BY_SETTING_KEY),
    queryFn: ipcQueryFn('settings:get', { key: GROUP_BY_SETTING_KEY })
  })

  const setGroupByMutation = useMutation({
    mutationFn: (value: TodoGroupByMode) => callCrm('settings:set', { key: GROUP_BY_SETTING_KEY, value }).then(unwrapMutationResult),
    onSuccess: () => invalidate.settings(queryClient)
  })

  const groupBy = groupByFromEntry(groupByQuery.data)

  function handleGroupByChange(next: TodoGroupByMode) {
    // Written to the cache immediately, same pattern as Companies.tsx's
    // presentation toggle — the mutation below still round-trips through
    // settings:set so the choice survives a restart (§6.13).
    queryClient.setQueryData(queryKeys.settings.detail(GROUP_BY_SETTING_KEY), { key: GROUP_BY_SETTING_KEY, value: next })
    setGroupByMutation.mutate(next)
  }

  // ---- Completion — writes through tasks:update, and the row leaves its
  // group in this same render (this task's Acceptance): the cache is
  // rewritten in onMutate, before the IPC round trip resolves, so React
  // re-renders off the optimistic state immediately. onSettled reconciles
  // with whatever main actually persisted, exactly as Companies.tsx's own
  // mutation comment documents for a single-key case — this one spans the
  // three caches a completion can affect (open list, waiting list, the
  // countOpen summary) since a completed task must disappear from whichever
  // it was in and the owed count must only move if it counted toward it.
  const completeMutation = useMutation({
    mutationFn: (task: Task) => callCrm('tasks:update', { id: task.id, patch: { status: 'done' } }).then(unwrapMutationResult),
    onMutate: async (task: Task) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.all() })
      const previousOpen = queryClient.getQueryData<readonly Task[]>(queryKeys.tasks.openList())
      const previousWaiting = queryClient.getQueryData<readonly Task[]>(queryKeys.tasks.waitingList())
      const previousCount = queryClient.getQueryData<{ count: number }>(queryKeys.tasks.countOpen())

      queryClient.setQueryData<readonly Task[]>(queryKeys.tasks.openList(), (current) =>
        current?.filter((t) => t.id !== task.id)
      )
      queryClient.setQueryData<readonly Task[]>(queryKeys.tasks.waitingList(), (current) =>
        current?.filter((t) => t.id !== task.id)
      )
      if (task.status !== 'waiting' && previousCount) {
        queryClient.setQueryData(queryKeys.tasks.countOpen(), { count: Math.max(0, previousCount.count - 1) })
      }

      return { previousOpen, previousWaiting, previousCount }
    },
    onError: (_error, _task, context) => {
      if (!context) return
      if (context.previousOpen !== undefined) queryClient.setQueryData(queryKeys.tasks.openList(), context.previousOpen)
      if (context.previousWaiting !== undefined) queryClient.setQueryData(queryKeys.tasks.waitingList(), context.previousWaiting)
      if (context.previousCount !== undefined) queryClient.setQueryData(queryKeys.tasks.countOpen(), context.previousCount)
    },
    onSettled: () => invalidate.tasks(queryClient)
  })

  // ---- Quick-add — each group hands this the exact CreateTaskInput that
  // belongs to it (a real dueOn/status/companyId, not a visual placement
  // trick); see quickAddDefaultsForDateGroup's comment.
  const createMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => callCrm('tasks:create', input).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })

  // `?? EMPTY_*` rather than `?? []`: a fresh `[]` literal is a new
  // reference every render, which would make the `shownTasks`/`groups`
  // memos below see a "changed" dependency on every render even while
  // loading — a shared empty constant keeps that reference stable.
  const companies: readonly Company[] = companiesQuery.data ?? EMPTY_COMPANIES
  const engagements: readonly Engagement[] = engagementsQuery.data ?? EMPTY_ENGAGEMENTS
  const people: readonly Person[] = peopleQuery.data ?? EMPTY_PEOPLE
  const openTasks: readonly Task[] = openTasksQuery.data ?? EMPTY_TASKS
  const waitingTasks: readonly Task[] = waitingTasksQuery.data ?? EMPTY_TASKS

  // The one working set both groupings partition — this task's Acceptance:
  // "Both groupings show the same open tasks, partitioned differently."
  const shownTasks = useMemo(() => [...openTasks, ...waitingTasks], [openTasks, waitingTasks])

  const groups = useMemo(
    () => (groupBy === 'client' ? buildClientGroups(shownTasks, companies) : buildDateGroups(shownTasks, today)),
    [groupBy, shownTasks, companies, today]
  )

  const isLoading =
    openTasksQuery.isPending ||
    waitingTasksQuery.isPending ||
    countOpenQuery.isPending ||
    companiesQuery.isPending ||
    engagementsQuery.isPending ||
    peopleQuery.isPending ||
    groupByQuery.isPending
  const loadError =
    openTasksQuery.error ??
    waitingTasksQuery.error ??
    countOpenQuery.error ??
    companiesQuery.error ??
    engagementsQuery.error ??
    peopleQuery.error ??
    groupByQuery.error

  const overdueCount = openTasks.filter((task) => bucketFor(task, today) === 'overdue').length

  const header = (
    <ViewHeader
      icon={<TodosGlyph />}
      accent="var(--verdigris)"
      title="Todos"
      description="Waiting items don't count toward what's owed — they're the other side's move, not yours, tracked so nothing goes quiet for weeks without anyone noticing."
      actions={
        <Toggle aria-label="Group todos" options={GROUP_BY_OPTIONS} value={groupBy} onChange={handleGroupByChange} />
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading todos…</p>
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

  function handleQuickAdd(title: string, extra: Pick<CreateTaskInput, 'dueOn' | 'status' | 'companyId'>) {
    createMutation.mutate({ title, ...extra })
  }

  return (
    <div>
      {header}
      <div className="grid stats todos-stats">
        <Stat label="Open" value={countOpenQuery.data?.count ?? 0} tone="hero" meta="what's owed right now" />
        <Stat
          label="Overdue"
          value={overdueCount}
          tone={overdueCount > 0 ? 'bad' : 'good'}
          meta={overdueCount > 0 ? 'past their due date' : 'nothing late'}
        />
        <Stat label="Waiting on others" value={waitingTasks.length} meta="not your move" />
      </div>

      {shownTasks.length === 0 ? (
        <EmptyState
          action={<QuickAdd placeholder="Add a todo" onAdd={(title) => handleQuickAdd(title, { dueOn: null })} />}
        >
          No todos yet. Add the first one below.
        </EmptyState>
      ) : (
        <div className="grid todo-groups">
          {groups.map((group) => (
            <TodoGroupCard
              key={group.key}
              group={group}
              today={today}
              companies={companies}
              engagements={engagements}
              people={people}
              onComplete={(task) => completeMutation.mutate(task)}
              onNavigateCompany={(id) => navigate(`/company/${id}`)}
              onNavigatePerson={(id) => navigate(`/person/${id}`)}
              onQuickAdd={(title) => {
                const extra: Pick<CreateTaskInput, 'dueOn' | 'status' | 'companyId'> =
                  group.companyId !== undefined
                    ? { dueOn: null, companyId: group.companyId }
                    : quickAddDefaultsForDateGroup(group.key as DateGroupKey, today)
                handleQuickAdd(title, extra)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TodosGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7l2 2 3.5-3.5M4 17l2 2 3.5-3.5M13 7h7M13 17h7" />
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

function TodoGroupCard({
  group,
  today,
  companies,
  engagements,
  people,
  onComplete,
  onNavigateCompany,
  onNavigatePerson,
  onQuickAdd
}: {
  group: TaskGroup
  today: string
  companies: readonly Company[]
  engagements: readonly Engagement[]
  people: readonly Person[]
  onComplete: (task: Task) => void
  onNavigateCompany: (id: string) => void
  onNavigatePerson: (id: string) => void
  onQuickAdd: (title: string) => void
}) {
  return (
    <Card>
      <Card.Header title={group.label} count={group.tasks.length} />
      {group.tasks.map((task) => (
        <TodoRow
          key={task.id}
          task={task}
          today={today}
          companies={companies}
          engagements={engagements}
          people={people}
          onComplete={onComplete}
          onNavigateCompany={onNavigateCompany}
          onNavigatePerson={onNavigatePerson}
        />
      ))}
      <QuickAdd placeholder={`Add a todo to ${group.label}`} onAdd={onQuickAdd} />
    </Card>
  )
}

/**
 * `.todo` from the mockup, built here rather than through the shared `Row`
 * primitive: `Row` is one click target navigating to one detail route
 * (T-260828-11's shape, used as-is by Companies.tsx's/CompanyDetail.tsx's
 * rows) — a todo row has no detail route of its own to navigate to at all,
 * and needs several independent click targets in the same row (the
 * completion checkbox, and up to three separate links out to a company, an
 * engagement's company, and a person). Forcing that into `Row`'s
 * one-`onClick` contract would mean nesting buttons inside its own button,
 * which is invalid HTML. `Card`, `Tag` (mockup: `.due`) and the row's own
 * `.todo`/`.check` styling (Todos.css) still come straight from the mockup.
 *
 * Exported for the Today view's "Next up" card (T-260829-14), which shows
 * the same five rows this view shows in its Overdue/Today buckets and must
 * not draw a second, subtly different todo row to do it. Importing the
 * component also carries `Todos.css` with it, so the row's styling arrives
 * with the markup instead of depending on some other view happening to have
 * been loaded first.
 */
export function TodoRow({
  task,
  today,
  companies,
  engagements,
  people,
  onComplete,
  onNavigateCompany,
  onNavigatePerson
}: {
  task: Task
  today: string
  companies: readonly Company[]
  engagements: readonly Engagement[]
  people: readonly Person[]
  onComplete: (task: Task) => void
  onNavigateCompany: (id: string) => void
  onNavigatePerson: (id: string) => void
}) {
  const meta = dueMeta(task, today)
  const company = task.companyId ? companies.find((c) => c.id === task.companyId) : undefined
  const engagement = task.engagementId ? engagements.find((e) => e.id === task.engagementId) : undefined
  const person = task.personId ? people.find((p) => p.id === task.personId) : undefined
  // No engagement detail route exists (T-260828-32's own Touches note: "a
  // dedicated engagement detail route is not in the current route table and
  // is not added here") — an engagement link goes to its billing (falling
  // back to its client) company instead, the same destination that task's
  // own engagement cards navigate to.
  const engagementCompanyId = engagement?.billingCompanyId ?? engagement?.clientCompanyId ?? null

  return (
    <div className="todo">
      <button
        type="button"
        className={task.status === 'waiting' ? 'check wait' : 'check'}
        aria-label={`Mark "${task.title}" done`}
        onClick={() => onComplete(task)}
      >
        <CheckIcon />
      </button>
      <span className="tx">
        {task.title}
        <span className="sub">
          <span className={`due ${meta.cls}`}>{meta.label}</span>
          {company && (
            <button type="button" className="metalink" onClick={() => onNavigateCompany(company.id)}>
              {company.name}
            </button>
          )}
          {engagement &&
            (engagementCompanyId ? (
              <button type="button" className="metalink" onClick={() => onNavigateCompany(engagementCompanyId)}>
                {engagement.name}
              </button>
            ) : (
              <span className="meta">{engagement.name}</span>
            ))}
          {person && (
            <button type="button" className="metalink" onClick={() => onNavigatePerson(person.id)}>
              {person.name}
            </button>
          )}
        </span>
      </span>
    </div>
  )
}
