import { useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SVGProps } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { nowTimestamp, parseDateOnly, parseTimestamp } from '../../shared/format'
import { COMPANY_KINDS, type Company, type CompanyKind, type UpdateCompanyInput } from '../../shared/companies'
import type { BillingModel, Engagement, EngagementStatus } from '../../shared/engagements'
import type { Task } from '../../shared/tasks'
import type { Activity, ActivityKind } from '../../shared/activity'
import type { Person, PersonAffiliation, PersonWithAffiliations } from '../../shared/people'
import { ipcMutationFn, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { Card } from '../components/primitives/Card'
import { Chip } from '../components/primitives/Chip'
import { ModelTag, type BillingModel as ModelTagBillingModel } from '../components/primitives/ModelTag'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { EmptyState } from '../components/primitives/EmptyState'
import { DecayMeter } from '../components/primitives/DecayMeter'
import { Toast } from '../components/primitives/Toast'
import { QuickAdd } from '../components/primitives/QuickAdd'
import { Row } from '../components/primitives/Row'
import { IconButton } from '../components/primitives/IconButton'
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
 * T-260828-30 adds the rest of this page below: todos (with the one
 * exclusive-per-company next step, promoted through `tasks:setNextStep`),
 * the append-only activity timeline (merged from three independently-
 * filtered `activity:list` calls — company, its people, its engagements —
 * for the same reason "billed here"/"delivered here" above are two calls
 * and not one sliced client-side), and contacts (current affiliations only,
 * historical ones behind a disclosure). Links and any revenue or hours
 * figure are still out of this page's scope — ADR-003 puts every revenue
 * question through `revenue_lines`, not per-billing-model branching
 * rendered here.
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

// ---------------------------------------------------------------------------
// T-260828-30's own icons — a view's per-kind glyphs stay with the view that
// uses them (components/icons.tsx's own header), same as `ViaIcon` above.
// ---------------------------------------------------------------------------

/** The todo checkbox glyph — mockup's `.check svg` path, styled entirely by
 * `.check`/`.check svg` in CompanyDetail.css rather than inline props. */
function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** "Promote to next step" — new UI with no mockup source (this task's Risks:
 * the mockup never shows how a next step gets chosen). A flag, not a star:
 * `.nextbadge` already reads "next step" in text, so the glyph only needs to
 * read as "mark this" rather than borrow a meaning (favourite, priority)
 * that isn't what this button does. */
function NextStepIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 3v18" />
      <path d="M6 4h12l-3.5 4L18 12H6" />
    </svg>
  )
}

/** `ICONS` (planning/solo-crm-mockup.html line ~935) — same four glyphs,
 * keyed by `ActivityKind`'s lowercase wire values rather than the mockup's
 * capitalised display strings. Presentation attributes live once on the
 * wrapping `<svg>` in `ActivityKindIcon` below (CSS's `.tli .bul svg` rule),
 * not repeated per path/rect/circle — SVG `fill`/`stroke` inherit down. */
const ACTIVITY_KIND_PATHS: Record<ActivityKind, ReactNode> = {
  call: <path d="M5 4h3l2 5-2 1a10 10 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />,
  email: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3.5 7.5L12 13l8.5-5.5" />
    </>
  ),
  meeting: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  note: <path d="M4 19l1-4 10-10 3 3L8 18z" />
}

function ActivityKindIcon({ kind }: { kind: ActivityKind }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {ACTIVITY_KIND_PATHS[kind]}
    </svg>
  )
}

const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note'
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
// Todos — due-date / waiting-since formatting, mockup's `dueInfo()`
// (planning/solo-crm-mockup.html line ~795) reproduced against this app's
// own date helpers rather than the mockup's ad hoc `new Date(d+'T09:00:00')`.
// ---------------------------------------------------------------------------

const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** UTC-formatted for the same reason `formatMonthYear` above is: a
 * `dateOnly` value must never shift a day under the caller's local
 * timezone. */
function formatMonthDay(dateOnly: string): string {
  return MONTH_DAY_FORMAT.format(parseDateOnly(dateOnly))
}

/**
 * Today's date as a LOCAL calendar `YYYY-MM-DD` string — deliberately the
 * one place in this file that reads local `Date` accessors rather than
 * UTC ones. "Today" is inherently the viewer's local calendar day, the
 * same way `dueOn` itself is calendar-date data with no time zone
 * attached — see `daysSinceDateOnly` below for why comparing it this way
 * matters.
 */
