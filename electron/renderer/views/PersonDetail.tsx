import { useState, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseDateOnly } from '../../shared/format'
import type { Company, CompanyKind } from '../../shared/companies'
import type { Person, PersonAffiliation, UpdatePersonInput } from '../../shared/people'
import type { Activity, ActivityKind } from '../../shared/activity'
import { callCrm, ipcMutationFn, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { EmptyState } from '../components/primitives/EmptyState'
import { Button } from '../components/primitives/Button'
import { Toast } from '../components/primitives/Toast'
import './detail-header.css'
import { identityColor as hue, initials } from '../lib/identity'
import './PersonDetail.css'
import { localToday } from './todo-urgency'

/**
 * `/person/:id` (T-260828-31) — the view the whole affiliation model exists
 * to make visible (this task's Why): a person with two affiliations shows
 * both, the closed one visibly historical with its date range, the open one
 * marked current (Acceptance) — never only the row `people:get` happens to
 * consider "current". Activity is filtered by `personId` alone
 * (`activityFiltersSchema`), never narrowed by a company id, so a person's
 * shared history follows them across the affiliations below it exactly the
 * way this task's Risks warns a `companyId` filter would quietly fail to.
 *
 * Out of this task's scope (T-260828-30 owns it): Company detail's own
 * contacts section. Shared-history scoring, "people you haven't spoken to"
 * surfacing (P5), and Gmail-derived contact timestamps (P4-xx) — this page
 * renders whatever `lastContactAt` already holds, nothing computed.
 */

// ---------------------------------------------------------------------------
// Identity mark — `hue`/`initials`/`Mark`, the same shape CompanyDetail.tsx
// already carries under its own name (that file's header: no shared/
// primitive home for these exists yet, ported per-view). Named generically
// here (not `PersonMark`/`CompanyMark`) because this page draws it for both
// its own subject (a person) and every company an affiliation row links to.
// ---------------------------------------------------------------------------



type StyleWithAccent = CSSProperties & { '--c': string }

function Mark({ name, size, color }: { name: string; size: number; color: string }) {
  return (
    <span className="cmark" style={{ width: size, height: size, fontSize: Math.round(size * 0.37), color }}>
      <span>{initials(name)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Current company's kind — duplicated from Companies.tsx/CompanyDetail.tsx's
// own copies, matching CompanyDetail.tsx's header on why: independent
// concurrent view branches, no shared label map exists yet.
// ---------------------------------------------------------------------------

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

function KindTag({ kind }: { kind: CompanyKind | null | undefined }) {
  if (kind == null) return null
  return <Tag variant={KIND_TAG_VARIANT[kind]}>{KIND_LABEL[kind]}</Tag>
}

// ---------------------------------------------------------------------------
// Current affiliation — which one open (`.current`) stint the header/details
// "Company" field shows, when a person holds more than one at once (an
// advisor to two companies). `.current` is `getPerson`'s own precomputed
// field (electron/main/db/repositories/people.ts), not a re-derived
// `ended === null` check — see that file's comment on exactly why. This
// picks one for the single-company slots on this page; the Affiliations
// card below still lists every one of them, current or not (this task's
// Why/Risks: showing only the current affiliation is the model's whole
// value, quietly discarded).
// ---------------------------------------------------------------------------

function currentAffiliationOf(affiliations: readonly PersonAffiliation[]): PersonAffiliation | undefined {
  const open = affiliations.filter((affiliation) => affiliation.current)
  if (open.length === 0) return undefined
  const primary = open.find((affiliation) => affiliation.isPrimary === true)
  if (primary) return primary
  return [...open].sort((a, b) => b.started.localeCompare(a.started))[0]
}

// ---------------------------------------------------------------------------
// Date/contact formatting
// ---------------------------------------------------------------------------

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** UTC-formatted so a `YYYY-MM-DD` value never shifts a day under a
 * negative-UTC-offset local timezone — matching CompanyDetail.tsx's own
 * `formatMonthYear` and `electron/shared/format.ts`'s header on the bug. */
function formatMonthYear(dateOnly: string): string {
  return MONTH_YEAR_FORMAT.format(parseDateOnly(dateOnly))
}

/** `ended: null` means the stint is still open — rendered "present", never a
 * blank or a repeated start date (this task's Acceptance: the open one
 * marked current, the closed one carrying its real range). */
function formatAffiliationRange(started: string, ended: string | null): string {
  return `${formatMonthYear(started)} → ${ended ? formatMonthYear(ended) : 'present'}`
}

const DAY_MS = 24 * 60 * 60 * 1000

function contactTagLabel(person: Person, now: number): string {
  if (person.lastContactAt == null) return 'no contact logged'
  const days = Math.floor((now - new Date(person.lastContactAt).getTime()) / DAY_MS)
  return days <= 0 ? 'today' : `${days}d since contact`
}

const ACTIVITY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

function formatActivityDate(occurredAt: string): string {
  return ACTIVITY_DATE_FORMAT.format(new Date(occurredAt))
}

// ---------------------------------------------------------------------------
// Affiliations card — every stint, current or not (this task's Why). Ordered
// most-recently-started first: `getPerson` returns oldest-first
// (`listAffiliationsForPerson`'s own `ORDER BY started ASC`), this page
// reverses it once for display rather than asking the repository to sort
// twice.
// ---------------------------------------------------------------------------

function AffiliationsCard({
  affiliations,
  companiesById
}: {
  affiliations: readonly PersonAffiliation[]
  companiesById: Map<string, Company>
}) {
  return (
    <Card>
      <Card.Header title="Affiliations" count={affiliations.length} />
      {affiliations.length === 0 ? (
        <EmptyState>No affiliations yet.</EmptyState>
      ) : (
        affiliations.map((affiliation) => (
          <AffiliationRow key={affiliation.id} affiliation={affiliation} company={companiesById.get(affiliation.companyId)} />
        ))
      )}
    </Card>
  )
}

function AffiliationRow({ affiliation, company }: { affiliation: PersonAffiliation; company: Company | undefined }) {
  const name = company?.name ?? affiliation.companyId
  return (
    <div className="aff">
      <div className="aff-t">
        <Mark name={name} size={26} color={hue(name)} />
        <Link to={`/company/${affiliation.companyId}`} className="nm trunc">
          {name}
        </Link>
        {/* The open stint marked current, never merely absent from an
            "ended" column a reader has to interpret (this task's Acceptance). */}
        {affiliation.current && <Tag variant="verd">Current</Tag>}
      </div>
      <div className="aff-meta">
        {affiliation.title != null ? `${affiliation.title} · ` : ''}
        {formatAffiliationRange(affiliation.started, affiliation.ended)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Details card — inline edit of the person's own fields (email, phone,
// notes; name stays in the header, matching CompanyDetail.tsx's own choice
// not to edit its identity field inline). Company is a read-only link here,
// deliberately not part of this edit loop — see MoveCompanyForm below and
// this task's Risks: "A 'company' field on the person edit form that writes
// an affiliation overwrite instead of calling people:move."
// ---------------------------------------------------------------------------

type TextFieldKey = 'email' | 'phone' | 'notes'

const TEXT_FIELD_CONFIG: Record<TextFieldKey, { label: string; type: 'text' | 'textarea'; placeholder?: string }> = {
  email: { label: 'Email', type: 'text', placeholder: 'name@example.com' },
  phone: { label: 'Phone', type: 'text', placeholder: '+1 555 555 5555' },
  notes: { label: 'Notes', type: 'textarea' }
}

/** `''` stands in for `null` on the way in and out, same convention
 * CompanyDetail.tsx's `rawValueOf` documents. */
function rawValueOf(person: Person, key: TextFieldKey): string {
  switch (key) {
    case 'email':
      return person.email ?? ''
    case 'phone':
      return person.phone ?? ''
    case 'notes':
      return person.notes ?? ''
  }
}

function displayValueOf(person: Person, key: TextFieldKey): ReactNode {
  const raw = rawValueOf(person, key)
  return raw === '' ? '—' : raw
}

function DetailField({
  fieldKey,
  person,
  editingKey,
  onStartEdit,
  onCommit,
  onCancel
}: {
  fieldKey: TextFieldKey
  person: Person
  editingKey: TextFieldKey | null
  onStartEdit: (key: TextFieldKey) => void
  onCommit: (key: TextFieldKey, raw: string) => void
  onCancel: () => void
}) {
  const config = TEXT_FIELD_CONFIG[fieldKey]
  const isEditing = editingKey === fieldKey
  const [draft, setDraft] = useState(() => rawValueOf(person, fieldKey))
  // T-260901-25: Escape unmounts the field, and Chromium fires a blur on
  // the way out — which reached `commit` and saved the draft the user had
  // just discarded. Same guard `LinksCard` carries, for the same reason;
  // Enter takes it too, so its unmount blur does not commit a second time.
  // This component stays mounted between edits (only the field inside it
  // comes and goes), so the flag is re-armed where an edit starts.
  const settled = useRef(false)

  if (!isEditing) {
    return (
      <div className="field">
        <span className="k">{config.label}</span>
        <span className="v">
          <button
            type="button"
            className="field-value-btn"
            onClick={() => {
              setDraft(rawValueOf(person, fieldKey))
              settled.current = false
              onStartEdit(fieldKey)
            }}
          >
            {displayValueOf(person, fieldKey)}
          </button>
        </span>
      </div>
    )
  }

  const commit = () => {
    if (settled.current) return
    settled.current = true
    onCommit(fieldKey, draft)
  }
  const cancel = () => {
    if (settled.current) return
    settled.current = true
    onCancel()
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
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
            type="text"
            value={draft}
            autoFocus
            placeholder={config.placeholder}
            aria-label={config.label}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          />
        )}
      </span>
    </div>
  )
}

function DetailsCard({
  person,
  companies,
  currentCompany
}: {
  person: Person
  companies: readonly Company[]
  currentCompany: Company | undefined
}) {
  const queryClient = useQueryClient()
  const [editingKey, setEditingKey] = useState<TextFieldKey | null>(null)

  const updatePerson = useMutation({
    mutationFn: (patch: UpdatePersonInput) => ipcMutationFn('people:update')({ id: person.id, patch }).then(unwrapMutationResult),
    onSuccess: () => invalidate.people(queryClient)
  })

  const commitField = (key: TextFieldKey, raw: string) => {
    if (raw === rawValueOf(person, key)) {
      setEditingKey(null)
      return
    }
    setEditingKey(null)
    const trimmed = raw.trim()
    updatePerson.mutate({ [key]: trimmed === '' ? null : trimmed })
  }

  return (
    <Card>
      <Card.Header title="Details" />
      <div className="field">
        <span className="k">Company</span>
        <span className="v">
          {currentCompany != null ? <Link to={`/company/${currentCompany.id}`}>{currentCompany.name}</Link> : '—'}
        </span>
      </div>
      {(['email', 'phone', 'notes'] as const).map((key) => (
        <DetailField
          key={key}
          fieldKey={key}
          person={person}
          editingKey={editingKey}
          onStartEdit={setEditingKey}
          onCommit={commitField}
          onCancel={() => setEditingKey(null)}
        />
      ))}
      <MoveCompanyForm personId={person.id} currentCompanyId={currentCompany?.id} companies={companies} />
      <Toast message={updatePerson.isError ? updatePerson.error.message : null} onDismiss={() => updatePerson.reset()} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Move to a new company — the one write this page makes that is not a plain
// field patch. Always goes through `people:move` (never
// `people:updateAffiliation` on the open row's `companyId`, which the
// schema doesn't even expose — see electron/shared/people.ts's header on
// why company/person are an affiliation's identity, not a patchable field)
// so the old stint is closed with a real `ended` date and a new one opens,
// in one transaction, rather than overwritten in place (this task's Why and
// Risks). No mockup source for this control — see PersonDetail.css's header.
// ---------------------------------------------------------------------------

function MoveCompanyForm({
  personId,
  currentCompanyId,
  companies
}: {
  personId: string
  currentCompanyId: string | undefined
  companies: readonly Company[]
}) {
  const queryClient = useQueryClient()
  const [targetId, setTargetId] = useState('')
  const [onDate, setOnDate] = useState(() => localToday())

  const options = companies.filter((company) => company.id !== currentCompanyId)

  const movePerson = useMutation({
    mutationFn: (payload: { toCompanyId: string; on: string }) =>
      callCrm('people:move', { personId, toCompanyId: payload.toCompanyId, options: { on: payload.on } }).then(unwrapMutationResult),
    onSuccess: () => {
      invalidate.people(queryClient)
      setTargetId('')
    }
  })

  if (options.length === 0) return null

  return (
    <div className="move-form">
      <span className="label">{currentCompanyId != null ? 'Move to another company' : 'Assign a company'}</span>
      <div className="move-row">
        <select aria-label="Company to move to" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">Choose a company…</option>
          {options.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="Effective date"
          value={onDate}
          onChange={(event) => setOnDate(event.target.value)}
        />
      </div>
      <Button
        variant="ghost"
        disabled={targetId === '' || movePerson.isPending}
        onClick={() => movePerson.mutate({ toCompanyId: targetId, on: onDate })}
      >
        Move
      </Button>
      <Toast message={movePerson.isError ? movePerson.error.message : null} onDismiss={() => movePerson.reset()} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity — filtered by `personId` alone (`activityFiltersSchema`), so a
// row logged against a company the person has since left still shows here
// (this task's Acceptance: "regardless of which company the activity row
// carries" — the exact failure mode this task's Risks names is filtering by
// `companyId` instead, which only works for a person who never moved).
// ---------------------------------------------------------------------------

const ACTIVITY_ICON_PATHS: Record<ActivityKind, ReactNode> = {
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

function ActivityCard({ activity, companiesById }: { activity: readonly Activity[]; companiesById: Map<string, Company> }) {
  return (
    <Card>
      <Card.Header title="Shared history" count={activity.length} />
      {activity.length === 0 ? (
        <EmptyState>Nothing logged.</EmptyState>
      ) : (
        <div className="tl">
          {activity.map((entry) => (
            <ActivityItem
              key={entry.id}
              entry={entry}
              company={entry.companyId != null ? companiesById.get(entry.companyId) : undefined}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function ActivityItem({ entry, company }: { entry: Activity; company: Company | undefined }) {
  return (
    <div className="tli">
      <span className="bul">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {ACTIVITY_ICON_PATHS[entry.kind]}
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="t">{entry.title}</span>
        <span className="d">
          {formatActivityDate(entry.occurredAt)}
          {company != null ? ` · ${company.name}` : ''}
        </span>
        {entry.body != null && <div className="note">{entry.body}</div>}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function PersonDetail() {
  const { id } = useParams<{ id: string }>()
  const personId = id ?? ''
  // Computed once per mount, not read live during render — matches
  // CompanyDetail.tsx's own `[now]` (`Date.now()` is an impure call
  // react-hooks/purity refuses inline; a detail page's "since contact"
  // label doesn't need to tick while it's open).
  const [now] = useState(() => Date.now())

  const personQuery = useQuery({
    queryKey: queryKeys.people.detail(personId),
    queryFn: ipcQueryFn('people:get', { id: personId }),
    enabled: personId !== ''
  })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const activityQuery = useQuery({
    queryKey: queryKeys.activity.byPerson(personId),
    queryFn: ipcQueryFn('activity:list', { personId }),
    enabled: personId !== ''
  })

  if (personQuery.isPending) return <div className="empty">Loading…</div>
  if (personQuery.isError) return <div className="empty">{personQuery.error.message}</div>

  const person = personQuery.data
  if (person == null) return <EmptyState>Person not found.</EmptyState>

  const companies = companiesQuery.data ?? []
  const companiesById = new Map(companies.map((company) => [company.id, company] as const))
  // A person with no affiliation at all (this task's Acceptance) renders
  // with no company anywhere on the page — `currentAffiliationOf` returns
  // `undefined`, never a guessed or invented row.
  const current = currentAffiliationOf(person.affiliations)
  const currentCompany = current ? companiesById.get(current.companyId) : undefined
  const affiliationsMostRecentFirst = [...person.affiliations].reverse()
  const accent = hue(person.name)

  return (
    <div>
      <Link className="back" to="/people">
        ← People
      </Link>
      <div className="dhero">
        <div className="dbanner" style={{ '--c': accent } as StyleWithAccent} />
        <div className="dhead">
          <Mark name={person.name} size={50} color={accent} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1>{person.name}</h1>
            <div className="dmeta">
              <KindTag kind={currentCompany?.kind} />
              <Tag>{currentCompany?.name ?? '—'}</Tag>
              <Tag>{contactTagLabel(person, now)}</Tag>
            </div>
          </div>
        </div>
      </div>

      <div className="person-detail-grid">
        <AffiliationsCard affiliations={affiliationsMostRecentFirst} companiesById={companiesById} />
        <DetailsCard person={person} companies={companies} currentCompany={currentCompany} />
        <ActivityCard activity={activityQuery.data ?? []} companiesById={companiesById} />
      </div>
    </div>
  )
}
