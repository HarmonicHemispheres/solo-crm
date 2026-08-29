import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Toggle } from '../components/primitives/Toggle'
import { Button } from '../components/primitives/Button'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Ring } from '../components/primitives/Ring'
import { DecayMeter } from '../components/primitives/DecayMeter'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager, type LayerManagerContextValue } from '../components/shell/layer-manager-context'
import { callCrm, ipcQueryFn, optimisticUpdate, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import type { Company, CompanyKind } from '../../shared/companies'
import type { Engagement } from '../../shared/engagements'
import type { SettingEntry } from '../../shared/ipc-types'
import type { ViewPresentationMode } from '../../shared/settings'
import './Companies.css'

/**
 * §6.2/§6.13: the first view to get a real body — its shape (ViewHeader with
 * the presentation toggle, a query through the merged T-260828-26 channels,
 * an EmptyState when there's nothing, no direct `window.crm` call from a
 * component) is the pattern the other eight views copy. See the task file's
 * "Why".
 */

// ---------------------------------------------------------------------------
// Identity mark — `mark()`/`hue()`/`initials()` from the mockup, ported
// verbatim (this task's Risks: "taken from the mockup, not invented"). Not a
// shared primitive: T-260828-11's closed primitive list has no `.cmark`, and
// `components/icons.tsx`'s own header reserves per-view visuals like this one
// for the view that uses them.
// ---------------------------------------------------------------------------

const IDENTITY_PALETTE = [
  'var(--verdigris)',
  'var(--lapis)',
  'var(--verdigris-dim)',
  'var(--slate)',
  'var(--lapis-deep)'
] as const

function identityColor(name: string): string {
  let sum = 0
  for (const char of name) sum += char.charCodeAt(0)
  return IDENTITY_PALETTE[sum % IDENTITY_PALETTE.length]
}

function initials(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

function CompanyMark({ name, size }: { name: string; size: number }) {
  const color = identityColor(name)
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.37), color }
  return (
    // Decorative: the full name always sits right beside this mark (the
    // card's .nm, the table row's .nm), so its initials would otherwise
    // leak into the card/row's computed accessible name ahead of the name
    // itself — hidden rather than announced redundantly.
    <span className="cmark" style={style} aria-hidden="true">
      <span>{initials(name)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Kind display — companySchema's kind is the lowercase/snake wire enum
// (COMPANY_KINDS); the mockup's synthetic fixtures spell it Title Case. This
// is the one place the two are reconciled, matching `kindTag()`'s colour
// choices exactly (mockup:940).
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}

const KIND_VARIANT: Record<CompanyKind, TagVariant> = {
  client: 'verd',
  end_client: 'lapis',
  advisory: 'lapis',
  channel: 'lapis',
  prospect: 'gold'
}

function KindTag({ kind }: { kind: CompanyKind | null }) {
  if (kind == null) return <Tag>—</Tag>
  return <Tag variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Tag>
}

// ---------------------------------------------------------------------------
// Decay — cadence health is P2-03's computation (this task's Risks: "Decay
// bands themselves are P2-03, not this task"). What's here is only enough to
// hand `Ring`/`DecayMeter` a number: days since `lastTouchAt` over
// `cadenceDays`, non-finite whenever either is missing. Both primitives
// already carry ADR-001's rule that a non-finite pct renders as maximally
// stale (Ring: an empty track, no false-healthy full arc; DecayMeter: `late`,
// never `ok`) — this view leans on that rather than re-deriving it.
// `decayColor` mirrors DecayMeter's own ok/warn/late thresholds only to keep
// the ring's stroke colour agreeing with the bar beside it; it invents no
// new banding of its own.
// ---------------------------------------------------------------------------
function daysSince(timestamp: string): number {
  return Math.round((Date.now() - new Date(timestamp).getTime()) / 86_400_000)
}

function decayPct(company: Company): number {
  if (company.lastTouchAt == null || company.cadenceDays == null || company.cadenceDays <= 0) return Number.NaN
  return daysSince(company.lastTouchAt) / company.cadenceDays
}

function decayLabel(company: Company): string {
  if (company.lastTouchAt == null) return 'never'
  const days = daysSince(company.lastTouchAt)
  return days <= 0 ? 'today' : `${days}d`
}

function decayColor(pct: number): string {
  if (!Number.isFinite(pct)) return 'var(--verdigris)'
  if (pct >= 1) return 'var(--red)'
  if (pct >= 0.7) return 'var(--orange)'
  return 'var(--verdigris)'
}

// ---------------------------------------------------------------------------
// Row shape + sort — one row per top-level (non-end-client) company, with
// the two counts both presentations need already attached so neither card
// nor table re-derives them.
// ---------------------------------------------------------------------------

interface CompanyRow {
  company: Company
  activeEngagements: number
  endClients: number
}

type SortColumn = 'name' | 'kind' | 'engagements' | 'cadence' | 'lastTouch'
type SortDirection = 'asc' | 'desc'
interface SortState {
  column: SortColumn
  direction: SortDirection
}

function compareRows(a: CompanyRow, b: CompanyRow, column: SortColumn): number {
  switch (column) {
    case 'name':
      return a.company.name.localeCompare(b.company.name)
    case 'kind':
      return (a.company.kind ?? '').localeCompare(b.company.kind ?? '')
    case 'engagements':
      return a.activeEngagements - b.activeEngagements
    case 'cadence':
      return (a.company.cadenceDays ?? -Infinity) - (b.company.cadenceDays ?? -Infinity)
    case 'lastTouch': {
      // ADR-001 rule 5: a null last_touch_at is maximally stale, so it sorts
      // as the oldest possible value rather than being pushed to either end
      // by accident.
      const at = a.company.lastTouchAt ? Date.parse(a.company.lastTouchAt) : -Infinity
      const bt = b.company.lastTouchAt ? Date.parse(b.company.lastTouchAt) : -Infinity
      return at - bt
    }
  }
}

// ---------------------------------------------------------------------------
// The persisted card/list toggle — §6.13, backed by `view.companies.mode`
// (electron/shared/settings.ts), read/written only through settings:get /
// settings:set (the settings repository is merged; no second persistence).
// ---------------------------------------------------------------------------

function modeFromEntry(entry: SettingEntry | undefined): ViewPresentationMode {
  if (entry && entry.key === 'view.companies.mode') return entry.value
  return 'card'
}

const MODE_SETTING_KEY = 'view.companies.mode' as const

export function Companies() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openSheet } = useLayerManager()
  const [sort, setSort] = useState<SortState | null>(null)

  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const modeQuery = useQuery({
    queryKey: queryKeys.settings.detail(MODE_SETTING_KEY),
    queryFn: ipcQueryFn('settings:get', { key: MODE_SETTING_KEY })
  })

  // The cache is written before the round trip so the toggle feels instant
  // (§6.13: the choice is "remembered per view" and survives a restart, which
  // is what settings:set is for). Through `optimisticUpdate` rather than a
  // bare `setQueryData` at the call site: that had no `onError`, so a failed
  // settings:set left the optimistic value on screen while main still held
  // the old one — the view claiming a preference the app had not stored
  // (T-260828-53 item 6). `optimisticUpdate` snapshots, rolls back on
  // failure, and reconciles through `invalidate.settings` either way.
  const setModeMutation = useMutation({
    mutationFn: (value: ViewPresentationMode) =>
      callCrm('settings:set', { key: MODE_SETTING_KEY, value }).then(unwrapMutationResult),
    ...optimisticUpdate<SettingEntry, ViewPresentationMode>(
      queryClient,
      queryKeys.settings.detail(MODE_SETTING_KEY),
      (_current, value) => ({ key: MODE_SETTING_KEY, value }),
      invalidate.settings
    )
  })

  const mode = modeFromEntry(modeQuery.data)

  function handleModeChange(next: ViewPresentationMode) {
    setModeMutation.mutate(next)
  }

  const rows = useMemo<CompanyRow[]>(() => {
    const companies: readonly Company[] = companiesQuery.data ?? []
    const engagements: readonly Engagement[] = engagementsQuery.data ?? []

    const activeByBiller = new Map<string, number>()
    for (const engagement of engagements) {
      if (engagement.status !== 'active' || engagement.billingCompanyId == null) continue
      activeByBiller.set(engagement.billingCompanyId, (activeByBiller.get(engagement.billingCompanyId) ?? 0) + 1)
    }
    const endClientsByParent = new Map<string, number>()
    for (const company of companies) {
      if (company.billedViaCompanyId == null) continue
      endClientsByParent.set(company.billedViaCompanyId, (endClientsByParent.get(company.billedViaCompanyId) ?? 0) + 1)
    }
    // End clients are excluded from the top level (this task's Scope): a
    // company billed via another one belongs on that company's detail page,
    // not as a peer row here.
    return companies
      .filter((company) => company.billedViaCompanyId == null)
      .map((company) => ({
        company,
        activeEngagements: activeByBiller.get(company.id) ?? 0,
        endClients: endClientsByParent.get(company.id) ?? 0
      }))
  }, [companiesQuery.data, engagementsQuery.data])

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const sign = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => sign * compareRows(a, b, sort.column))
  }, [rows, sort])

  function handleSort(column: SortColumn) {
    setSort((previous) => {
      if (previous?.column === column) {
        return { column, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: 'asc' }
    })
  }

  const isLoading = companiesQuery.isPending || engagementsQuery.isPending || modeQuery.isPending
  const loadError = companiesQuery.error ?? engagementsQuery.error ?? modeQuery.error

  const header = (
    <ViewHeader
      icon={<CompaniesGlyph />}
      accent="var(--lapis)"
      title="Companies"
      description="End clients are companies you deliver to but do not invoice. They carry their own contacts, budget and touchpoints while revenue rolls up to the billing partner."
      actions={
        <>
          <Toggle
            aria-label="Companies view presentation"
            options={PRESENTATION_OPTIONS}
            value={mode}
            onChange={handleModeChange}
          />
          <Button variant="ghost" onClick={(event) => openSheet('company', 'New company', event.currentTarget)}>
            <PlusIcon />
            New company
          </Button>
        </>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading companies…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        {header}
        <EmptyState>{loadError.message}</EmptyState>
      </div>
    )
  }

  if (sortedRows.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          action={
            // "Add company", not the header button's "New company" text: the
            // ViewHeader's own create action (matching the mockup's/NewMenu's
            // wording) is rendered above this on every branch, so the two
            // buttons need distinct accessible names rather than two
            // identically-labelled "New company" buttons on the same page.
            <Button variant="primary" onClick={(event) => openSheet('company', 'New company', event.currentTarget)}>
              <PlusIcon />
              Add company
            </Button>
          }
        >
          No companies yet. Add the first one to start tracking cadence.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      {header}
      {mode === 'list' ? (
        <CompaniesTable rows={sortedRows} sort={sort} onSort={handleSort} onOpen={(id) => navigate(`/company/${id}`)} />
      ) : (
        <CompaniesGrid rows={sortedRows} onOpen={(id) => navigate(`/company/${id}`)} onCreate={openSheet} />
      )}
    </div>
  )
}

