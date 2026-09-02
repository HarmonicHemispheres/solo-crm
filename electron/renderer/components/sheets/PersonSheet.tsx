import { useId, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field } from './Field'
import { useCompaniesList } from './queries'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, unwrapMutationResult } from '../../lib/ipc'
import { invalidate } from '../../lib/query-keys'
import type { CreatePersonInput } from '../../../shared/people'
import { localToday } from '../../views/todo-urgency'

export interface PersonSheetProps {
  onClose: () => void
}

/** See `CompanySheet`'s `FIELD_LABELS` for the rule this table follows. `people:addAffiliation`'s own keys are here too — the affiliation is written from this form's Company/Title fields, so its failures belong on them. */
const FIELD_LABELS = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  notes: 'Notes',
  companyId: 'Company',
  title: 'Title'
} as const

/**
 * `.sheet` content for `FORMS.person` (planning/solo-crm-mockup.html) — the
 * New menu's "Person" item. `LayerManager` mounts this only while the
 * `sheet` layer is open, same as `CompanySheet` — see that component's
 * comment for why that (not an `open` prop plus a reset effect) is what
 * gives every open a blank form. Writes `people:create` and, when a company
 * was picked, `people:addAffiliation` in the same submit (this task's Scope:
 * "an optional company and title that opens the first affiliation") —
 * `affiliations.started` is required (electron/shared/people.ts) and has no
 * field of its own here, so it is stamped with today via `localToday`,
 * the same helper `nowTimestamp()` is built on.
 *
 * `people:create` and `people:addAffiliation` are two separate IPC calls,
 * not one transaction — if the second fails (a stale `companyId`, a refusal)
 * the person row is already committed. `createdPersonIdRef` (code review)
 * remembers that id across a retry so clicking Create again after an
 * affiliation failure resumes at `addAffiliation` instead of calling
 * `people:create` a second time and leaving a duplicate, affiliation-less
 * person behind. A fresh mount (every sheet open — see this component's own
 * header) starts the ref back at `null`, same as every piece of local state
 * here.
 */
export function PersonSheet({ onClose }: PersonSheetProps) {
  const formId = useId()
  const queryClient = useQueryClient()
  const companies = useCompaniesList()
  const createdPersonId = useRef<string | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [title, setTitle] = useState('')

  const { mutation, error, setError, errorFor } = useSheetMutation(
    'people',
    async (vars: { person: CreatePersonInput; companyId: string; title: string }) => {
      let personId = createdPersonId.current
      if (!personId) {
        const person = await callCrm('people:create', vars.person).then(unwrapMutationResult)
        personId = person.id
        createdPersonId.current = personId
      }
      if (vars.companyId) {
        try {
          await callCrm('people:addAffiliation', {
            personId,
            companyId: vars.companyId,
            title: vars.title.trim() || null,
            // T-260901-24: the local calendar day, not `formatDateOnly(new
            // Date())`'s UTC one — west of UTC after ~17:00 that is
            // tomorrow, and it is written to `affiliations.started`.
            started: localToday()
          }).then(unwrapMutationResult)
        } catch (err) {
          // The person row is already committed — these are two IPC calls,
          // not one transaction (this component's header). `useSheetMutation`
          // only invalidates in `onSuccess`, so without this every list in
          // the app would keep showing the pre-create data: retrying hides
          // that, but cancelling leaves a real person invisible until a
          // reload (T-260828-53 item 5). Invalidate for the half that
          // succeeded, then rethrow so the failure still surfaces and the
          // sheet still stays open.
          await invalidate.people(queryClient)
          throw err
        }
      }
      return personId
    },
    onClose,
    'Could not save this person.',
    FIELD_LABELS
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // See CompanySheet's identical guard: a submit that reaches here while
    // the previous one is still in flight must not fire `people:create`
    // (and thus `createdPersonId`) a second time before the first has had a
    // chance to set it.
    if (mutation.isPending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError({ field: 'name', message: `${FIELD_LABELS.name} is required` })
      return
    }
    setError(null)
    mutation.mutate({
      person: {
        name: trimmedName,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null
      },
      companyId,
      title
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="New person"
      titleMeta="INSERT INTO people + affiliations"
      aria-label="New person"
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
        <div className="two">
          <Field label="Name" error={errorFor('name')}>
            <input className="inp" value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Email" error={errorFor('email')}>
            <input className="inp" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jane@acme.com" />
          </Field>
        </div>
        <Field label="Phone" error={errorFor('phone')}>
          <input className="inp" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 555 0100" />
        </Field>
        <div className="two">
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
          <Field label="Title" error={errorFor('title')}>
            <input
              className="inp"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Head of operations"
            />
          </Field>
        </div>
        <Field label="Notes" error={errorFor('notes')}>
          <textarea className="inp" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </Field>
      </form>
    </Sheet>
  )
}
