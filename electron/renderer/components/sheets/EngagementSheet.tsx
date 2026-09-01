import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useCompaniesList } from './queries'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import type { SheetFormTarget } from '../shell/layer-manager-context'
import { centsToDecimalString, decimalStringToCents, formatDateOnly } from '../../../shared/format'
import {
  BILLING_MODELS,
  ENGAGEMENT_STATUSES,
  type BillingModel,
  type CreateEngagementInput,
  type Engagement,
  type EngagementStatus,
  type UpdateEngagementInput
} from '../../../shared/engagements'

const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed scope',
  tm: 'T&M',
  equity: 'Equity',
  none: 'None'
}
const BILLING_MODEL_OPTIONS = BILLING_MODELS.map((model) => ({ value: model, label: BILLING_MODEL_LABELS[model] }))

/** `lost` (G3) is deliberately present — `FORMS.engagement`'s own status `<select>` predates that decision and omits it (this task's Risks). */
const STATUS_LABELS: Record<EngagementStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  proposed: 'Proposed',
  held: 'Held',
  delivered: 'Delivered',
  lost: 'Lost'
}
const STATUS_OPTIONS = ENGAGEMENT_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))

/** `""` -> `null` (optional); a non-empty, non-finite, or negative value throws — caught by `handleSubmit` and shown as a named field error. */
function parseHours(raw: string, field: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field}: "${raw}" is not a valid number of hours`)
  }
  return value
}

/** `""` -> `null` (optional); delegates to `decimalStringToCents`, wrapping its error with the field name so the message names what failed. */
function parseCents(raw: string, field: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return decimalStringToCents(trimmed)
  } catch {
    throw new Error(`${field}: "${raw}" is not a valid amount`)
  }
}

/** The inverse of `parseHours` — a stored column back into what its input shows. `null` is an empty field, never a `"0"` the user did not type. */
function hoursToInput(value: number | null): string {
  return value == null ? '' : String(value)
}

/** The inverse of `parseCents`. Round-trips exactly (`16500` -> `"165.00"` -> `16500`), which is what lets the edit diff below tell an untouched amount from an edited one. */
function centsToInput(value: number | null): string {
  return value == null ? '' : centsToDecimalString(value)
}

export interface EngagementSheetProps {
  onClose: () => void
  /** New engagement, or one that already exists — see `SheetFormTarget`. */
  target: SheetFormTarget
}

/**
 * See `CompanySheet`'s `FIELD_LABELS` for the rule. This is the form the
 * finding was written against: `parseCents` throws
 * `contractValueCents: "$28,500" is not a valid amount`, and this table is
 * what turns that into "Contract value: …" rendered under the Contract value
 * input instead of a banner naming a column.
 */
const FIELD_LABELS = {
  name: 'Name',
  billingCompanyId: 'Billed to',
  clientCompanyId: 'Work is for',
  startedOn: 'Starts',
  endsOn: 'Ends',
  hoursIncluded: 'Hours included',
  contractValueCents: 'Contract value',
  hourlyRateCents: 'Hourly rate',
  estimatedHours: 'Estimated hours',
  notToExceedCents: 'Not to exceed'
} as const

/**
 * The billing-model discriminant travelling with exactly the columns that
 * model owns, and nothing else — the renderer-side mirror of
 * `electron/shared/engagements.ts`'s discriminated union. Built once by
 * `readModelPart` below and spread into both the create payload and the
 * update patch, so neither can carry another model's column and neither can
 * carry a column without the model that explains it.
 */
type ModelPart =
  | { readonly billingModel: 'retainer'; readonly hoursIncluded: number | null }
  | { readonly billingModel: 'fixed'; readonly contractValueCents: number | null }
  | {
      readonly billingModel: 'tm'
      readonly hourlyRateCents: number | null
      readonly estimatedHours: number | null
      readonly notToExceedCents: number | null
    }
  | { readonly billingModel: 'equity' }
  | { readonly billingModel: 'none' }

/** Every common column this form owns, as an update patch — `agreedRateCents` is not among them, by design (see this file's header). */
interface CommonPatch {
  name?: string
  billingCompanyId?: string | null
  clientCompanyId?: string | null
  status?: EngagementStatus
  startedOn?: string
  endsOn?: string | null
}

/** Does the selected model's own column set differ from what is stored? A model switch is handled separately — this asks only about the columns. */
function modelColumnsDiffer(part: ModelPart, engagement: Engagement): boolean {
  switch (part.billingModel) {
    case 'retainer':
      return part.hoursIncluded !== engagement.hoursIncluded
    case 'fixed':
      return part.contractValueCents !== engagement.contractValueCents
    case 'tm':
      return (
        part.hourlyRateCents !== engagement.hourlyRateCents ||
        part.estimatedHours !== engagement.estimatedHours ||
        part.notToExceedCents !== engagement.notToExceedCents
      )
    default:
      // equity and none own no columns of their own — nothing to compare.
      return false
  }
}

/** What `handleSubmit` hands the mutation: which channel, and the payload that channel takes. Two shapes, never one with a maybe-id. */
type EngagementSubmission =
  | { readonly mode: 'create'; readonly input: CreateEngagementInput }
  | { readonly mode: 'edit'; readonly id: string; readonly patch: UpdateEngagementInput }

/**
 * `.sheet` content for `FORMS.engagement`, in both of its modes
 * (T-260901-10): a blank create form, or the same form bound to an
 * engagement that already exists. Which one is decided by `target`, not by
 * whether an optional id happened to be passed — see `SheetFormTarget`.
 *
 * The split below is the seam. `EngagementSheet` resolves the target;
 * `EngagementEditSheet` loads the record (`engagements:get`) and renders
 * nothing but a placeholder until it has one; `EngagementForm` is the form
 * itself and never sees a mode it has to wait for — it takes the record, or
 * `null`, and seeds every field from it in a `useState` initialiser. That
 * ordering is what keeps the edit path off `react-hooks/set-state-in-effect`
 * (and off React's own advice): the form is *mounted* with the record
 * rather than mounted empty and filled in by an effect afterwards. A field
 * added later (the offering picker, T-260901-13; the milestone editor,
 * P3-09) is added to `EngagementForm` alone, seeded the same way.
 *
 * The one form-level decision worth restating (this task's Why): "Billed to"
 * (`billingCompanyId`) and "Work is for" (`clientCompanyId`) are two
 * separate selects, never coalesced into one "Company" field, because §5
 * makes them independent columns. "Work is for" mirrors "Billed to" until a
 * caller edits it directly (`clientTouched`), then holds its own value even
 * if "Billed to" changes afterwards — `FORMS.engagement`'s own
 * `syncClient()`, reproduced below as a render-time adjustment (React's
 * documented pattern for "adjusting state when a value changes": compare
 * against a `useState`-held previous value and call `setState` conditionally
 * during render, which `react-hooks/set-state-in-effect` treats differently
 * from the same call inside a `useEffect` body) rather than a DOM
 * `dataset.touched`.
 *
 * `billingModel` swaps in only the columns that model actually has
 * (`electron/shared/engagements.ts`'s discriminated union) — retainer's
 * `hoursIncluded`, fixed's `contractValueCents`, T&M's `hourlyRateCents` /
 * `estimatedHours` / `notToExceedCents`; equity and none carry no
 * model-specific column.
 *
 * **`agreedRateCents` is never presented and never sent, in either mode.**
 * `electron/shared/engagements.ts`'s header states why: it is a snapshot
 * taken at signature, writable on create and deliberately dropped by
 * `updateEngagement` even when the update schema accepts the key. A form
 * that echoed the whole record back would send it, the repository would
 * silently discard it, and a control that appears to change it would have
 * been a lie that looked like it worked. So this form owns a named set of
 * columns and sends only from that set — which is also why the update path
 * below builds a diff rather than posting the record it loaded.
 */
export function EngagementSheet({ onClose, target }: EngagementSheetProps) {
  if (target.mode === 'edit') {
    return <EngagementEditSheet id={target.id} onClose={onClose} />
  }
  return <EngagementForm engagement={null} onClose={onClose} />
}

/** The sheet shell shown while the record for an edit is still loading, missing, or unreadable — same chrome, no fields to mislead with. */
function PlaceholderSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="Edit engagement"
      titleMeta="UPDATE engagements"
      aria-label="Edit engagement"
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
 * Loads the engagement an edit was opened on, then mounts the form with it.
 * The form is not rendered at all until the record is in hand — see
 * `EngagementSheet`'s comment for why that ordering, rather than an empty
 * form plus a populate effect, is the whole point of the split.
 */
function EngagementEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: queryKeys.engagements.detail(id), queryFn: ipcQueryFn('engagements:get', { id }) })

  if (query.isPending) return <PlaceholderSheet onClose={onClose}>Loading this engagement…</PlaceholderSheet>
  if (query.error) return <PlaceholderSheet onClose={onClose}>{query.error.message}</PlaceholderSheet>
  // `engagements:get` answers `null` for an id nothing owns — a row deleted
  // between the list render and the click. Saying so beats an empty form.
  if (!query.data) return <PlaceholderSheet onClose={onClose}>This engagement no longer exists.</PlaceholderSheet>

  return <EngagementForm engagement={query.data} onClose={onClose} />
}

function EngagementForm({ engagement, onClose }: { engagement: Engagement | null; onClose: () => void }) {
  const formId = useId()
  const companies = useCompaniesList()
  const isEdit = engagement !== null

  const [name, setName] = useState(engagement?.name ?? '')
  const [billingCompanyId, setBillingCompanyId] = useState(engagement?.billingCompanyId ?? '')
  const [clientCompanyId, setClientCompanyId] = useState(engagement?.clientCompanyId ?? '')
  // On an existing engagement "Work is for" already holds a stored value of
  // its own, so the mirror starts switched off: changing "Billed to" on a
  // record must never silently overwrite a client company someone chose.
  const [clientTouched, setClientTouched] = useState(isEdit)
  // A stored `null` billing model shows as `none` — the value the create
  // schema uses for "no billing model" — rather than defaulting an existing
  // record into `retainer`, which would be a claim about it that nobody made.
  const [billingModel, setBillingModel] = useState<BillingModel>(engagement ? (engagement.billingModel ?? 'none') : 'retainer')
  const [status, setStatus] = useState<EngagementStatus>(engagement?.status ?? 'active')
  const [startedOn, setStartedOn] = useState(() => engagement?.startedOn ?? formatDateOnly(new Date()))
  const [endsOn, setEndsOn] = useState(engagement?.endsOn ?? '')
  const [hoursIncluded, setHoursIncluded] = useState(() => hoursToInput(engagement?.hoursIncluded ?? null))
  const [contractValue, setContractValue] = useState(() => centsToInput(engagement?.contractValueCents ?? null))
  const [hourlyRate, setHourlyRate] = useState(() => centsToInput(engagement?.hourlyRateCents ?? null))
  const [estimatedHours, setEstimatedHours] = useState(() => hoursToInput(engagement?.estimatedHours ?? null))
  const [notToExceed, setNotToExceed] = useState(() => centsToInput(engagement?.notToExceedCents ?? null))

  // "Work is for" mirrors "Billed to" until edited directly — adjusted
  // during render, not in an effect: `prevBillingCompanyId` is this
  // component's own record of what `billingCompanyId` was as of the last
  // render, so a real change is detected and reacted to within the same
  // render pass rather than one render late.
  const [prevBillingCompanyId, setPrevBillingCompanyId] = useState(billingCompanyId)
  if (billingCompanyId !== prevBillingCompanyId) {
    setPrevBillingCompanyId(billingCompanyId)
    if (!clientTouched) setClientCompanyId(billingCompanyId)
  }

  const { mutation, error, setError, setRawError, errorFor } = useSheetMutation(
    'engagements',
    (submission: EngagementSubmission) =>
      submission.mode === 'edit'
        ? callCrm('engagements:update', { id: submission.id, patch: submission.patch }).then(unwrapMutationResult)
        : callCrm('engagements:create', submission.input).then(unwrapMutationResult),
    onClose,
    'Could not save this engagement.',
    FIELD_LABELS
  )

  /** The selected model's own columns, parsed from this form's inputs. Throws `<payload key>: <detail>`, which `handleSubmit` places against the named field. */
  const readModelPart = (): ModelPart => {
    switch (billingModel) {
      case 'retainer':
        return { billingModel, hoursIncluded: parseHours(hoursIncluded, 'hoursIncluded') }
      case 'fixed':
        return { billingModel, contractValueCents: parseCents(contractValue, 'contractValueCents') }
      case 'tm':
        return {
          billingModel,
          hourlyRateCents: parseCents(hourlyRate, 'hourlyRateCents'),
          estimatedHours: parseHours(estimatedHours, 'estimatedHours'),
          notToExceedCents: parseCents(notToExceed, 'notToExceedCents')
        }
      default:
        return { billingModel }
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // See CompanySheet's identical guard.
    if (mutation.isPending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError({ field: 'name', message: `${FIELD_LABELS.name} is required` })
      return
    }
    if (!startedOn) {
      setError({ field: 'startedOn', message: `${FIELD_LABELS.startedOn} is required` })
      return
    }

    const billingCompany = billingCompanyId || null
    const clientCompany = clientCompanyId || null
    const ends = endsOn || null

    try {
      const modelPart = readModelPart()
      setError(null)

      if (engagement) {
        // Only what actually changed, and only from the columns this form
        // owns — never the whole record. See this file's header on
        // `agreedRateCents`: the update schema would accept it and the
        // repository would drop it without a word, so the fix is to not
        // build a payload that could contain it.
        const patch: CommonPatch = {}
        if (trimmedName !== engagement.name) patch.name = trimmedName
        if (billingCompany !== engagement.billingCompanyId) patch.billingCompanyId = billingCompany
        if (clientCompany !== engagement.clientCompanyId) patch.clientCompanyId = clientCompany
        if (status !== engagement.status) patch.status = status
        if (startedOn !== engagement.startedOn) patch.startedOn = startedOn
        if (ends !== engagement.endsOn) patch.endsOn = ends

        // A stored `null` model and a selected `none` say the same thing, so
        // that pairing is not a change — otherwise every save on a
        // model-less engagement would write a value nobody chose.
        const modelChanged = modelPart.billingModel !== (engagement.billingModel ?? 'none')
        // The model discriminant travels whenever any of its columns do:
        // `updateEngagementInputSchema`'s common-patch branch is `.strict()`
        // and holds no model-specific key, so `{ hoursIncluded: 12 }` on its
        // own matches no branch at all. Sending them together also gets the
        // repository's reset behaviour right — on a real switch it NULLs the
        // outgoing model's columns rather than leaving them stale.
        const full: UpdateEngagementInput =
          modelChanged || modelColumnsDiffer(modelPart, engagement) ? { ...patch, ...modelPart } : patch
        mutation.mutate({ mode: 'edit', id: engagement.id, patch: full })
        return
      }

      const common = {
        name: trimmedName,
        billingCompanyId: billingCompany,
        clientCompanyId: clientCompany,
        status,
        startedOn,
        endsOn: ends
      }
      mutation.mutate({ mode: 'create', input: { ...common, ...modelPart } })
    } catch (err) {
      // `parseCents`/`parseHours` throw `<payload key>: <detail>`, the same
      // shape a repository ValidationError arrives in, so both are placed
      // against their own field by the same table.
      setRawError(err instanceof Error ? err.message : 'Check the amounts entered.')
    }
  }

  const title = isEdit ? 'Edit engagement' : 'New engagement'

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title={title}
      titleMeta={isEdit ? 'UPDATE engagements' : 'INSERT INTO engagements'}
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
        {/* Only a failure no field owns — see CompanySheet's identical banner. */}
        {error?.field == null && error && (
          <div className="field-error" role="alert">
            {error.message}
          </div>
        )}
        <Field label="Name" error={errorFor('name')}>
          <input className="inp" value={name} onChange={(event) => setName(event.target.value)} placeholder="Fixed scope SOW" />
        </Field>
        <div className="two">
          <Field label="Billed to" error={errorFor('billingCompanyId')}>
            <select className="inp" value={billingCompanyId} onChange={(event) => setBillingCompanyId(event.target.value)}>
              <option value="">— none —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Work is for" error={errorFor('clientCompanyId')}>
            <select
              className="inp"
              value={clientCompanyId}
              onChange={(event) => {
                setClientTouched(true)
                setClientCompanyId(event.target.value)
              }}
            >
              <option value="">— none —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ChipField label="Billing model" value={billingModel} onChange={setBillingModel} options={BILLING_MODEL_OPTIONS} />
        {billingModel === 'retainer' && (
          <Field label="Hours included" error={errorFor('hoursIncluded')}>
            <input
              className="inp"
              value={hoursIncluded}
              onChange={(event) => setHoursIncluded(event.target.value)}
              placeholder="12"
            />
          </Field>
        )}
        {billingModel === 'fixed' && (
          <Field label="Contract value" error={errorFor('contractValueCents')}>
            <input
              className="inp"
              value={contractValue}
              onChange={(event) => setContractValue(event.target.value)}
              placeholder="28500"
            />
          </Field>
        )}
        {billingModel === 'tm' && (
          <>
            <div className="two">
              <Field label="Hourly rate" error={errorFor('hourlyRateCents')}>
                <input
                  className="inp"
                  value={hourlyRate}
                  onChange={(event) => setHourlyRate(event.target.value)}
                  placeholder="165"
                />
              </Field>
              <Field label="Estimated hours" error={errorFor('estimatedHours')}>
                <input
                  className="inp"
                  value={estimatedHours}
                  onChange={(event) => setEstimatedHours(event.target.value)}
                  placeholder="30"
                />
              </Field>
            </div>
            <Field label="Not to exceed" error={errorFor('notToExceedCents')}>
              <input
                className="inp"
                value={notToExceed}
                onChange={(event) => setNotToExceed(event.target.value)}
                placeholder="6000"
              />
            </Field>
          </>
        )}
        <ChipField label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <div className="two">
          <Field label="Starts" error={errorFor('startedOn')}>
            <input className="inp" type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} />
          </Field>
          <Field label="Ends" error={errorFor('endsOn')}>
            <input className="inp" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </Field>
        </div>
        <div className="meta">Leave the end date empty for rolling work.</div>
      </form>
    </Sheet>
  )
}