/**
 * `VIEWTOG` (planning/solo-crm-mockup.html:1465) — two icon buttons, not the
 * words "Card"/"List". `.claude/rules/ui-design.md`: icon buttons by default,
 * text labels reserved for a view's primary action. The label each button
 * still needs lives on the `<svg role="img" aria-label>` itself, which is
 * what gives the button its accessible name ("Card view" / "List view",
 * the mockup's own wording) without `Toggle` — a shared primitive this task
 * does not own — needing a per-option label prop.
 */
const PRESENTATION_OPTIONS = [
  { value: 'card' as const, label: <CardViewGlyph /> },
  { value: 'list' as const, label: <ListViewGlyph /> }
]

function CardViewGlyph() {
  return (
    <svg className="vtog-icon" viewBox="0 0 24 24" role="img" aria-label="Card view">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  )
}

function ListViewGlyph() {
  return (
    <svg className="vtog-icon" viewBox="0 0 24 24" role="img" aria-label="List view">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function CompaniesGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 21V6l7-3v18M11 21h9V10l-9-3" />
    </svg>
  )
}

function CompaniesGrid({
  rows,
  onOpen,
  onCreate
}: {
  rows: readonly CompanyRow[]
  onOpen: (id: string) => void
  /** `openSheet` itself, typed off the context value so this card's create
   * call cannot drift from the signature every other create button in the
   * view uses — the drift T-260829-08 closed. */
  onCreate: LayerManagerContextValue['openSheet']
}) {
  return (
    <div className="grid autofill">
      {rows.map((row) => (
        <CompanyCard key={row.company.id} row={row} onOpen={onOpen} />
      ))}
      {/* "Add company" — see the EmptyState action's comment on why this
          reads differently from the ViewHeader's own "New company" button
          sitting above it in the same view. */}
      <button
        type="button"
        className="ccard ccard-new"
        onClick={(event) => onCreate('company', 'New company', event.currentTarget)}
      >
        <PlusIcon width={22} height={22} />
        <span className="meta">Add company</span>
      </button>
    </div>
  )
}

