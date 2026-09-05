import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useCompaniesList, usePeopleList } from './queries'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import type { SheetFormTarget } from '../shell/layer-manager-context'
import { COMPANY_KINDS, type Company, type CompanyKind, type CreateCompanyInput, type UpdateCompanyInput } from '../../../shared/companies'

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
 * The sentinel the "Not set" cadence chip carries, mapped back to `null` on
 * the way out. `cadenceDays` is `positive().nullable()` on the wire, so `0` is
 * never a value that can be stored — which is exactly why it is safe to use
 * as the one that means "no cadence" inside this form.
 *
 * It exists because the Details card became read-only (T-260901-14) and that
 * card's inline editor could clear a cadence by emptying its input. A form
 * that is the *only* writer has to be able to write everything the thing it
 * replaced could, or the decision quietly costs a capability.
 */
const CADENCE_NOT_SET = 0

/**
 * `companies:create` / `companies:update` payload key -> the label this form
 * gives that field, so a `ValidationError` naming a column renders against the
 * right control under the name the user sees (field-errors.ts). Only keys with
 * a `Field` that renders `errorFor` belong here: a key listed without one would
 * place its message on a field that never shows it. `kind`/`billsDirectly`/
 * `cadenceDays` are chip groups over closed enumerations this file owns, so
 * they cannot carry a user-caused failure and are deliberately absent.
 */
const FIELD_LABELS = {
  name: 'Name',
  website: 'Website',
  billedViaCompanyId: 'Billing partner',
  introducedByPersonId: 'Introduced by',
  since: 'Since',
  notes: 'Notes'
} as const

export interface CompanySheetProps {
  onClose: () => void
  /** New company, or one that already exists — see `SheetFormTarget`. */
  target: SheetFormTarget
}

/**
 * Every value this form starts from, derived from the record it was opened on
 * (or from nothing, for a create). Held as one object so the submit path can
 * diff against **what the form was seeded with** rather than against the
 * record's raw columns.
 *
 * That distinction is the whole reason this type exists. Three columns are
 * nullable on the row but not representable as null in the control that edits
 * them — `kind`, `billsDirectly` and (before the sentinel above) `cadenceDays`
 * — so a form seeded from a row where any of them is null has to show
 * *something*. Diffing against the record would then send that something on
 * every save: open the sheet on a company with no kind, press Save changes,
 * and it silently becomes a client. Diffing against the seed sends a column
 * only when the operator actually moved the control away from what they were
 * shown, which is the promise "Save changes" makes.
 */
interface CompanyFormSeed {
  readonly name: string
  readonly kind: CompanyKind
  readonly website: string
  readonly billsDirectly: boolean
  readonly billedVia: string
  /** A `people.id` — an introduction is made by a person (migration 0009). */
  readonly introducedBy: string
  readonly cadenceDays: number
  readonly since: string
  readonly notes: string
}

function seedFrom(company: Company | null): CompanyFormSeed {
  return {
    name: company?.name ?? '',
    kind: company?.kind ?? 'client',
    website: company?.website ?? '',
    // A stored `null` reads as "bills directly" only when there is no billing
    // partner on the row — a company with one and no flag is being billed
    // through it, whatever the column says.
    billsDirectly: company?.billsDirectly ?? company?.billedViaCompanyId == null,
    billedVia: company?.billedViaCompanyId ?? '',
    introducedBy: company?.introducedByPersonId ?? '',
    cadenceDays: company ? (company.cadenceDays ?? CADENCE_NOT_SET) : 14,
    since: company?.since ?? '',
    notes: company?.notes ?? ''
  }
}

