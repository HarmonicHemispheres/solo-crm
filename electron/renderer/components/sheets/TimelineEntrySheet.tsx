import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useCompaniesList, useEngagementsList, usePeopleList } from './queries'
import { toSheetError, type SheetError } from './field-errors'
import { callCrm, unwrapMutationResult } from '../../lib/ipc'
import { invalidate } from '../../lib/query-keys'
import { localDayStartTimestamp, useTimelineKinds } from '../../lib/timeline'
import { localToday } from '../../views/todo-urgency'
import { nowTimestamp } from '../../../shared/format'
import {
  DEFAULT_EVENT_KIND_ID,
  DEFAULT_TODO_KIND_ID,
  TIMELINE_ENTRY_TYPES,
  type TimelineEntryType
} from '../../../shared/timeline'
import { TASK_STATUSES, type CreateTaskInput, type TaskStatus } from '../../../shared/tasks'
import type { LogActivityInput } from '../../../shared/activity'
import type { SheetPrefill } from '../shell/layer-manager-context'

/**
 * The one form that adds either half of the timeline — the plus button's
 * destination on `/activity` and on `/todos`, and what the command palette's
 * `sheet('todo')` now opens.
 *
 * There used to be two forms with two different field sets: `QuickLog` (a
 * title, a category, a who) and `TodoSheet` (a title, a due date, three
 * references, a state). The operator asked for both kinds of entry to carry
 * the same six things, which makes the difference between them exactly one
 * field — the type selector at the top — and everything else shared. So this
 * is one form with one submit that routes to one of two channels:
 *
 *   Event -> `activity:log`   (an append-only `activity` row)
 *   Todo  -> `tasks:create`   (an editable `tasks` row)
 *
 * `QuickLog` deliberately survives alongside it, unmerged. It is the
 * five-second ⌘L path §2 names as a goal (one field, Enter, done, cadence
 * clock reset), and folding it into a nine-field sheet would delete that goal
 * rather than satisfy it. What it *did* pick up is this form's category list:
 * both read `timeline.kinds`, so there is one vocabulary and not two.
 *
 * **The two date fields are not the same type underneath**, and the form
 * hides that on purpose. "When it happened" is an instant on both tables
 * (`activity.occurred_at`, `tasks.occurred_at`) and "due" is a date on both
 * (`activity.due_on`, `tasks.due_on`) — see CONVENTIONS.md for why an app
 * that stores both never stores them the same way. A `<input type="date">`
 * gives a day, so `happenedAtTimestamp` below widens it, and widens *today*
 * to the current instant rather than to midnight: a touch logged this
 * afternoon should read "2:41 PM" on its row, not "12:00 AM".
 */

export interface TimelineEntrySheetProps {
  onClose: () => void
  /** Which half the form opens on. The operator can still switch — the point of one form is that they need not have decided before pressing plus. */
  initialType?: TimelineEntryType
  /**
   * Relations the form opens already pointed at, when it was opened from a
   * record's own page — the company page's Activity card `+`. Only initial
   * values: every one is a field the operator can still change, and a
   * prefilled id that no longer resolves to a row just leaves its select on
   * "none", the same as any other stale selection.
   */
  prefill?: SheetPrefill
}

/** See `CompanySheet`'s `FIELD_LABELS` for the rule this table follows: every payload key this form can be blamed for, under the name its field carries. */
const FIELD_LABELS = {
  title: 'Short description',
  body: 'Full description',
  kind: 'Category',
  occurredAt: 'Date',
  dueOn: 'Due',
  companyId: 'Company',
  engagementId: 'Engagement',
  personId: 'Person',
  status: 'State'
} as const

const TYPE_LABELS: Record<TimelineEntryType, string> = {
  event: 'Event',
  todo: 'Todo'
}
const TYPE_OPTIONS = TIMELINE_ENTRY_TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] }))

/** `done` is deliberately absent: nothing is created already finished, and offering it would put a row straight into a list nothing shows. */
const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'My move',
  waiting: 'Waiting on them',
  done: 'Done'
}
const STATUS_OPTIONS = TASK_STATUSES.filter((status) => status !== 'done').map((status) => ({
  value: status,
  label: STATUS_LABELS[status]
}))

