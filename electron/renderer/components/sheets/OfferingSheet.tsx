import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sheet } from '../primitives/Sheet'
import { Button } from '../primitives/Button'
import { Field, ChipField } from './Field'
import { useSheetMutation } from './useSheetMutation'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import type { SheetFormTarget } from '../shell/layer-manager-context'
import { decimalStringToCents } from '../../../shared/format'
import { BILLING_MODEL_LABEL, TYPE_LABEL, UNIT_LABEL, formatRate } from '../../views/offerings-display'
import {
  OFFERING_BILLING_MODELS,
  OFFERING_TYPES,
  OFFERING_UNITS,
  type CreateOfferingInput,
  type OfferingBillingModel,
  type OfferingCategory,
  type OfferingType,
  type OfferingUnit,
  type OfferingWithVersions,
  type UpdateOfferingInput
} from '../../../shared/offerings'
import './OfferingSheet.css'

/**
 * `FORMS.service` (planning/solo-crm-mockup.html) in both of its modes,
 * following `EngagementSheet`'s create/edit split exactly: `OfferingSheet`
 * resolves the target, `OfferingEditSheet` loads the record before mounting
 * anything with fields in it, and `OfferingForm` seeds every field from that
 * record in a `useState` initialiser rather than from an effect. See
 * `EngagementSheet`'s header for why that ordering is the point of the split.
 *
 * **A rate is written here on create and nowhere else, ever.**
 * `updateOfferingInputSchema` has no `rateCents` key and is `.strict()`, so
 * an edit that carried one would be refused rather than ignored — but the
 * reason the field is absent from the edit form is not that the wire would
 * reject it. §6.5 makes changing a price a distinct action that closes the
 * current version and appends the next with an effective date, so that
 * signed engagements keep the rate they were sold at; P3-02 builds the
 * versioning and P3-08 builds the sheet. Until both exist, a rate input on
 * this form would either do nothing or rewrite history in place. What edit
 * mode shows instead is the current price, read-only, beside a disabled
 * "Change price" control and a caption saying why — the shape
 * `WorkspaceSettings`' backup folder already uses for an action whose
 * machinery is not built.
 */

/** Stable empty fallback for the still-loading category list — a fresh `[]` would be a new reference on every render. */
const EMPTY_CATEGORIES: readonly OfferingCategory[] = []

const TYPE_OPTIONS = OFFERING_TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type] }))
const BILLING_MODEL_OPTIONS = OFFERING_BILLING_MODELS.map((model) => ({ value: model, label: BILLING_MODEL_LABEL[model] }))
const UNIT_OPTIONS = OFFERING_UNITS.map((unit) => ({ value: unit, label: UNIT_LABEL[unit] }))

/** See `CompanySheet`'s `FIELD_LABELS` for the rule: payload key -> the label this form puts on the control that writes it. */
const FIELD_LABELS = {
  name: 'Name',
  type: 'Type',
  categoryId: 'Category',
  billingModel: 'Billing model',
  unit: 'Rate unit',
  blurb: 'Blurb',
  rateCents: 'Rate'
} as const

/** What `handleSubmit` hands the mutation: which channel, and that channel's payload. Two shapes, never one with a maybe-id. */
type OfferingSubmission =
  | { readonly mode: 'create'; readonly input: CreateOfferingInput }
  | { readonly mode: 'edit'; readonly id: string; readonly patch: UpdateOfferingInput }

export interface OfferingSheetProps {
  onClose: () => void
  /** New offering, or one that already exists — see `SheetFormTarget`. */
  target: SheetFormTarget
}

export function OfferingSheet({ onClose, target }: OfferingSheetProps) {
  if (target.mode === 'edit') {
    return <OfferingEditSheet id={target.id} onClose={onClose} />
  }
  return <OfferingForm offering={null} onClose={onClose} />
}