/**
 * `.sheet` content for `FORMS.company` (planning/solo-crm-mockup.html) in both
 * of its modes: the New menu's "Company" item, and — since T-260901-14 — the
 * company detail header's Edit button, through `editSheet('company', id)`.
 * Which one is decided by `target`, not by whether an optional id happened to
 * be passed (`SheetFormTarget`).
 *
 * The split below is `EngagementSheet`'s, for its reason: `CompanySheet`
 * resolves the target, `CompanyEditSheet` loads the record and renders nothing
 * but a placeholder until it has one, and `CompanyForm` takes the record — or
 * `null` — and seeds every field from it in a `useState` initialiser. The form
 * is *mounted* with the record rather than mounted empty and filled in by an
 * effect afterwards, which is what keeps the edit path off
 * `react-hooks/set-state-in-effect`.
 *
 * **This form is the authoritative writer for a company's columns**
 * (T-260901-14). The company detail page's Details card used to edit six of
 * them inline and no longer writes at all; see `CompanyDetail.tsx`'s own
 * comment for the decision and why it went this way. The practical consequence
 * here is that this form has to carry every column that card shows —
 * including `notes`, which `FORMS.company` never asked for, and including a
 * way to clear a cadence, which the inline editor had.
 *
 * Two fields the mockup doesn't have at all — "Introduced by" and "Since" —
 * are in T-260828-27's scope for the company sheet specifically
 * (`introducedByPersonId`, `since`) even though `FORMS.company` never asks
 * for either; scope wins over mockup fidelity here. "Introduced by" is a
 * *person* picker over `people:list` (migration 0009) — it was a company
 * picker, and an introduction is made by someone. One field the mockup does
 * have, "Budget note", is gone: the operator asked for it to go, and its
 * column is off the wire (`electron/shared/companies.ts`).
 */
export function CompanySheet({ onClose, target }: CompanySheetProps) {
  if (target.mode === 'edit') {
    return <CompanyEditSheet id={target.id} onClose={onClose} />
  }
  return <CompanyForm company={null} onClose={onClose} />
}

/** The sheet shell shown while the record for an edit is still loading, missing, or unreadable — same chrome, no fields to mislead with. */
function PlaceholderSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="Edit company"
      titleMeta="UPDATE companies"
      aria-label="Edit company"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <p className="meta">{children}</p>
    </Sheet>
  )
}

/**
 * Loads the company an edit was opened on, then mounts the form with it. The
 * form is not rendered at all until the record is in hand — see
 * `CompanySheet`'s comment for why that ordering, rather than an empty form
 * plus a populate effect, is the point of the split.
 */
function CompanyEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: queryKeys.companies.detail(id), queryFn: ipcQueryFn('companies:get', { id }) })

  if (query.isPending) return <PlaceholderSheet onClose={onClose}>Loading this company…</PlaceholderSheet>
  if (query.error) return <PlaceholderSheet onClose={onClose}>{query.error.message}</PlaceholderSheet>
  // `companies:get` answers `null` for an id nothing owns — a row deleted
  // between the page render and the click. Saying so beats an empty form.
  if (!query.data) return <PlaceholderSheet onClose={onClose}>This company no longer exists.</PlaceholderSheet>

  return <CompanyForm company={query.data} onClose={onClose} />
}

/** What `handleSubmit` hands the mutation: which channel, and the payload that channel takes. Two shapes, never one with a maybe-id. */
type CompanySubmission =
  | { readonly mode: 'create'; readonly input: CreateCompanyInput }
  | { readonly mode: 'edit'; readonly id: string; readonly patch: UpdateCompanyInput }

