import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseDateOnly } from '../../shared/format'
import { COMPANY_KINDS, type Company, type CompanyKind, type UpdateCompanyInput } from '../../shared/companies'
import type { BillingModel, Engagement, EngagementStatus } from '../../shared/engagements'
import { ipcMutationFn, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { Card } from '../components/primitives/Card'
import { Chip } from '../components/primitives/Chip'
import { ModelTag, type BillingModel as ModelTagBillingModel } from '../components/primitives/ModelTag'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { EmptyState } from '../components/primitives/EmptyState'
import { DecayMeter } from '../components/primitives/DecayMeter'
import { Toast } from '../components/primitives/Toast'
import './CompanyDetail.css'

/**
 * `/company/:id` (T-260828-29) — the view that proves split billing is real:
 * *billed here* and *delivered here, billed elsewhere* have to read
 * correctly from either side of the same engagement row. See this task's
 * Risks: the two sections are two independently server-filtered
 * `engagements:list` calls (`billingCompanyId` / `clientCompanyId`), not one
 * unfiltered list sliced two ways in this component — that shortcut is
 * exactly the bug whose page still looks plausible.
 *
 * Out of this task's scope (T-260828-30 owns the rest of this page): todos,
 * activity timeline, contacts, links, and any revenue or hours figure —
 * ADR-003 puts every revenue question through `revenue_lines`, not
 * per-billing-model branching rendered here.
 */

// ---------------------------------------------------------------------------
// Local display helpers — `hue`/`initials`/`mark` are planning/solo-crm-
// mockup.html's own page-level helpers (lines ~928-934), kept local to this
// view rather than promoted to a shared module: no other view exists yet to
// share them with, and T-260828-28 (Companies view) is an independent
// concurrent branch — see this task's worktree notes.
// ---------------------------------------------------------------------------

const MARK_PALETTE = ['var(--verdigris)', 'var(--lapis)', 'var(--verdigris-dim)', 'var(--slate)', 'var(--lapis-deep)'] as const

function hue(name: string): string {
  let sum = 0
  for (const char of name) sum += char.charCodeAt(0)
  return MARK_PALETTE[sum % MARK_PALETTE.length]
}

function initials(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}

type StyleWithAccent = CSSProperties & { '--c': string }

function CompanyMark({ name, size, color }: { name: string; size: number; color: string }) {
  return (
    <span className="cmark" style={{ width: size, height: size, fontSize: Math.round(size * 0.37), color }}>
      <span>{initials(name)}</span>
    </span>
  )
}

/** The mockup's `VIA_ICON` (planning/solo-crm-mockup.html line ~939) — a
 * small "redirected" glyph in front of every billed-elsewhere marker. */
function ViaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--lapis)" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" width={11} height={11}>
      <path d="M7 7h6a4 4 0 014 4v6M17 17l-3-3M17 17l3-3" />
    </svg>
  )
}

const KIND_LABEL: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}

const KIND_TAG_VARIANT: Record<CompanyKind, TagVariant> = {
  client: 'verd',
  prospect: 'gold',
  end_client: 'lapis',
  advisory: 'lapis',
  channel: 'lapis'
}

const STATUS_LABEL: Record<EngagementStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  proposed: 'Proposed',
  held: 'Held',
  delivered: 'Delivered',
  lost: 'Lost'
}

const STATUS_TAG_VARIANT: Record<EngagementStatus, TagVariant> = {
  active: 'green',
  pending: 'orange',
  proposed: 'orange',
  held: 'gold',
  delivered: 'default',
  lost: 'red'
}

const MODEL_LABEL: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed',
  tm: 'T&M',
  equity: 'Equity',
  none: '—'
}

/** `ModelTag` only draws the four models that get a colour (mockup's `.m-*`
 * set) — `'none'` has no swatch of its own, so an engagement with no
 * billing model just shows no model pill rather than a blank grey one. */