function localDateOnly(now: number): string {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * A `dateOnly` value's age in days as of `now` — positive once it's in the
 * past. Review fix: this used to be `Math.floor((now -
 * parseDateOnly(dateOnly).getTime()) / DAY_MS)`, subtracting a
 * UTC-midnight instant (`dueOn`) from a raw epoch-millis wall-clock
 * instant (`now`) — two different time frames. For any viewer west of
 * UTC, once local time crosses into the next UTC calendar day (~17:00
 * local at UTC-7), that mixing reads every due date one day later than
 * the viewer's actual local calendar day. Comparing calendar date to
 * calendar date instead — `today` derived locally via `localDateOnly`,
 * both sides then parsed to a UTC-midnight instant via `parseDateOnly` —
 * keeps the difference a whole number of calendar days regardless of
 * what hour it currently is.
 */
function daysSinceDateOnly(dateOnly: string, now: number): number {
  const todayMs = parseDateOnly(localDateOnly(now)).getTime()
  return Math.round((todayMs - parseDateOnly(dateOnly).getTime()) / DAY_MS)
}

/** A full timestamp's age in days as of `now` — `waitingSince` is a
 * `timestampSchema` value (an instant), not a `dateOnly`, so it parses with
 * `parseTimestamp`, not `parseDateOnly`. */
function daysSinceTimestamp(timestamp: string, now: number): number {
  return Math.floor((now - parseTimestamp(timestamp).getTime()) / DAY_MS)
}

interface DueInfo {
  readonly cls: 'over' | 'soon' | 'later' | 'wait'
  readonly label: string
}

/**
 * Mockup's `dueInfo()`: a `waiting` task reads its age off `waitingSince`
 * (§6.6/requirements: waiting items are excluded from the owed count but
 * age visibly), everything else off `dueOn`. `cls` and `label` are each the
 * mockup's own ternary chain, kept as two separate chains rather than
 * merged into one lookup — the mockup itself computes them independently
 * off the same `d`, and collapsing them would have to invent a combined
 * table the mockup doesn't have.
 */
function taskDueInfo(task: Task, now: number): DueInfo {
  if (task.status === 'waiting') {
    const days = task.waitingSince != null ? Math.max(daysSinceTimestamp(task.waitingSince, now), 0) : 0
    return { cls: 'wait', label: `waiting ${days}d` }
  }
  if (task.dueOn == null) return { cls: 'later', label: 'no date' }
  const d = daysSinceDateOnly(task.dueOn, now)
  const cls = d > 0 ? 'over' : d === 0 ? 'soon' : d >= -7 ? 'soon' : 'later'
  const label = d > 0 ? `${d}d overdue` : d === 0 ? 'today' : d === -1 ? 'tomorrow' : formatMonthDay(task.dueOn)
  return { cls, label }
}

// ---------------------------------------------------------------------------
// Activity — `occurredAt` is a genuine instant (`timestampSchema`), not a
// `dateOnly` value, so it is deliberately formatted in the viewer's local
// time (no `timeZone: 'UTC'` override) rather than reusing the UTC-pinned
// formatters above — there is no "which calendar day does this string mean"
// question for an instant the way there is for a `dateOnly` value.
// ---------------------------------------------------------------------------

const ACTIVITY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

function formatActivityDate(occurredAt: string): string {
  return ACTIVITY_DATE_FORMAT.format(parseTimestamp(occurredAt))
}

/**
 * Review fix (item 3): true when `occurredAt` falls inside the affiliation's
 * own window — `started` through `ended` inclusive, or open-ended for a
 * still-current affiliation. Without this bound, `relevantPersonIds` pulled
 * in EVERY activity row tied to a person once they had ever been affiliated
 * with this company — including a *former* contact's activity from after
 * they left, logged against whatever company they moved to next, leaking
 * it onto their old company's timeline. `ended` is a calendar date, so its
 * whole day still counts as affiliated.
 */
function withinAffiliationWindow(occurredAt: string, affiliation: PersonAffiliation): boolean {
  const occurred = parseTimestamp(occurredAt).getTime()
  if (occurred < parseDateOnly(affiliation.started).getTime()) return false
  return affiliation.ended == null || occurred < parseDateOnly(affiliation.ended).getTime() + DAY_MS
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
// Todos — T-260828-30. The next step (`is_next_step`, exclusive per company,
// T-260828-23) is pulled out of the ordinary list into its own block above
// it: a structural and textual distinction (position plus the `.nextbadge`
// "next step" label), not a colour alone — `.claude/rules/ui-design.md`'s
// rule this task's Risks section names explicitly.
// ---------------------------------------------------------------------------

/**
 * Review fix (item 2): this block used to render only the badge, title and
 * due label — the one todo the page exists to draw attention to was the
 * only one with no way to tick it off or hand the marker to another task.
 * `onComplete`/`onPromote` give it the exact same inline controls
 * `TodoRow` below renders, wrapped in the same `.sub` layout that row uses
 * for its checkbox/due/promote trio (`.next-step-block .sub` in
 * CompanyDetail.css mirrors `.todo .sub`, since this block isn't a `.todo`
 * row itself).
 */
function NextStepBlock({
  task,
  now,
  onComplete,
  onPromote
}: {
  task: Task
  now: number
  onComplete: (id: string) => void
  onPromote: (id: string) => void
}) {
  const due = taskDueInfo(task, now)
  return (
    <div className="next-step-block">
      <span className="nextbadge">next step</span>
      <div className="next-step-title">{task.title}</div>
      <div className="sub" style={{ marginTop: 6 }}>
        <button
          type="button"
          className={task.status === 'waiting' ? 'check wait' : 'check'}
          onClick={() => onComplete(task.id)}
          aria-label={`Mark "${task.title}" done`}
        >
          <CheckIcon />
        </button>
        <span className={`due ${due.cls}`}>{due.label}</span>
        <IconButton aria-label={`Set "${task.title}" as next step`} onClick={() => onPromote(task.id)}>
          <NextStepIcon />
        </IconButton>
      </div>
    </div>
  )
}

function TodoRow({
  task,
  now,
  onComplete,
  onPromote
}: {
  task: Task
  now: number
  onComplete: (id: string) => void
  onPromote: (id: string) => void
}) {
  const due = taskDueInfo(task, now)
  return (
    <div className="todo">
      <button
        type="button"
        className={task.status === 'waiting' ? 'check wait' : 'check'}
        onClick={() => onComplete(task.id)}
        aria-label={`Mark "${task.title}" done`}
      >
        <CheckIcon />
      </button>
      <span className="tx">
        {task.title}
        <span className="sub">
          <span className={`due ${due.cls}`}>{due.label}</span>
        </span>
      </span>
      <IconButton aria-label={`Set "${task.title}" as next step`} onClick={() => onPromote(task.id)}>
        <NextStepIcon />
      </IconButton>
    </div>
  )
}

/**
 * `tasks:list({ companyId })` (this task's Touches — no `open` filter: that
 * flag's `OPEN_STATUS_SQL` excludes `waiting` too, but the mockup's own
 * `todosFor()` — and requirements §6.6, "waiting items age visibly" — keeps
 * waiting tasks in this card, just styled distinctly (`.check.wait`,
 * `.due.wait`). Only `done` drops out, filtered client-side below.
 */
function TodosCard({ companyId, companyName, tasks, now }: { companyId: string; companyName: string; tasks: readonly Task[]; now: number }) {
  const queryClient = useQueryClient()

  const completeTask = useMutation({
    mutationFn: (id: string) => ipcMutationFn('tasks:update')({ id, patch: { status: 'done' } }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })
  const promoteTask = useMutation({
    mutationFn: (id: string) => ipcMutationFn('tasks:setNextStep')({ id }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })
  const createTask = useMutation({
    mutationFn: (title: string) => ipcMutationFn('tasks:create')({ title, companyId }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })

  const openTasks = tasks.filter((task) => task.status !== 'done')
  const nextStep = openTasks.find((task) => task.isNextStep) ?? null
  const otherTasks = openTasks.filter((task) => task !== nextStep)
  const activeError = completeTask.isError ? completeTask.error : promoteTask.isError ? promoteTask.error : createTask.isError ? createTask.error : null

  return (
    <Card>
      <Card.Header title="Todos" count={openTasks.length} />
      {nextStep != null && (
        <NextStepBlock task={nextStep} now={now} onComplete={completeTask.mutate} onPromote={promoteTask.mutate} />
      )}
      {otherTasks.length === 0 && nextStep == null ? (
        <EmptyState>Nothing open.</EmptyState>
      ) : (
        otherTasks.map((task) => (
          <TodoRow key={task.id} task={task} now={now} onComplete={completeTask.mutate} onPromote={promoteTask.mutate} />
        ))
      )}
      <QuickAdd placeholder={`Add a todo for ${companyName}`} onAdd={(value) => createTask.mutate(value)} />
      <Toast
        message={activeError?.message ?? null}
        onDismiss={() => {
          completeTask.reset()
          promoteTask.reset()
          createTask.reset()
        }}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Activity — T-260828-30. Append-only (G8): this card's only mutation is
// `activity:log` (a create); there is no update or delete channel to call
// and this card renders no button that implies either. `items` arrives
// already merged and sorted — see the view's own comment on why three
// `activity:list` calls feed it instead of one.
// ---------------------------------------------------------------------------

function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <div className="tli">
      <span className="bul">
        <ActivityKindIcon kind={activity.kind} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="t">{activity.title}</span>
        <span className="d">
          {ACTIVITY_KIND_LABEL[activity.kind]} · {formatActivityDate(activity.occurredAt)}
        </span>
        {activity.body != null && <div className="note">{activity.body}</div>}
      </span>
    </div>
  )
}

function ActivityCard({ companyId, companyName, items }: { companyId: string; companyName: string; items: readonly Activity[] }) {
  const queryClient = useQueryClient()

  const logActivity = useMutation({
    mutationFn: (title: string) =>
      ipcMutationFn('activity:log')({
        occurredAt: nowTimestamp(),
        kind: 'note',
        title,
        body: null,
        companyId,
        source: 'manual'
      }).then(unwrapMutationResult),
    onSuccess: () => invalidate.activity(queryClient)
  })

  return (
    <Card>
      <Card.Header title="Activity" count={items.length} />
      <div className="tl">
        {items.length === 0 ? <EmptyState>Nothing logged.</EmptyState> : items.map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
      </div>
      <QuickAdd placeholder={`Log a touch for ${companyName}`} onAdd={(value) => logActivity.mutate(value)} />
      <Toast message={logActivity.isError ? logActivity.error.message : null} onDismiss={() => logActivity.reset()} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Contacts — T-260828-30. Current affiliations only in the main list; a
// person whose only tie to this company has `ended` shows solely under the
// `<details>` disclosure below, its subtitle naming when they left rather
// than reusing their old title — "visibly historical" (this task's
// Acceptance), not just relocated.
// ---------------------------------------------------------------------------

interface ContactEntry {
  readonly person: Person
  readonly affiliation: PersonAffiliation
}

function ContactRow({ entry, historical, onClick }: { entry: ContactEntry; historical: boolean; onClick: () => void }) {
  const subtitle = historical
    ? entry.affiliation.ended != null
      ? `left ${formatMonthYear(entry.affiliation.ended)}`
      : 'former contact'
    : (entry.affiliation.title ?? undefined)
  return (
    <Row
      onClick={onClick}
      leading={<CompanyMark name={entry.person.name} size={28} color={hue(entry.person.name)} />}
      title={entry.person.name}
      subtitle={subtitle}
      trailing={!historical && entry.affiliation.isPrimary ? <Tag variant="gold">Primary</Tag> : undefined}
    />
  )
}

function ContactsCard({
  current,
  historical
}: {
  current: readonly ContactEntry[]
  historical: readonly ContactEntry[]
}) {
  const navigate = useNavigate()
  const goToPerson = (personId: string) => () => navigate(`/person/${personId}`)

  return (
    <Card>
      <Card.Header title="Contacts" count={current.length} />
      {current.length === 0 && historical.length === 0 ? (
        <EmptyState action={<Link to="/people">Add a contact</Link>}>No contacts yet.</EmptyState>
      ) : current.length === 0 ? (
        <EmptyState>No current contacts.</EmptyState>
      ) : (
        current.map((entry) => <ContactRow key={entry.person.id} entry={entry} historical={false} onClick={goToPerson(entry.person.id)} />)
      )}
      {historical.length > 0 && (
        <details className="contacts-historical">
          <summary>
            {historical.length} former contact{historical.length === 1 ? '' : 's'}
          </summary>
          {historical.map((entry) => (
            <ContactRow key={entry.person.id} entry={entry} historical onClick={goToPerson(entry.person.id)} />
          ))}
        </details>
      )}
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

  // -- Todos (T-260828-30): one company-scoped query, no `open` filter — see
  // TodosCard's own comment on why `waiting` tasks stay in this list. --
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.byCompany(companyId),
    queryFn: ipcQueryFn('tasks:list', { companyId }),
    enabled: companyId !== ''
  })

  // -- Contacts (T-260828-30): no `people:list({ companyId })` filter exists
  // — `people:list` returns bare `Person` rows with no affiliation data at
  // all — so every person is fetched (cheap: a solo consultancy's whole
  // contact book) and then `people:get` per person pulls the affiliation
  // history `people:list` doesn't carry, exactly like `people:get`'s own
  // response shape already requires for a single person's detail page.
  // `useQueries` keeps this parallel rather than N sequential round trips. --
  const peopleListQuery = useQuery({
    queryKey: queryKeys.people.list(),
    queryFn: ipcQueryFn('people:list')
  })
  const peopleDetailQueries = useQueries({
    queries: (peopleListQuery.data ?? []).map((person) => ({
      queryKey: queryKeys.people.detail(person.id),
      queryFn: ipcQueryFn('people:get', { id: person.id })
    }))
  })

  const currentContacts: ContactEntry[] = []
  const historicalContacts: ContactEntry[] = []
  for (const result of peopleDetailQueries) {
    const person: PersonWithAffiliations | null | undefined = result.data
    if (person == null) continue
    const atThisCompany = person.affiliations.filter((affiliation) => affiliation.companyId === companyId)
    if (atThisCompany.length === 0) continue
    const openStint = atThisCompany.find((affiliation) => affiliation.current)
    if (openStint != null) {
      currentContacts.push({ person, affiliation: openStint })
    } else {
      // Most recently ended stint at this company — `ended` is never null
      // here (every entry in `atThisCompany` that isn't `openStint` has one).
      const mostRecent = [...atThisCompany].sort((a, b) => (b.ended ?? '').localeCompare(a.ended ?? ''))[0]
      historicalContacts.push({ person, affiliation: mostRecent })
    }
  }
  // Every person this company has ever had an affiliation with — current and
  // historical alike, matching the Activity section's own "this company's
  // people" scope (this task's Scope), not only its present-day contacts.
  // Each entry carries the affiliation `withinAffiliationWindow` bounds that
  // person's merged-in activity to below (review fix item 3).
  const relevantContacts: readonly ContactEntry[] = [...currentContacts, ...historicalContacts]

  // -- Activity (T-260828-30): merged from three independently-filtered
  // `activity:list` calls — companyId directly, this company's people, this
  // company's engagements — per this task's Risks ("pulling person and
  // engagement activity in with three separate queries and merging
  // client-side out of order"). Engagement ids come straight off the raw
  // `billedHereQuery`/`clientHereQuery` results (deduped — an engagement
  // billed and delivered to the same company satisfies both filters) rather
  // than the post-return `billedHere`/`deliveredElsewhere` locals below,
  // which don't exist yet this early in the hook order. --
  const engagementIds = Array.from(
    new Set([...(billedHereQuery.data ?? []), ...(clientHereQuery.data ?? [])].map((engagement) => engagement.id))
  )
  const companyActivityQuery = useQuery({
    queryKey: queryKeys.activity.byCompany(companyId),
    queryFn: ipcQueryFn('activity:list', { companyId }),
    enabled: companyId !== ''
  })
  const personActivityQueries = useQueries({
    queries: relevantContacts.map((entry) => ({
      queryKey: queryKeys.activity.byPerson(entry.person.id),
      queryFn: ipcQueryFn('activity:list', { personId: entry.person.id })
    }))
  })
  const engagementActivityQueries = useQueries({
    queries: engagementIds.map((engagementId) => ({
      queryKey: queryKeys.activity.byEngagement(engagementId),
      queryFn: ipcQueryFn('activity:list', { engagementId })
    }))
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

  // Merge + dedupe (an activity row can carry both a matching companyId and
  // a matching personId/engagementId, landing in more than one of the three
  // queries above) then sort newest first — a `Map` keyed by id does both in
  // one pass, and ISO-8601 UTC timestamps sort correctly as plain strings.
  const activityById = new Map<string, Activity>()
  for (const activity of companyActivityQuery.data ?? []) activityById.set(activity.id, activity)
  // Bounded per contact by their affiliation window (review fix item 3) — a
  // historical contact's activity from after they left, at whatever company
  // they moved to next, must not leak onto this one just because their
  // `activity:list({ personId })` query itself returns every row they've
  // ever been party to.
  relevantContacts.forEach((entry, index) => {
    for (const activity of personActivityQueries[index]?.data ?? []) {
      if (withinAffiliationWindow(activity.occurredAt, entry.affiliation)) activityById.set(activity.id, activity)
    }
  })
  for (const result of engagementActivityQueries) for (const activity of result.data ?? []) activityById.set(activity.id, activity)
  const activityItems = Array.from(activityById.values()).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

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
        <TodosCard companyId={company.id} companyName={company.name} tasks={tasksQuery.data ?? []} now={now} />
        <ActivityCard companyId={company.id} companyName={company.name} items={activityItems} />
        <ContactsCard current={currentContacts} historical={historicalContacts} />
        <DetailsCard companyId={company.id} company={company} companiesById={companiesById} />
      </div>
    </div>
  )
}