function CompanyCard({ row, onOpen }: { row: CompanyRow; onOpen: (id: string) => void }) {
  const { company, activeEngagements, endClients } = row
  const pct = decayPct(company)
  return (
    <button type="button" className="ccard" onClick={() => onOpen(company.id)}>
      <div className="top">
        <CompanyMark name={company.name} size={38} />
        <div className="grow">
          <div className="nm trunc">{company.name}</div>
          <div className="meta">{company.website ?? '—'}</div>
        </div>
        <Ring pct={pct} size={30} color={decayColor(pct)} />
      </div>
      <div className="tags">
        <KindTag kind={company.kind} />
        {activeEngagements > 0 && <Tag variant="verd">{activeEngagements} active</Tag>}
        {endClients > 0 && (
          <Tag variant="lapis">
            {endClients} end client{endClients > 1 ? 's' : ''}
          </Tag>
        )}
      </div>
      <div className="foot">
        <DecayMeter pct={pct} label={decayLabel(company)} />
        <span className="n">{company.cadenceDays != null ? `every ${company.cadenceDays}d` : 'no cadence set'}</span>
      </div>
    </button>
  )
}

interface SortableColumn {
  column: SortColumn
  label: string
  align?: 'right'
}

const TABLE_COLUMNS: readonly SortableColumn[] = [
  { column: 'name', label: 'Company' },
  { column: 'kind', label: 'Kind' },
  { column: 'engagements', label: 'Engagements' },
  { column: 'cadence', label: 'Cadence', align: 'right' },
  { column: 'lastTouch', label: 'Last touch', align: 'right' }
]