function isTaggableModel(model: BillingModel | null): model is ModelTagBillingModel {
  return model != null && model !== 'none'
}

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** UTC-formatted so a `YYYY-MM-DD` value never shifts a day under a
 * negative-UTC-offset local timezone (see `electron/shared/format.ts`'s own
 * header on exactly this bug). */
function formatMonthYear(dateOnly: string): string {
  return MONTH_YEAR_FORMAT.format(parseDateOnly(dateOnly))
}

/**
 * `endsOn: null` means rolling, never a blank or a missing date (this
 * task's Risks, and `electron/shared/engagements.ts`'s header) — the one
 * place that meaning is rendered.
 */
function formatRange(startedOn: string, endsOn: string | null): string {
  return `${formatMonthYear(startedOn)} → ${endsOn ? formatMonthYear(endsOn) : 'rolling'}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Cadence state for the header's `DecayMeter` — same thresholds as the
 * mockup's own `decay()` (>=1 late, >=.7 warn, else ok), reproduced by
 * `DecayMeter` itself; this only computes the raw fraction and label.
 * Missing `lastTouchAt` or a zero/`null` `cadenceDays` reads as maximally
 * stale (ADR-001), matching `DecayMeter`'s own non-finite handling. */
function cadenceState(lastTouchAt: string | null, cadenceDays: number | null, now: number): { pct: number; label: string } {
  if (lastTouchAt == null) return { pct: Number.POSITIVE_INFINITY, label: 'no contact logged' }
  const days = Math.floor((now - new Date(lastTouchAt).getTime()) / DAY_MS)
  const pct = cadenceDays ? days / cadenceDays : Number.POSITIVE_INFINITY
  return { pct, label: days <= 0 ? 'today' : `${days}d` }
}

// ---------------------------------------------------------------------------
// Details card — inline edit
// ---------------------------------------------------------------------------

type TextFieldKey = 'website' | 'cadenceDays' | 'since' | 'budgetNote' | 'notes'

const TEXT_FIELD_CONFIG: Record<TextFieldKey, { label: string; type: 'text' | 'number' | 'date' | 'textarea'; placeholder?: string }> = {
  website: { label: 'Website', type: 'text', placeholder: 'example.com' },
  cadenceDays: { label: 'Cadence', type: 'number', placeholder: 'Days' },
  since: { label: 'Since', type: 'date' },
  budgetNote: { label: 'Budget', type: 'text' },
  notes: { label: 'Notes', type: 'textarea' }
}

/** The raw, edit-ready string for a text field — `''` stands in for `null`
 * in every case below, and every commit path below maps `''` back to
 * `null` on the way out, so "field is empty" round-trips instead of
 * writing the literal string `"null"`. */
function rawValueOf(company: Company, key: TextFieldKey): string {
  switch (key) {
    case 'website':
      return company.website ?? ''
    case 'cadenceDays':
      return company.cadenceDays != null ? String(company.cadenceDays) : ''
    case 'since':
      return company.since ?? ''
    case 'budgetNote':
      return company.budgetNote ?? ''
    case 'notes':
      return company.notes ?? ''
  }
}

function displayValueOf(company: Company, key: TextFieldKey): ReactNode {
  const raw = rawValueOf(company, key)
  if (raw === '') return '—'
  if (key === 'cadenceDays') return `${raw} days`
  return raw
}

type PatchResult = { ok: true; patch: UpdateCompanyInput } | { ok: false; error: string }

/** Builds the one-column patch a commit sends — the acceptance guard this
 * task's Risks names ("writes only the columns it shows"): each field
 * commits its own key alone, never the whole card's state. `ok: false`
 * signals a validation failure the caller should show instead of mutating
 * (cadenceDays must be a positive whole number, matching
 * `companyWritableFieldsSchema`) — a literal `ok` discriminant rather than
 * an optional `error` field so the two branches narrow cleanly at the call
 * site. */
function buildPatch(key: TextFieldKey, raw: string): PatchResult {
  const trimmed = raw.trim()
  switch (key) {
    case 'website':
      return { ok: true, patch: { website: trimmed === '' ? null : trimmed } }
    case 'cadenceDays': {
      if (trimmed === '') return { ok: true, patch: { cadenceDays: null } }
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: 'Cadence must be a positive whole number of days.' }
      }
      return { ok: true, patch: { cadenceDays: parsed } }
    }
    case 'since':
      return { ok: true, patch: { since: trimmed === '' ? null : trimmed } }
    case 'budgetNote':
      return { ok: true, patch: { budgetNote: trimmed === '' ? null : trimmed } }
    case 'notes':
      return { ok: true, patch: { notes: trimmed === '' ? null : trimmed } }
  }
}

function DetailField({
  fieldKey,
  company,
  editingKey,
  onStartEdit,
  onCommit,
  onCancel,
  fieldError
}: {
  fieldKey: TextFieldKey
  company: Company
  editingKey: TextFieldKey | null
  onStartEdit: (key: TextFieldKey) => void
  onCommit: (key: TextFieldKey, raw: string) => void
  onCancel: () => void
  fieldError: string | null
}) {
  const config = TEXT_FIELD_CONFIG[fieldKey]
  const isEditing = editingKey === fieldKey
  const [draft, setDraft] = useState(() => rawValueOf(company, fieldKey))

  if (!isEditing) {
    return (
      <div className="field">
        <span className="k">{config.label}</span>
        <span className="v">
          <button
            type="button"
            className="field-value-btn"
            onClick={() => {
              setDraft(rawValueOf(company, fieldKey))
              onStartEdit(fieldKey)
            }}
          >
            {displayValueOf(company, fieldKey)}
          </button>
        </span>
      </div>
    )
  }

  const commit = () => onCommit(fieldKey, draft)
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && config.type !== 'textarea') {
      event.preventDefault()
      commit()
    }
  }

  return (
    <div className="field">
      <span className="k">{config.label}</span>
      <span className="v">
        {config.type === 'textarea' ? (
          <textarea
            className="field-input"
            value={draft}
            autoFocus
            aria-label={config.label}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <input
            className="field-input"
            type={config.type}
            value={draft}
            autoFocus
            placeholder={config.placeholder}
            aria-label={config.label}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          />
        )}
        {fieldError != null && <span className="field-error">{fieldError}</span>}
      </span>
    </div>
  )
}

function DetailsCard({ companyId, company, companiesById }: { companyId: string; company: Company; companiesById: Map<string, Company> }) {
  const queryClient = useQueryClient()
  const [editingKey, setEditingKey] = useState<TextFieldKey | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const updateCompany = useMutation({
    mutationFn: (patch: UpdateCompanyInput) =>
      ipcMutationFn('companies:update')({ id: companyId, patch }).then(unwrapMutationResult),
    onSuccess: () => invalidate.companies(queryClient)
  })

  const commitField = (key: TextFieldKey, raw: string) => {
    if (raw === rawValueOf(company, key)) {
      setEditingKey(null)
      setFieldError(null)
      return
    }
    const built = buildPatch(key, raw)
    if (!built.ok) {
      setFieldError(built.error)
      return
    }
    setFieldError(null)
    setEditingKey(null)
    updateCompany.mutate(built.patch)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setFieldError(null)
  }

  const billedVia = company.billedViaCompanyId != null ? companiesById.get(company.billedViaCompanyId) : undefined
  const introducedBy = company.introducedByCompanyId != null ? companiesById.get(company.introducedByCompanyId) : undefined

  return (
    <Card>
      <Card.Header title="Details" />
      <div className="field">
        <span className="k">Kind</span>
        <span className="v">
          <div className="chiprow">
            {COMPANY_KINDS.map((kind) => (
              <Chip
                key={kind}
                selected={company.kind === kind}
                onClick={() => updateCompany.mutate({ kind })}
              >
                {KIND_LABEL[kind]}
              </Chip>
            ))}
          </div>
        </span>
      </div>
      {(['website', 'cadenceDays', 'since', 'budgetNote', 'notes'] as const).map((key) => (
        <DetailField
          key={key}
          fieldKey={key}
          company={company}
          editingKey={editingKey}
          onStartEdit={(k) => {
            setFieldError(null)
            setEditingKey(k)
          }}
          onCommit={commitField}
          onCancel={cancelEdit}
          fieldError={editingKey === key ? fieldError : null}
        />
      ))}
      <div className="field">
        <span className="k">Billed via</span>
        <span className="v">
          {company.billedViaCompanyId != null ? (
            <Link to={`/company/${company.billedViaCompanyId}`}>{billedVia?.name ?? company.billedViaCompanyId}</Link>
          ) : (
            '—'
          )}
        </span>
      </div>
      <div className="field">
        <span className="k">Introduced by</span>
        <span className="v">
          {company.introducedByCompanyId != null ? (
            <Link to={`/company/${company.introducedByCompanyId}`}>{introducedBy?.name ?? company.introducedByCompanyId}</Link>
          ) : (
            '—'
          )}
        </span>
      </div>
      <Toast message={updateCompany.isError ? updateCompany.error.message : null} onDismiss={() => updateCompany.reset()} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Engagement cards — billed here / delivered here, billed elsewhere
// ---------------------------------------------------------------------------

function EngagementRow({ engagement, viaLabel }: { engagement: Engagement; viaLabel: string | null }) {
  return (
    <div className="eng">
      <div className="eng-t">
        <span className="nm trunc">{engagement.name}</span>
        {isTaggableModel(engagement.billingModel) && (
          <ModelTag model={engagement.billingModel}>{MODEL_LABEL[engagement.billingModel]}</ModelTag>
        )}
        {engagement.status != null && <Tag variant={STATUS_TAG_VARIANT[engagement.status]}>{STATUS_LABEL[engagement.status]}</Tag>}
      </div>
      {viaLabel != null && (
        <div className="via">
          <ViaIcon />
          {viaLabel}
        </div>
      )}
      <div className="meta" style={{ marginTop: 6 }}>
        {formatRange(engagement.startedOn, engagement.endsOn)}
      </div>
    </div>
  )
}

function EngagementCard({
  title,
  count,
  engagements,
  viaLabelFor
}: {
  title: string
  count: number
  engagements: readonly Engagement[]
  viaLabelFor: (engagement: Engagement) => string | null
}) {
  return (
    <Card>
      <Card.Header title={title} count={count} />
      {engagements.length === 0 ? (
        <EmptyState>Nothing here yet.</EmptyState>
      ) : (
        engagements.map((engagement) => <EngagementRow key={engagement.id} engagement={engagement} viaLabel={viaLabelFor(engagement)} />)
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// End clients
// ---------------------------------------------------------------------------

function EndClientsCard({ companyName, endClients }: { companyName: string; endClients: readonly { company: Company; engagementCount: number }[] }) {
  return (
    <Card>
      <Card.Header title="End clients" count={endClients.length} />
      {endClients.map(({ company, engagementCount }) => (
        <Link key={company.id} to={`/company/${company.id}`} className="endrow">
          <CompanyMark name={company.name} size={30} color={hue(company.name)} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="nm trunc" style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
              {company.name}
            </span>
            <span className="meta">
              {engagementCount} engagement{engagementCount === 1 ? '' : 's'}
            </span>
          </span>
        </Link>
      ))}
      <div className="via endclients-foot">
        <ViaIcon />
        revenue rolls up to {companyName}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function CompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const companyId = id ?? ''
  // Computed once per mount, not read live during render — `Date.now()` is
  // an impure call react-hooks/purity refuses inline; a detail page's
  // cadence state doesn't need to tick while it's open.
  const [now] = useState(() => Date.now())

  const companyQuery = useQuery({
    queryKey: queryKeys.companies.detail(companyId),
    queryFn: ipcQueryFn('companies:get', { id: companyId }),
    enabled: companyId !== ''
  })
  const companiesListQuery = useQuery({
    queryKey: queryKeys.companies.list(),
    queryFn: ipcQueryFn('companies:list')
  })
  const billedHereQuery = useQuery({
    queryKey: queryKeys.engagements.byBillingCompany(companyId),
    queryFn: ipcQueryFn('engagements:list', { billingCompanyId: companyId }),
    enabled: companyId !== ''
  })
  const clientHereQuery = useQuery({
    queryKey: queryKeys.engagements.byClientCompany(companyId),
    queryFn: ipcQueryFn('engagements:list', { clientCompanyId: companyId }),
    enabled: companyId !== ''
  })

  if (companyQuery.isPending) return <div className="empty">Loading…</div>
  if (companyQuery.isError) return <div className="empty">{companyQuery.error.message}</div>

  const company = companyQuery.data
  if (company == null) return <EmptyState>Company not found.</EmptyState>

  const companiesById = new Map((companiesListQuery.data ?? []).map((c) => [c.id, c] as const))
  companiesById.set(company.id, company)

  // "Billed here": billingCompanyId === this company (server-filtered — the
  // whole list already satisfies this by construction). Never coalesced
  // with "delivered here" — §5, this task's Risks.
  const billedHere = billedHereQuery.data ?? []
  // "Delivered here, billed elsewhere": clientCompanyId === this company
  // AND billingCompanyId !== this company. The clientCompanyId filter alone
  // would also catch this company's own self-billed engagements (already
  // covered by "billed here" above) — this narrows further, in the same
  // direction the filter already established, not a reversal of it.
  const deliveredElsewhere = (clientHereQuery.data ?? []).filter((engagement) => engagement.billingCompanyId !== company.id)

  const endClientCounts = new Map<string, number>()
  for (const engagement of billedHere) {
    if (engagement.clientCompanyId != null && engagement.clientCompanyId !== company.id) {
      endClientCounts.set(engagement.clientCompanyId, (endClientCounts.get(engagement.clientCompanyId) ?? 0) + 1)
    }
  }
  const endClients = Array.from(endClientCounts.entries())
    .map(([clientId, engagementCount]) => {
      const endClientCompany = companiesById.get(clientId)
      return endClientCompany ? { company: endClientCompany, engagementCount } : null
    })
    .filter((entry): entry is { company: Company; engagementCount: number } => entry != null)

  const accent = hue(company.name)
  const decay = cadenceState(company.lastTouchAt, company.cadenceDays, now)

  return (
    <div>
      <Link className="back" to="/companies">
        ← Companies
      </Link>
      <div className="dbanner" style={{ '--c': accent } as StyleWithAccent} />
      <div className="dhead">
        <CompanyMark name={company.name} size={50} color={accent} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1>{company.name}</h1>
          <div className="dmeta">
            {company.kind != null && <Tag variant={KIND_TAG_VARIANT[company.kind]}>{KIND_LABEL[company.kind]}</Tag>}
            {company.billedViaCompanyId != null && (
              <Tag variant="lapis">billed through {companiesById.get(company.billedViaCompanyId)?.name ?? company.billedViaCompanyId}</Tag>
            )}
            {company.budgetNote != null && <Tag variant="gold">{company.budgetNote}</Tag>}
            <DecayMeter pct={decay.pct} label={decay.label} />
          </div>
        </div>
      </div>

      <div className="company-detail-grid">
        <EngagementCard
          title="Billed here"
          count={billedHere.length}
          engagements={billedHere}
          viaLabelFor={(engagement) =>
            engagement.clientCompanyId != null && engagement.clientCompanyId !== company.id
              ? `for ${companiesById.get(engagement.clientCompanyId)?.name ?? engagement.clientCompanyId}`
              : null
          }
        />
        <EngagementCard
          title="Delivered here, billed elsewhere"
          count={deliveredElsewhere.length}
          engagements={deliveredElsewhere}
          viaLabelFor={(engagement) =>
            engagement.billingCompanyId != null ? `billed to ${companiesById.get(engagement.billingCompanyId)?.name ?? engagement.billingCompanyId}` : null
          }
        />
        {endClients.length > 0 && <EndClientsCard companyName={company.name} endClients={endClients} />}
        <DetailsCard companyId={company.id} company={company} companiesById={companiesById} />
      </div>
    </div>
  )
}