/** The sheet shell shown while an edit's record is still loading, missing, or unreadable — same chrome, no fields to mislead with. */
function PlaceholderSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title="Edit offering"
      titleMeta="UPDATE offerings"
      aria-label="Edit offering"
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

function OfferingEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: queryKeys.offerings.detail(id), queryFn: ipcQueryFn('offerings:get', { id }) })

  if (query.isPending) return <PlaceholderSheet onClose={onClose}>Loading this offering…</PlaceholderSheet>
  if (query.error) return <PlaceholderSheet onClose={onClose}>{query.error.message}</PlaceholderSheet>
  // `offerings:get` answers `null` for an id nothing owns — nothing in this
  // catalogue is deleted, but a database edited elsewhere can still lose one.
  if (!query.data) return <PlaceholderSheet onClose={onClose}>This offering no longer exists.</PlaceholderSheet>

  return <OfferingForm offering={query.data} onClose={onClose} />
}

/**
 * The current price as the edit form reports it: the same version
 * `offerings:list` calls `currentVersion` (this record's `versions[0]` — the
 * repository orders the history newest first).
 */
function currentRateLabel(offering: OfferingWithVersions): string {
  const current = offering.versions[0]
  if (!current || current.rateCents == null) return '—'
  const rate = formatRate(offering.unit, current.rateCents)
  return current.version == null ? rate : `${rate} · v${current.version}`
}