export function TimelineEntrySheet({ onClose, initialType = 'event', prefill }: TimelineEntrySheetProps) {
  const formId = useId()
  const queryClient = useQueryClient()
  const kinds = useTimelineKinds()
  const companies = useCompaniesList()
  const engagements = useEngagementsList()
  const people = usePeopleList()

  const [type, setType] = useState<TimelineEntryType>(initialType)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<string>(initialType === 'todo' ? DEFAULT_TODO_KIND_ID : DEFAULT_EVENT_KIND_ID)
  // An event happened, so it opens dated today; a todo is usually about the
  // future and opens undated, with only its due date to say when.
  const [happenedOn, setHappenedOn] = useState(initialType === 'todo' ? '' : localToday())
  const [dueOn, setDueOn] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [companyId, setCompanyId] = useState(prefill?.companyId ?? '')
  const [engagementId, setEngagementId] = useState(prefill?.engagementId ?? '')
  const [personId, setPersonId] = useState(prefill?.personId ?? '')
  const [error, setError] = useState<SheetError | null>(null)

  const kindOptions = kinds.map((entry) => ({ value: entry.id, label: entry.label }))
  // The stored category of a row being drafted while the operator deletes
  // that category in another window is not a case worth guarding; a category
  // this form opens on that is no longer in the list is, since
  // `DEFAULT_EVENT_KIND_ID`/`DEFAULT_TODO_KIND_ID` are ids the operator may
  // legitimately have removed. Falling back to the first declared category
  // keeps the chip row showing a selection rather than none.
  const selectedKind = kinds.some((entry) => entry.id === kind) ? kind : (kinds[0]?.id ?? kind)

  /**
   * The picked day as an instant. Today widens to *now* so a same-day entry
   * carries a real time of day; any other day widens to its local start, the
   * same edge `Activity`'s date filter uses, so a row backdated to the 3rd is
   * inside a From=3rd/To=3rd filter rather than one millisecond outside it.
   */
  function happenedAtTimestamp(day: string): string {
    return day === localToday() ? nowTimestamp() : localDayStartTimestamp(day)
  }

  function fail(field: keyof typeof FIELD_LABELS | null, message: string) {
    setError({ field, message })
  }

  const logEvent = useMutation({
    mutationFn: (input: LogActivityInput) => callCrm('activity:log', input).then(unwrapMutationResult),
    onSuccess: () => {
      onClose()
      // Four caches, not one — which is why this does not go through
      // `useSheetMutation` (single-entity). `activity:log` moves
      // `companies.last_touch_at` / `people.last_contact_at` in the same
      // transaction as the insert (ADR-001), so every cached company and
      // person row is stale alongside the activity lists. Not awaited, for
      // the reason `QuickLog`'s identical block gives: awaiting holds the
      // sheet open for three round trips of *reading*, after the write has
      // already settled.
      void Promise.all([
        invalidate.activity(queryClient),
        invalidate.companies(queryClient),
        invalidate.people(queryClient),
        invalidate.search(queryClient)
      ])
    },
    onError: (err: unknown) =>
      setError(toSheetError(err instanceof Error ? err.message : 'Could not save this event.', FIELD_LABELS))
  })

  const createTodo = useMutation({
    mutationFn: (input: CreateTaskInput) => callCrm('tasks:create', input).then(unwrapMutationResult),
    onSuccess: () => {
      onClose()
      void Promise.all([invalidate.tasks(queryClient), invalidate.search(queryClient)])
    },
    onError: (err: unknown) =>
      setError(toSheetError(err instanceof Error ? err.message : 'Could not save this todo.', FIELD_LABELS))
  })

  const isPending = logEvent.isPending || createTodo.isPending

  function handleTypeChange(next: TimelineEntryType) {
    setType(next)
    // The category default follows the type, but only while the operator has
    // not chosen one themselves — switching Event -> Todo should not silently
    // discard a category they picked on purpose.
    setKind((current) =>
      current === DEFAULT_EVENT_KIND_ID || current === DEFAULT_TODO_KIND_ID
        ? next === 'todo'
          ? DEFAULT_TODO_KIND_ID
          : DEFAULT_EVENT_KIND_ID
        : current
    )
    setError(null)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // See CompanySheet's identical guard — a second Enter while the first
    // write is in flight must not create the row twice.
    if (isPending) return

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      fail('title', `${FIELD_LABELS.title} is required`)
      return
    }
    const trimmedBody = body.trim()
    setError(null)

    if (type === 'event') {
      // Required by `logActivityInputSchema` — an event that does not say
      // when it happened is not a thing that happened. Refused here, with the
      // field named, rather than sent for the repository to reject with a
      // message about `occurredAt`.
      if (happenedOn === '') {
        fail('occurredAt', `${FIELD_LABELS.occurredAt} is required for an event — a todo is the entry with no date yet`)
        return
      }
      logEvent.mutate({
        occurredAt: happenedAtTimestamp(happenedOn),
        kind: selectedKind,
        title: trimmedTitle,
        body: trimmedBody || null,
        dueOn: dueOn || null,
        companyId: companyId || null,
        personId: personId || null,
        engagementId: engagementId || null,
        source: 'manual'
      })
      return
    }

    createTodo.mutate({
      title: trimmedTitle,
      body: trimmedBody || null,
      kind: selectedKind,
      status,
      occurredAt: happenedOn === '' ? null : happenedAtTimestamp(happenedOn),
      dueOn: dueOn || null,
      companyId: companyId || null,
      engagementId: engagementId || null,
      personId: personId || null
    })
  }

  const errorFor = (field: string) => (error?.field === field ? error.message : undefined)

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title={type === 'event' ? 'New event' : 'New todo'}
      titleMeta={type === 'event' ? 'INSERT INTO activity' : 'INSERT INTO tasks'}
      // Follows the title rather than naming the component: the dialog's
      // accessible name is what a screen reader announces on open and what
      // `LayerManager.test.tsx` asserts each sheet says about itself, and
      // "New timeline entry" would have told the operator neither which half
      // they are on nor what pressing Create writes.
      aria-label={type === 'event' ? 'New event' : 'New todo'}
      footerNote={type === 'event' ? 'resets the cadence clock · cannot be edited later' : 'saved locally'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={isPending}>
            Create
          </Button>
        </>
      }
    >
      <form id={formId} className="sheet-form" onSubmit={handleSubmit}>
        {/* Only a failure no field owns — see CompanySheet's identical banner. */}
        {error?.field == null && error && (
          <div className="field-error" role="alert">
            {error.message}
          </div>
        )}

        <ChipField label="Type" value={type} onChange={handleTypeChange} options={TYPE_OPTIONS} />

        <Field label={FIELD_LABELS.title} error={errorFor('title')}>
          <input
            className="inp"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={type === 'event' ? 'Kickoff call with Rinvii' : 'Send the countersigned SOW'}
          />
        </Field>

        <Field label={FIELD_LABELS.body} error={errorFor('body')}>
          <textarea
            className="inp"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Everything worth keeping. Optional."
          />
        </Field>

        <ChipField label={FIELD_LABELS.kind} value={selectedKind} onChange={setKind} options={kindOptions} />

        <div className="two">
          {/* A constant label in both halves. It is required for an event
              and optional for a todo, which is a *validation* difference —
              stating it in the label would make the field's accessible name
              change as the type chip is toggled, renaming a control the
              operator is looking at. The refusal says so instead, on the one
              path where it matters. */}
          <Field label="Date — when it happened" error={errorFor('occurredAt')}>
            <input className="inp" type="date" value={happenedOn} onChange={(event) => setHappenedOn(event.target.value)} />
          </Field>
          <Field label="Due — when it should happen" error={errorFor('dueOn')}>
            <input className="inp" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </Field>
        </div>

        <div className="two">
          <Field label={FIELD_LABELS.companyId} error={errorFor('companyId')}>
            <select className="inp" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">— none —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={FIELD_LABELS.personId} error={errorFor('personId')}>
            <select className="inp" value={personId} onChange={(event) => setPersonId(event.target.value)}>
              <option value="">— none —</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={FIELD_LABELS.engagementId} error={errorFor('engagementId')}>
          <select className="inp" value={engagementId} onChange={(event) => setEngagementId(event.target.value)}>
            <option value="">— none —</option>
            {engagements.map((engagement) => (
              <option key={engagement.id} value={engagement.id}>
                {engagement.name}
              </option>
            ))}
          </select>
        </Field>

        {/* A state is a todo's alone — an `activity` row has no lifecycle to
            be in, which is the whole of G8. Hidden rather than disabled: a
            control that cannot apply is noise, not information. */}
        {type === 'todo' && <ChipField label={FIELD_LABELS.status} value={status} onChange={setStatus} options={STATUS_OPTIONS} />}
      </form>
    </Sheet>
  )
}
