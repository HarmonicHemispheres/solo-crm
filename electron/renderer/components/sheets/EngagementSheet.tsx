import { useId, useState, type FormEvent } from 'react'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useCompaniesList } from './queries'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, unwrapMutationResult } from '../../lib/ipc'
import { decimalStringToCents, formatDateOnly } from '../../../shared/format'
import { BILLING_MODELS, ENGAGEMENT_STATUSES, type BillingModel, type CreateEngagementInput, type EngagementStatus } from '../../../shared/engagements'

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

export interface EngagementSheetProps {
  onClose: () => void
}

/**
 * `.sheet` content for `FORMS.engagement` — the one form with a schema
 * decision in it (this task's Why): "Billed to" (`billingCompanyId`) and
 * "Work is for" (`clientCompanyId`) are two separate selects, never
 * coalesced into one "Company" field, because §5 makes them independent
 * columns. "Work is for" mirrors "Billed to" until a caller edits it
 * directly (`clientTouched`), then holds its own value even if "Billed to"
 * changes afterwards — `FORMS.engagement`'s own `syncClient()`, reproduced
 * below as a render-time adjustment (React's documented pattern for
 * "adjusting state when a value changes": compare against a `useState`-held
 * previous value and call `setState` conditionally during render, which
 * `react-hooks/set-state-in-effect` treats differently from the same call
 * inside a `useEffect` body) rather than a DOM `dataset.touched`.
 *
 * `billingModel` swaps in only the columns that model actually has
 * (`electron/shared/engagements.ts`'s discriminated union) — retainer's
 * `hoursIncluded`, fixed's `contractValueCents`, T&M's `hourlyRateCents` /
 * `estimatedHours` / `notToExceedCents`; equity and none carry no
 * model-specific column. `agreedRateCents` is out of this form's scope
 * entirely (this task's scope lists no "rate" field for any model) and is
 * simply never sent — the repository defaults an absent key to `NULL` on
 * create, the same as every other omitted optional column.
 *
 * `LayerManager` mounts this only while the `sheet` layer is open, same as
 * `CompanySheet` — see that component's comment for why that (not an `open`
 * prop plus a reset effect) is what gives every open a blank form.
 */
export function EngagementSheet({ onClose }: EngagementSheetProps) {
  const formId = useId()
  const companies = useCompaniesList()

  const [name, setName] = useState('')
  const [billingCompanyId, setBillingCompanyId] = useState('')
  const [clientCompanyId, setClientCompanyId] = useState('')
  const [clientTouched, setClientTouched] = useState(false)
  const [billingModel, setBillingModel] = useState<BillingModel>('retainer')
  const [status, setStatus] = useState<EngagementStatus>('active')
  const [startedOn, setStartedOn] = useState(() => formatDateOnly(new Date()))
  const [endsOn, setEndsOn] = useState('')
  const [hoursIncluded, setHoursIncluded] = useState('')
  const [contractValue, setContractValue] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [notToExceed, setNotToExceed] = useState('')

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

  const { mutation, error, setError } = useSheetMutation(
    'engagements',
    (input: CreateEngagementInput) => callCrm('engagements:create', input).then(unwrapMutationResult),
    onClose,
    'Could not save this engagement.'
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // See CompanySheet's identical guard.
    if (mutation.isPending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('name: name is required')
      return
    }
    if (!startedOn) {
      setError('startedOn: startedOn is required')
      return
    }

    const common = {
      name: trimmedName,
      billingCompanyId: billingCompanyId || null,
      clientCompanyId: clientCompanyId || null,
      status,
      startedOn,
      endsOn: endsOn || null
    }

    try {
      let payload: CreateEngagementInput
      if (billingModel === 'retainer') {
        payload = { ...common, billingModel: 'retainer', hoursIncluded: parseHours(hoursIncluded, 'hoursIncluded') }
      } else if (billingModel === 'fixed') {
        payload = { ...common, billingModel: 'fixed', contractValueCents: parseCents(contractValue, 'contractValueCents') }
      } else if (billingModel === 'tm') {
        payload = {
          ...common,
          billingModel: 'tm',
          hourlyRateCents: parseCents(hourlyRate, 'hourlyRateCents'),
          estimatedHours: parseHours(estimatedHours, 'estimatedHours'),
          notToExceedCents: parseCents(notToExceed, 'notToExceedCents')
        }
      } else {
        payload = { ...common, billingModel }
      }
      setError(null)
      mutation.mutate(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the amounts entered.')
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="New engagement"
      titleMeta="INSERT INTO engagements"
      aria-label="New engagement"
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
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        <Field label="Name">
          <input className="inp" value={name} onChange={(event) => setName(event.target.value)} placeholder="Fixed scope SOW" />
        </Field>
        <div className="two">
          <Field label="Billed to">
            <select className="inp" value={billingCompanyId} onChange={(event) => setBillingCompanyId(event.target.value)}>
              <option value="">— none —</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Work is for">
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
          <Field label="Hours included">
            <input
              className="inp"
              value={hoursIncluded}
              onChange={(event) => setHoursIncluded(event.target.value)}
              placeholder="12"
            />
          </Field>
        )}
        {billingModel === 'fixed' && (
          <Field label="Contract value">
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
              <Field label="Hourly rate">
                <input
                  className="inp"
                  value={hourlyRate}
                  onChange={(event) => setHourlyRate(event.target.value)}
                  placeholder="165"
                />
              </Field>
              <Field label="Estimated hours">
                <input
                  className="inp"
                  value={estimatedHours}
                  onChange={(event) => setEstimatedHours(event.target.value)}
                  placeholder="30"
                />
              </Field>
            </div>
            <Field label="Not to exceed">
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
          <Field label="Starts">
            <input className="inp" type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} />
          </Field>
          <Field label="Ends">
            <input className="inp" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </Field>
        </div>
        <div className="meta">Leave the end date empty for rolling work.</div>
      </form>
    </Sheet>
  )
}