function OfferingForm({ offering, onClose }: { offering: OfferingWithVersions | null; onClose: () => void }) {
  const formId = useId()
  const isEdit = offering !== null

  // The category picker is a reference list, not an enumeration, so it stays
  // a real `<select>` (Field.tsx's `ChipField` comment states that rule).
  // Read here rather than passed in: the sheet can be opened from the New
  // menu, where no view has fetched categories yet.
  const categoriesQuery = useQuery({
    queryKey: queryKeys.offerings.categories(),
    queryFn: ipcQueryFn('offerings:listCategories')
  })
  const categories: readonly OfferingCategory[] = categoriesQuery.data ?? EMPTY_CATEGORIES

  const [name, setName] = useState(offering?.name ?? '')
  // A stored `null` shows as the create default rather than being invented
  // into a claim nobody made — except that the wire allows `null` and the
  // chip groups do not, so an existing null is preserved by only sending the
  // field when it actually changed (see the patch build below).
  const [type, setType] = useState<OfferingType>(offering?.type ?? 'service')
  const [categoryId, setCategoryId] = useState(offering?.categoryId ?? '')
  const [billingModel, setBillingModel] = useState<OfferingBillingModel>(offering?.billingModel ?? 'fixed')
  const [unit, setUnit] = useState<OfferingUnit>(offering?.unit ?? 'fixed')
  const [blurb, setBlurb] = useState(offering?.blurb ?? '')
  /** Create only. Dollars as typed; `decimalStringToCents` is what makes it the integer cents the wire takes. */
  const [rate, setRate] = useState('')

  const { mutation, error, setError, setRawError, errorFor } = useSheetMutation(
    'offerings',
    (submission: OfferingSubmission) =>
      submission.mode === 'edit'
        ? callCrm('offerings:update', { id: submission.id, patch: submission.patch }).then(unwrapMutationResult)
        : callCrm('offerings:create', submission.input).then(unwrapMutationResult),
    onClose,
    'Could not save this offering.',
    FIELD_LABELS
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    // See CompanySheet's identical guard.
    if (mutation.isPending) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError({ field: 'name', message: `${FIELD_LABELS.name} is required` })
      return
    }

    const category = categoryId || null
    const trimmedBlurb = blurb.trim() || null

    if (offering) {
      // Only what changed, and only from the columns this form owns. A stored
      // `null` type/model/unit that the chip group is merely *showing* a
      // default for is not a change, so opening an edit and saving it does
      // not quietly write three values nobody chose.
      const patch: UpdateOfferingInput = {}
      if (trimmedName !== offering.name) patch.name = trimmedName
      if (offering.type != null && type !== offering.type) patch.type = type
      if (offering.type == null && type !== 'service') patch.type = type
      if (category !== offering.categoryId) patch.categoryId = category
      if (offering.billingModel != null && billingModel !== offering.billingModel) patch.billingModel = billingModel
      if (offering.billingModel == null && billingModel !== 'fixed') patch.billingModel = billingModel
      if (offering.unit != null && unit !== offering.unit) patch.unit = unit
      if (offering.unit == null && unit !== 'fixed') patch.unit = unit
      if (trimmedBlurb !== offering.blurb) patch.blurb = trimmedBlurb
      setError(null)
      mutation.mutate({ mode: 'edit', id: offering.id, patch })
      return
    }

    let rateCents: number
    try {
      rateCents = decimalStringToCents(rate.trim())
    } catch {
      // Named against the payload key so `toSheetError` places it under the
      // Rate field rather than in the sheet-level banner.
      setRawError(`rateCents: "${rate}" is not a valid amount`)
      return
    }
    setError(null)
    mutation.mutate({
      mode: 'create',
      input: { name: trimmedName, type, categoryId: category, billingModel, unit, blurb: trimmedBlurb, rateCents }
    })
  }

  const title = isEdit ? 'Edit offering' : 'New offering'

  return (
    <Sheet
      open
      onClose={onClose}
      closeOnEscape={false}
      title={title}
      titleMeta={isEdit ? 'UPDATE offerings' : 'INSERT INTO offerings'}
      aria-label={title}
      footerNote={isEdit ? 'price unchanged' : 'sets version 1'}
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
        <Field label={FIELD_LABELS.name} error={errorFor('name')}>
          <input className="inp" value={name} onChange={(event) => setName(event.target.value)} placeholder="Discovery Audit" />
        </Field>
        <ChipField label={FIELD_LABELS.type} value={type} onChange={setType} options={TYPE_OPTIONS} />
        <Field label={FIELD_LABELS.categoryId} error={errorFor('categoryId')}>
          <select className="inp" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">— none —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name ?? category.id}
              </option>
            ))}
          </select>
        </Field>
        <ChipField
          label={FIELD_LABELS.billingModel}
          value={billingModel}
          onChange={setBillingModel}
          options={BILLING_MODEL_OPTIONS}
        />
        <ChipField label={FIELD_LABELS.unit} value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
        {offering ? <PriceBlock offering={offering} /> : (
          <Field label={FIELD_LABELS.rateCents} error={errorFor('rateCents')}>
            <input className="inp" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="4500" />
          </Field>
        )}
        <Field label={FIELD_LABELS.blurb} error={errorFor('blurb')}>
          <textarea
            className="inp"
            rows={2}
            value={blurb}
            onChange={(event) => setBlurb(event.target.value)}
            placeholder="Map a business for automation opportunity."
          />
        </Field>
        {!offering && <div className="meta">The rate becomes version 1. Changing it later appends a version instead of overwriting this one.</div>}
      </form>
    </Sheet>
  )
}

/**
 * The read-only current price and the disabled action that would change it —
 * `WorkspaceSettings`' backup-folder shape (a value, a disabled control that
 * says why, and a caption underneath), for the same reason: the machinery
 * behind the action does not exist yet, and a control that appeared to work
 * would write a version with none of §6.5's effective-date semantics.
 */
function PriceBlock({ offering }: { offering: OfferingWithVersions }) {
  return (
    <div>
      <span className="f-lab">Price</span>
      <div className="offr-price-row">
        <span className="mono offr-price-now">{currentRateLabel(offering)}</span>
        <Button
          variant="ghost"
          disabled
          aria-disabled="true"
          title="Not built yet — a price change closes this version and appends the next with an effective date (P3-08)"
        >
          Change price
        </Button>
      </div>
      <p className="meta">
        Prices are versioned, so changing one is its own action — not a field here. Engagements keep the rate they were signed at.
      </p>
    </div>
  )
}
