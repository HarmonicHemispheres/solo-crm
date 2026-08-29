import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Toggle } from '../components/primitives/Toggle'
import { Button } from '../components/primitives/Button'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager, type LayerManagerContextValue } from '../components/shell/layer-manager-context'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import type { Company, CompanyKind } from '../../shared/companies'
import type { Person, PersonAffiliation } from '../../shared/people'
import type { SettingEntry } from '../../shared/ipc-types'
import type { ViewPresentationMode } from '../../shared/settings'
import './People.css'

/**
 * `/people` (T-260828-31) — the People view: card and list presentations
 * sharing T-260828-28's toggle/persistence shape exactly (see this task's
 * Scope: "reuse it rather than reimplementing" — two implementations would
 * mean two persistence keys and two behaviours). The one thing this view
 * does that Companies.tsx does not: `people:list` returns the bare person
 * row with no company on it (§5 — a person's employer is history, not a
 * foreign key), so "current company and title" for each row comes from a
 * second, per-person `people:get` read (`useQueries`, keyed exactly like
 * `PersonDetail.tsx`'s own `people:get` query so navigating into a row's
 * detail page is already warm in cache) rather than a single joined list —
 * there is no bulk affiliations channel to join against instead (T-260828-26's
 * merged surface has no `affiliations:list`), and adding one is outside this
 * task's Touches.
 */

// ---------------------------------------------------------------------------
// Identity mark — ported per-view, matching Companies.tsx's own header
// comment on why this isn't a shared primitive (T-260828-11's closed
// primitive list has no `.cmark`).
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