function CompanyForm({ company, onClose }: { company: Company | null; onClose: () => void }) {
  const formId = useId()
  // Never itself: edit mode is the first time this form has rendered a picker
  // on a page where the company being edited is one of the options, and a row
  // billed through itself or introduced by itself is not a relationship.
  const companies = useCompaniesList().filter((option) => option.id !== company?.id)
  const people = usePeopleList()
  const isEdit = company !== null

  // `company` never changes for a mounted form — `LayerManager` keys the sheet
  // by its target, so a different record is a different element — so this is a
  // stable snapshot of what every control below was seeded with.
  const seed = seedFrom(company)

  const [name, setName] = useState(seed.name)
  const [kind, setKind] = useState<CompanyKind>(seed.kind)
  const [website, setWebsite] = useState(seed.website)
  const [billsDirectly, setBillsDirectly] = useState(seed.billsDirectly)
  const [billedVia, setBilledVia] = useState(seed.billedVia)
  const [introducedBy, setIntroducedBy] = useState(seed.introducedBy)
  const [cadenceDays, setCadenceDays] = useState(seed.cadenceDays)
  const [since, setSince] = useState(seed.since)
  const [notes, setNotes] = useState(seed.notes)

  const { mutation, error, setError, errorFor } = useSheetMutation(
    'companies',
    (submission: CompanySubmission) =>
      submission.mode === 'edit'
        ? callCrm('companies:update', { id: submission.id, patch: submission.patch }).then(unwrapMutationResult)
        : callCrm('companies:create', submission.input).then(unwrapMutationResult),
    onClose,
    'Could not save this company.',
    FIELD_LABELS
  )

  /**
   * The cadence chips, plus whatever this company actually has if that is not
   * one of them (a 10-day cadence set by an import or by the inline editor
   * this form replaced), plus "Not set" on an edit. Without the first
   * addition the group would render with nothing selected and a save could
   * only ever move the value; without the second a cadence could never be
   * cleared again. `CADENCE_OPTIONS` itself is untouched, so a create still
   * offers exactly FORMS.company's four.
   */
  const cadenceOptions = isEdit
    ? [
        ...CADENCE_OPTIONS,
        ...(CADENCE_OPTIONS.some((option) => option.value === seed.cadenceDays) || seed.cadenceDays === CADENCE_NOT_SET
          ? []
          : [{ value: seed.cadenceDays, label: `${seed.cadenceDays} days` }]),
        { value: CADENCE_NOT_SET, label: 'Not set' }
      ]
    : CADENCE_OPTIONS

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // The submit button disables on `mutation.isPending`, but that's a render
    // away — two submit events dispatched before React commits that disabled
    // state (a fast double-click/double-Enter) would otherwise both reach
    // `mutation.mutate` and insert two rows. Belt-and-braces guard, checked
    // synchronously here rather than relying on the DOM.
    if (mutation.isPending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError({ field: 'name', message: `${FIELD_LABELS.name} is required` })
      return
    }
    setError(null)

    const partner = billsDirectly ? null : billedVia || null
    const cadence = cadenceDays === CADENCE_NOT_SET ? null : cadenceDays

    if (company) {
      // Only what actually moved, and only from the columns this form owns —
      // never the whole record, and never a control's own default standing in
      // for a column that was null (see `CompanyFormSeed`). An unchanged form
      // submits `{}`, which `updateCompany` treats as the no-op it is.
      const patch: UpdateCompanyInput = {}
      if (trimmedName !== seed.name) patch.name = trimmedName
      if (kind !== seed.kind) patch.kind = kind
      if (website.trim() !== seed.website) patch.website = website.trim() || null
      if (billsDirectly !== seed.billsDirectly) patch.billsDirectly = billsDirectly
      if (partner !== (seed.billsDirectly ? null : seed.billedVia || null)) patch.billedViaCompanyId = partner
      if (introducedBy !== seed.introducedBy) patch.introducedByPersonId = introducedBy || null
      if (cadenceDays !== seed.cadenceDays) patch.cadenceDays = cadence
      if (since !== seed.since) patch.since = since || null
      if (notes !== seed.notes) patch.notes = notes || null
      mutation.mutate({ mode: 'edit', id: company.id, patch })
      return
    }

    mutation.mutate({
      mode: 'create',
      input: {
        name: trimmedName,
        kind,
        website: website.trim() || null,
        billsDirectly,
        billedViaCompanyId: partner,
        introducedByPersonId: introducedBy || null,
        cadenceDays: cadence,
        since: since || null,
        notes: notes || null
      }
    })
  }

  const title = isEdit ? 'Edit company' : 'New company'

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title={title}
      titleMeta={isEdit ? 'UPDATE companies' : 'INSERT INTO companies'}
      aria-label={title}
      footerNote="saved locally"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create'}
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
              {companies.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="two">
          <Field label="Website" error={errorFor('website')}>
            <input className="inp" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="acme.com" />
          </Field>
          <Field label="Since" error={errorFor('since')}>
            <input className="inp" type="date" value={since} onChange={(event) => setSince(event.target.value)} />
          </Field>
        </div>
        {/* A person, from the People tab — a reference picker, so a real
            `<select>` (Field.tsx's rule), over `people:list`. */}
        <Field label="Introduced by" error={errorFor('introducedByPersonId')}>
          <select className="inp" value={introducedBy} onChange={(event) => setIntroducedBy(event.target.value)}>
            <option value="">— none —</option>
            {people.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
        <ChipField label="Reach out every" value={cadenceDays} onChange={setCadenceDays} options={cadenceOptions} />
        {/* Not in FORMS.company, and here because the Details card stopped
            writing (T-260901-14): this form owns every column that card shows
            or the decision costs the ability to edit one. */}
        <Field label="Notes" error={errorFor('notes')}>
          <textarea className="inp" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}
