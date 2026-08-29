import { useId, useState, type FormEvent } from 'react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useCompaniesList } from './queries'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, unwrapMutationResult } from '../../lib/ipc'
import { COMPANY_KINDS, type CompanyKind, type CreateCompanyInput } from '../../../shared/companies'

const KIND_LABELS: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}
const KIND_OPTIONS = COMPANY_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))

const BILLS_OPTIONS = [
  { value: 'direct' as const, label: 'They pay me directly' },
  { value: 'via' as const, label: 'Billed through a partner' }
]

/** 7/14/30/90 — FORMS.company's own cadence chips. */
const CADENCE_OPTIONS = [7, 14, 30, 90].map((days) => ({ value: days, label: `${days} days` }))

/**
 * `companies:create` payload key -> the label this form gives that field, so
 * a `ValidationError` naming a column renders against the right control under
 * the name the user sees (field-errors.ts). Only keys with a `Field` that
 * renders `errorFor` belong here: a key listed without one would place its
 * message on a field that never shows it. `kind`/`billsDirectly`/
 * `cadenceDays` are chip groups over closed enumerations this file owns, so
 * they cannot carry a user-caused failure and are deliberately absent.
 */
const FIELD_LABELS = {
  name: 'Name',
  website: 'Website',
  budgetNote: 'Budget note',
  billedViaCompanyId: 'Billing partner',
  introducedByCompanyId: 'Introduced by',
  since: 'Since'
} as const

export interface CompanySheetProps {
  onClose: () => void
}

/**
 * `.sheet` content for `FORMS.company` (planning/solo-crm-mockup.html) — the
 * New menu's "Company" item. `LayerManager` mounts this only while the
 * `sheet` layer is open (`openSheet(title, trigger, 'company')`) and
 * unmounts it on close, rather than keeping it mounted with an `open` prop —
 * that is what gives every open a blank form with no reset effect: fresh
 * `useState` initial values on every mount. Writes through
 * `companies:create` (T-260828-26) and invalidates the `companies` entity on
 * success, so the new row appears in every list with no manual reload
 * (acceptance) before the sheet closes itself.
 *
 * Two fields the mockup doesn't have at all — "Introduced by" and "Since" —
 * are in this task's Scope for the company sheet specifically
 * (`introducedByCompanyId`, `since`) even though `FORMS.company` never asks
 * for either; scope wins over mockup fidelity here; see this task's Risks.
 */
export function CompanySheet({ onClose }: CompanySheetProps) {
  const formId = useId()
  const companies = useCompaniesList()

  const [name, setName] = useState('')
  const [kind, setKind] = useState<CompanyKind>('client')
  const [website, setWebsite] = useState('')
  const [billsDirectly, setBillsDirectly] = useState(true)
  const [billedVia, setBilledVia] = useState('')
  const [introducedBy, setIntroducedBy] = useState('')
  const [cadenceDays, setCadenceDays] = useState(14)
  const [budgetNote, setBudgetNote] = useState('')
  const [since, setSince] = useState('')

  const { mutation, error, setError, errorFor } = useSheetMutation(
    'companies',
    (input: CreateCompanyInput) => callCrm('companies:create', input).then(unwrapMutationResult),
    onClose,
    'Could not save this company.',
    FIELD_LABELS
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // The Create button disables on `mutation.isPending`, but that's a
    // render away — two submit events dispatched before React commits that
    // disabled state (a fast double-click/double-Enter) would otherwise
    // both reach `mutation.mutate` and insert two rows. Belt-and-braces
    // guard, checked synchronously here rather than relying on the DOM.
    if (mutation.isPending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError({ field: 'name', message: `${FIELD_LABELS.name} is required` })
      return
    }
    setError(null)
    mutation.mutate({
      name: trimmedName,
      kind,
      website: website.trim() || null,
      billsDirectly,
      billedViaCompanyId: billsDirectly ? null : billedVia || null,
      introducedByCompanyId: introducedBy || null,
      cadenceDays,
      budgetNote: budgetNote.trim() || null,
      since: since || null
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="New company"
      titleMeta="INSERT INTO companies"
      aria-label="New company"
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
        {/* Only a failure no field owns — every other message renders against
            its own control below (T-260828-53 item 2). */}
        {error?.field == null && error && (
          <div className="field-error" role="alert">
            {error.message}
          </div>
        )}
        <Field label="Name" error={errorFor('name')}>
          <input className="inp" value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Co" />
        </Field>
        <ChipField label="Relationship" value={kind} onChange={setKind} options={KIND_OPTIONS} />
        <ChipField
          label="Who invoices"
          value={billsDirectly ? 'direct' : 'via'}
          onChange={(value) => setBillsDirectly(value === 'direct')}
          options={BILLS_OPTIONS}
        />
        {!billsDirectly && (
          <Field label="Billing partner" error={errorFor('billedViaCompanyId')}>
            <select className="inp" value={billedVia} onChange={(event) => setBilledVia(event.target.value)}>
              <option value="">— none —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="two">
          <Field label="Website" error={errorFor('website')}>
            <input className="inp" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="acme.com" />
          </Field>
          <Field label="Budget note" error={errorFor('budgetNote')}>
            <input
              className="inp"
              value={budgetNote}
              onChange={(event) => setBudgetNote(event.target.value)}
              placeholder="$25,000 approved"
            />
          </Field>
        </div>
        <Field label="Introduced by" error={errorFor('introducedByCompanyId')}>
          <select className="inp" value={introducedBy} onChange={(event) => setIntroducedBy(event.target.value)}>
            <option value="">— none —</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </Field>
        <ChipField label="Reach out every" value={cadenceDays} onChange={setCadenceDays} options={CADENCE_OPTIONS} />
        <Field label="Since" error={errorFor('since')}>
          <input className="inp" type="date" value={since} onChange={(event) => setSince(event.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}