function PersonMark({ name, size }: { name: string; size: number }) {
  const color = identityColor(name)
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.37), color }
  return (
    // Decorative, same reasoning as Companies.tsx's CompanyMark: the full
    // name always sits right beside this mark, so its initials would
    // otherwise leak into the card/row's accessible name ahead of the name.
    <span className="cmark" style={style} aria-hidden="true">
      <span>{initials(name)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Current company's kind — reusing Companies.tsx's own label/colour map so a
// person's card and a company's own card agree on what "Client"/"Prospect"/
// etc. look like. Duplicated rather than imported, matching how
// CompanyDetail.tsx already keeps its own copy independent of Companies.tsx
// (that file's header: two independent concurrent view branches).
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

function KindTag({ kind }: { kind: CompanyKind | null | undefined }) {
  if (kind == null) return null
  return <Tag variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Tag>
}

// ---------------------------------------------------------------------------
// Current affiliation — the one open (`ended === null`) stint a card/row
// shows, out of however many `people:get` returns. This task's Risks names
// the failure this guards against directly: showing only ever the *stored*
// current affiliation is fine here (a list row has room for exactly one
// company), the danger this task actually warns about is person *detail*
// quietly doing the same thing with the full history available — see
// PersonDetail.tsx. A person can hold more than one open affiliation at once
// (e.g. an advisor to two companies); `isPrimary` breaks that tie the same
// way the repository already scopes it (people.ts's `clearOtherPrimaries`
// comment), falling back to the most recently started open stint.
// ---------------------------------------------------------------------------

function currentAffiliationOf(affiliations: readonly PersonAffiliation[]): PersonAffiliation | undefined {
  // `.current` — not a re-derived `ended === null` check — matching
  // `getPerson`'s own header comment: "the Scope requirement that a caller
  // never has to infer historical from an ended===null check it might get
  // backwards."
  const open = affiliations.filter((affiliation) => affiliation.current)
  if (open.length === 0) return undefined
  const primary = open.find((affiliation) => affiliation.isPrimary === true)
  if (primary) return primary
  return [...open].sort((a, b) => b.started.localeCompare(a.started))[0]
}

// ---------------------------------------------------------------------------
// Last contact — `Person.lastContactAt` has no cadence to compare against
// (people don't carry a cadenceDays column the way companies do), so this
// renders as plain elapsed-time metadata (mono, faint — ui-design.md) rather
// than a DecayMeter/Ring, matching the mockup's own person rows (plain
// `${days}d`, no decay bar) rather than inventing a comparison the schema
// doesn't support.
// ---------------------------------------------------------------------------

function daysSince(timestamp: string): number {
  return Math.round((Date.now() - new Date(timestamp).getTime()) / 86_400_000)
}

function contactLabel(person: Person): string {
  if (person.lastContactAt == null) return 'never'
  const days = daysSince(person.lastContactAt)
  return days <= 0 ? 'today' : `${days}d`
}

// ---------------------------------------------------------------------------
// Row shape + sort
// ---------------------------------------------------------------------------

interface PersonRow {
  person: Person
  currentAffiliation: PersonAffiliation | undefined
  currentCompany: Company | undefined
}

type SortColumn = 'name' | 'company' | 'lastContact'
type SortDirection = 'asc' | 'desc'
interface SortState {
  column: SortColumn
  direction: SortDirection
}

function compareRows(a: PersonRow, b: PersonRow, column: SortColumn): number {
  switch (column) {
    case 'name':
      return a.person.name.localeCompare(b.person.name)
    case 'company':
      return (a.currentCompany?.name ?? '').localeCompare(b.currentCompany?.name ?? '')
    case 'lastContact': {
      // Matches Companies.tsx's own lastTouch rule (ADR-001 rule 5): no
      // contact logged sorts as the oldest possible value, never pushed to
      // either end by accident.
      const at = a.person.lastContactAt ? Date.parse(a.person.lastContactAt) : -Infinity
      const bt = b.person.lastContactAt ? Date.parse(b.person.lastContactAt) : -Infinity
      return at - bt
    }
  }
}

// ---------------------------------------------------------------------------
// The persisted card/list toggle — `view.people.mode`, the exact pattern
// Companies.tsx already established for `view.companies.mode`.
// ---------------------------------------------------------------------------

function modeFromEntry(entry: SettingEntry | undefined): ViewPresentationMode {
  if (entry && entry.key === 'view.people.mode') return entry.value
  return 'card'
}

const MODE_SETTING_KEY = 'view.people.mode' as const

export function People() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openSheet } = useLayerManager()
  const [sort, setSort] = useState<SortState | null>(null)

  const peopleQuery = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const modeQuery = useQuery({
    queryKey: queryKeys.settings.detail(MODE_SETTING_KEY),
    queryFn: ipcQueryFn('settings:get', { key: MODE_SETTING_KEY })
  })

  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data])
  // One `people:get` per row, keyed exactly like PersonDetail.tsx's own
  // query — see this file's header comment on why there is no bulk
  // affiliations read to join against instead. `enabled` waits on the base
  // list so this never fires against a stale/empty `people` before the real
  // list has loaded.
  const affiliationQueries = useQueries({
    queries: people.map((person) => ({
      queryKey: queryKeys.people.detail(person.id),
      queryFn: ipcQueryFn('people:get', { id: person.id }),
      enabled: peopleQuery.isSuccess
    }))
  })

  const setModeMutation = useMutation({
    mutationFn: (value: ViewPresentationMode) =>
      callCrm('settings:set', { key: MODE_SETTING_KEY, value }).then(unwrapMutationResult),
    onSuccess: () => invalidate.settings(queryClient)
  })

  const mode = modeFromEntry(modeQuery.data)

  function handleModeChange(next: ViewPresentationMode) {
    // Written to the cache immediately, same reasoning as Companies.tsx's
    // identical handler: the toggle feels instant, and the mutation's
    // onSuccess invalidation reconciles this key with whatever main stored.
    queryClient.setQueryData(queryKeys.settings.detail(MODE_SETTING_KEY), { key: MODE_SETTING_KEY, value: next })
    setModeMutation.mutate(next)
  }

  const companiesById = useMemo(
    () => new Map((companiesQuery.data ?? []).map((company) => [company.id, company] as const)),
    [companiesQuery.data]
  )

  const rows = useMemo<PersonRow[]>(
    () =>
      people.map((person, index) => {
        const detail = affiliationQueries[index]?.data
        const currentAffiliation = detail ? currentAffiliationOf(detail.affiliations) : undefined
        const currentCompany = currentAffiliation ? companiesById.get(currentAffiliation.companyId) : undefined
        return { person, currentAffiliation, currentCompany }
      }),
    // affiliationQueries is a fresh array each render (useQueries' own
    // contract) — included anyway so this recomputes once each query
    // actually resolves, not just when `people`/`companiesById` change.
    [people, affiliationQueries, companiesById]
  )

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

  const isLoading =
    peopleQuery.isPending ||
    companiesQuery.isPending ||
    modeQuery.isPending ||
    affiliationQueries.some((query) => query.isPending)
  const loadError = peopleQuery.error ?? companiesQuery.error ?? modeQuery.error ?? affiliationQueries.find((query) => query.error)?.error

  const header = (
    <ViewHeader
      icon={<PeopleGlyph />}
      accent="var(--lapis-deep)"
      title="People"
      description="Contacts are stored separately from companies, so history follows the person when they change jobs."
      actions={
        <>
          <Toggle
            aria-label="People view presentation"
            options={PRESENTATION_OPTIONS}
            value={mode}
            onChange={handleModeChange}
          />
          <Button variant="ghost" onClick={(event) => openSheet('person', 'New person', event.currentTarget)}>
            <PlusIcon />
            New person
          </Button>
        </>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading people…</p>
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
            // "Add person", distinct from the header's own "New person"
            // button — same reasoning as Companies.tsx's EmptyState action
            // comment: two buttons on one page need two accessible names.
            <Button variant="primary" onClick={(event) => openSheet('person', 'New person', event.currentTarget)}>
              <PlusIcon />
              Add person
            </Button>
          }
        >
          No people yet. Add the first one to start tracking contacts.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      {header}
      {mode === 'list' ? (
        <PeopleTable rows={sortedRows} sort={sort} onSort={handleSort} onOpen={(id) => navigate(`/person/${id}`)} />
      ) : (
        <PeopleGrid rows={sortedRows} onOpen={(id) => navigate(`/person/${id}`)} onCreate={openSheet} />
      )}
    </div>
  )
}

