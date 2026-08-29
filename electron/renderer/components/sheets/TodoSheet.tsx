import { useId, useState, type FormEvent } from 'react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useCompaniesList, useEngagementsList, usePeopleList } from './queries'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, unwrapMutationResult } from '../../lib/ipc'
import { TASK_STATUSES, type CreateTaskInput, type TaskStatus } from '../../../shared/tasks'

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'My move',
  waiting: 'Waiting on them',
  done: 'Done'
}
const STATUS_OPTIONS = TASK_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))

export interface TodoSheetProps {
  onClose: () => void
}

/** See `CompanySheet`'s `FIELD_LABELS` for the rule this table follows. */
const FIELD_LABELS = {
  title: 'What needs doing',
  dueOn: 'Due',
  companyId: 'Company',
  engagementId: 'Engagement',
  personId: 'Person'
} as const

/**
 * `.sheet` content for `FORMS.todo` (planning/solo-crm-mockup.html). Not
 * wired into `NewMenu.tsx` — the mockup's own New menu has no Todo item
 * either; a todo is created from the command palette (T-260828-37), which
 * mounts this component the same way `NewMenu` mounts the other three, via
 * `openSheet(title, trigger, 'todo')`. `LayerManager` mounts it only while
 * the `sheet` layer is open — see `CompanySheet`'s comment for why that (not
 * an `open` prop plus a reset effect) is what gives every open a blank form.
 *
 * `isNextStep` has no field here: `electron/shared/tasks.ts`'s
 * `createTaskInputSchema` excludes it entirely — a task can only ever become
 * the next step through `tasks:setNextStep`, never at creation — so there is
 * nothing for this form to write even though `FORMS.todo`'s own "Mark as"
 * chip suggests otherwise.
 */
export function TodoSheet({ onClose }: TodoSheetProps) {
  const formId = useId()
  const companies = useCompaniesList()
  const engagements = useEngagementsList()
  const people = usePeopleList()

  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [companyId, setCompanyId] = useState('')
  const [engagementId, setEngagementId] = useState('')
  const [personId, setPersonId] = useState('')

  const { mutation, error, setError, errorFor } = useSheetMutation(
    'tasks',
    (input: CreateTaskInput) => callCrm('tasks:create', input).then(unwrapMutationResult),
    onClose,
    'Could not save this todo.',
    FIELD_LABELS
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // See CompanySheet's identical guard.
    if (mutation.isPending) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError({ field: 'title', message: `${FIELD_LABELS.title} is required` })
      return
    }
    setError(null)
    mutation.mutate({
      title: trimmedTitle,
      status,
      dueOn: dueOn || null,
      companyId: companyId || null,
      engagementId: engagementId || null,
      personId: personId || null
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="New todo"
      titleMeta="INSERT INTO tasks"
      aria-label="New todo"
      footerNote="saved locally"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={mutation.isPending}>
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
        <Field label="What needs doing" error={errorFor('title')}>
          <input
            className="inp"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Send the countersigned SOW"
          />
        </Field>
        <div className="two">
          <Field label="Due" error={errorFor('dueOn')}>
            <input className="inp" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
          </Field>
          <Field label="Company" error={errorFor('companyId')}>
            <select className="inp" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">— none —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="two">
          <Field label="Engagement" error={errorFor('engagementId')}>
            <select className="inp" value={engagementId} onChange={(event) => setEngagementId(event.target.value)}>
              <option value="">— none —</option>
              {engagements.map((engagement) => (
                <option key={engagement.id} value={engagement.id}>
                  {engagement.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Person" error={errorFor('personId')}>
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
        <ChipField label="State" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </form>
    </Sheet>
  )
}