function ariaSortFor(sort: SortState | null, column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (sort?.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function CompaniesTable({
  rows,
  sort,
  onSort,
  onOpen
}: {
  rows: readonly CompanyRow[]
  sort: SortState | null
  onSort: (column: SortColumn) => void
  onOpen: (id: string) => void
}) {
  return (
    <Card>
      <table className="tbl">
        <thead>
          <tr>
            {TABLE_COLUMNS.map(({ column, label, align }) => (
              <th
                key={column}
                aria-sort={ariaSortFor(sort, column)}
                className={align === 'right' ? 'align-right' : undefined}
              >
                <button type="button" className="sort-btn" onClick={() => onSort(column)}>
                  {label}
                  {sort?.column === column && (
                    <span className="sort-arrow" aria-hidden="true">
                      {sort.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CompanyTableRow key={row.company.id} row={row} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function CompanyTableRow({ row, onOpen }: { row: CompanyRow; onOpen: (id: string) => void }) {
  const { company, activeEngagements, endClients } = row
  const pct = decayPct(company)
  const activate = () => onOpen(company.id)
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate()
  }

  return (
    // tabIndex + a key handler make the row keyboard-reachable and
    // activatable (this task's Acceptance) without overriding its native
    // `row` role the way `role="button"` would — that would strip the
    // row/cell structure screen readers use to read the table.
    <tr tabIndex={0} aria-label={`Open ${company.name}`} onClick={activate} onKeyDown={handleKeyDown}>
      <td>
        <div className="id-cell">
          <CompanyMark name={company.name} size={26} />
          <div className="grow">
            <div className="trunc nm">{company.name}</div>
            <div className="meta">
              {endClients > 0 ? `${endClients} end client${endClients > 1 ? 's' : ''}` : (company.website ?? '—')}
            </div>
          </div>
        </div>
      </td>
      <td>
        <KindTag kind={company.kind} />
      </td>
      <td className="mono eng">{activeEngagements} active</td>
      <td className="num">{company.cadenceDays != null ? `${company.cadenceDays}d` : '—'}</td>
      <td className="last-touch">
        <DecayMeter pct={pct} label={decayLabel(company)} />
      </td>
    </tr>
  )
}