const PRESENTATION_OPTIONS = [
  { value: 'card' as const, label: 'Card' },
  { value: 'list' as const, label: 'List' }
]

function PeopleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.4 2.9-5.2 5.5-5.2s4.9 1.8 5.5 5.2M16 5.4a3.2 3.2 0 010 5.7M18.2 20c-.2-2-.8-3.6-1.8-4.7" />
    </svg>
  )
}

function PeopleGrid({
  rows,
  onOpen,
  onCreate
}: {
  rows: readonly PersonRow[]
  onOpen: (id: string) => void
  /** `openSheet` itself — see `CompaniesGrid`'s own note on why this is
   * typed off the context value rather than restated here. */
  onCreate: LayerManagerContextValue['openSheet']
}) {
  return (
    <div className="grid autofill">
      {rows.map((row) => (
        <PersonCard key={row.person.id} row={row} onOpen={onOpen} />
      ))}
      <button
        type="button"
        className="ccard ccard-new"
        onClick={(event) => onCreate('person', 'New person', event.currentTarget)}
      >
        <PlusIcon width={22} height={22} />
        <span className="meta">Add person</span>
      </button>
    </div>
  )
}

function PersonCard({ row, onOpen }: { row: PersonRow; onOpen: (id: string) => void }) {
  const { person, currentAffiliation, currentCompany } = row
  return (
    <button type="button" className="ccard" onClick={() => onOpen(person.id)}>
      <div className="top">
        <PersonMark name={person.name} size={38} />
        <div className="grow">
          <div className="nm trunc">{person.name}</div>
          <div className="meta trunc">{currentCompany?.name ?? '—'}</div>
        </div>
      </div>
      <div className="tags">
        <KindTag kind={currentCompany?.kind} />
        {currentCompany?.billedViaCompanyId != null && <Tag variant="lapis">end client</Tag>}
      </div>
      <div className="foot">
        <span className="meta trunc" style={{ flex: 1 }}>
          {currentAffiliation?.title ?? '—'}
        </span>
        <span className="n">{contactLabel(person)}</span>
      </div>
    </button>
  )
}

interface SortableColumn {
  column: SortColumn
  label: string
  align?: 'right'
}

/** Sortable columns after "Name" (rendered separately below, ahead of the
 * non-sortable "Role" header) and before "Role" — `Role` has no column of
 * its own to sort by (it lives on the current affiliation, not the person
 * or company row), so it isn't part of this generic sortable-header loop. */
const TABLE_COLUMNS: readonly SortableColumn[] = [
  { column: 'company', label: 'Company' },
  { column: 'lastContact', label: 'Last contact', align: 'right' }
]

function ariaSortFor(sort: SortState | null, column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (sort?.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function PeopleTable({
  rows,
  sort,
  onSort,
  onOpen
}: {
  rows: readonly PersonRow[]
  sort: SortState | null
  onSort: (column: SortColumn) => void
  onOpen: (id: string) => void
}) {
  return (
    <Card>
      <table className="tbl">
        <thead>
          <tr>
            <th aria-sort={ariaSortFor(sort, 'name')}>
              <button type="button" className="sort-btn" onClick={() => onSort('name')}>
                Name
                {sort?.column === 'name' && (
                  <span className="sort-arrow" aria-hidden="true">
                    {sort.direction === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            </th>
            <th>Role</th>
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
            <PersonTableRow key={row.person.id} row={row} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function PersonTableRow({ row, onOpen }: { row: PersonRow; onOpen: (id: string) => void }) {
  const { person, currentAffiliation, currentCompany } = row
  const activate = () => onOpen(person.id)
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate()
  }

  return (
    <tr tabIndex={0} aria-label={`Open ${person.name}`} onClick={activate} onKeyDown={handleKeyDown}>
      <td>
        <div className="id-cell">
          <PersonMark name={person.name} size={26} />
          <div className="grow">
            <div className="trunc nm">{person.name}</div>
          </div>
        </div>
      </td>
      <td className="trunc role-cell">{currentAffiliation?.title ?? '—'}</td>
      <td style={{ fontSize: 12.5 }}>
        {currentCompany ? currentCompany.name : <span className="meta">—</span>}
        {currentCompany?.billedViaCompanyId != null && (
          <Tag variant="lapis" style={{ marginLeft: 6 }}>
            end client
          </Tag>
        )}
      </td>
      <td className="num">{contactLabel(person)}</td>
    </tr>
  )
}
