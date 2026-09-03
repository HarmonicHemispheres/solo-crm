import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { Chip } from '../components/primitives/Chip'
import { ModelTag, type BillingModel as ModelTagBillingModel } from '../components/primitives/ModelTag'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Toggle } from '../components/primitives/Toggle'
import { Button } from '../components/primitives/Button'
import { IconButton } from '../components/primitives/IconButton'
import { ConfirmDelete } from '../components/primitives/ConfirmDelete'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { engagementAnchorId } from '../nav'
import { ipcQueryFn } from '../lib/ipc'
import { identityColor, initials } from '../lib/identity'
import { queryKeys } from '../lib/query-keys'
import { parseDateOnly } from '../../shared/format'
import {
  BILLING_MODELS,
  ENGAGEMENT_STATUSES,
  type BillingModel,
  type EngagementStatus,
  type EngagementWithOffering,
  type Milestone
} from '../../shared/engagements'
import {
  GROUP_MODE_OPTIONS,
  MODEL_LABEL,
  STATUS_LABEL,
  filterCounts,
  filterEngagements,
  groupEngagements,
  type EngagementGroup,
  type GroupMode,
  type ModelFilter,
  type StatusFilter
} from './engagement-grouping'
import { termsFor } from './engagement-terms'
import type { Company } from '../../shared/companies'
import type { CompanyImageThumbnails } from '../../shared/company-images'
import './Engagements.css'

/**
 * `/engagements` (T-260828-32) — under ADR-005 the only view of engagement
 * state; see that task's "Why".
 *
 * **What this page was, and why it changed.** It grouped by `status` and
 * nothing else, and each row was six stacked lines of prose-shaped text:
 * name, company, "SOLD AS CONSULTING", a date range, a price, a model pill.
 * Three cards of that is a wall — the operator's verdict was "really text
 * heavy and hard to use" — and the grouping answered a question
 * ("what state is my work in") that is not the one this page is opened
 * with, which is "what am I doing for whom".
 *
 * So: **grouped by client by default**, one card per payer with its logo on
 * it; status and model are the other two groupings, a click away. Two chip
 * rows filter by status and by model, each chip carrying the count it would
 * leave. And a row is now a *row* — a glyph, a name, a line of metadata, and
 * the price aligned on the right where a column of prices can be compared —
 * rather than a paragraph. `engagement-grouping.ts` holds the ordering and
 * counting rules, so they are stated once and tested directly.
 *
 * Deliberately still out (restated so a later change here does not quietly
 * reintroduce it): any *aggregate* revenue figure — ADR-003 puts every
 * revenue question through `revenue_lines`, and the exception it names is
 * "a single engagement's own headline price", which is what the value column
 * is. There is no per-client total on this page, and no annualisation: the
 * moment a number sums across engagements it belongs to the Revenue view.
 * Also out: a Pipeline board (ADR-005), and the milestone editor (P3-09 —
 * milestones are read-only here, through `milestones:list`).
 */

// ---------------------------------------------------------------------------
// Icons — a view's own glyphs stay with the view (components/icons.tsx's
// header: only the ones a *primitive* renders itself live there).
// ---------------------------------------------------------------------------

/** `ModelTag` only draws the four models that get a colour (mockup's `.m-*`
 * set) — `'none'` has no swatch of its own, so an engagement with no billing
 * model just shows no model pill rather than a blank grey one. */
function isTaggableModel(model: BillingModel | null): model is ModelTagBillingModel {
  return model != null && model !== 'none'
}

const STATUS_VARIANT: Record<EngagementStatus, TagVariant> = {
  active: 'green',
  pending: 'gold',
  proposed: 'lapis',
  held: 'orange',
  delivered: 'verd',
  lost: 'red'
}

/** The mockup's `VIA_ICON` — a small "redirected" glyph in front of the client-company marker. */
function ViaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" width={11} height={11}>
      <path d="M7 7h6a4 4 0 014 4v6M17 17l-3-3M17 17l3-3" />
    </svg>
  )
}

/** "Sold as" — a price-tag glyph, the catalogue's own shape. */
function SoldAsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width={11} height={11}>
      <path d="M11.5 3.5H20v8.5l-8.7 8.7a1.6 1.6 0 0 1-2.3 0l-6.2-6.2a1.6 1.6 0 0 1 0-2.3Z" />
      <path d="M16.5 7.5h.01" />
    </svg>
  )
}

/** The term. A calendar, so the date range reads as a date range at a glance instead of as two more words. */
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" width={11} height={11}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function EngagementsGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5.6A1.6 1.6 0 019.6 4h4.8A1.6 1.6 0 0116 5.6V7" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Identity — the company's own logo where one is stored, its derived mark
// otherwise (ADR-015: absence is the default, not a state to design).
// ---------------------------------------------------------------------------

/**
 * The 96 × 96 derivative from `companyImages:thumbnails`, never an original.
 * ADR-015's whole point: a list read that carried originals would pay a
 * third more than the stored size for every row at once, and the seeded
 * database — which has no images — would never show it.
 *
 * `aria-hidden`: the company's name is always beside the mark (a group
 * header's own text, or the row's `for <company>` link), so announcing two
 * derived initials before it would put noise ahead of the name.
 */
function CompanyMark({ name, size, logo }: { name: string; size: number; logo?: string | null }) {
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.37), color: identityColor(name) }
  return (
    <span className={logo ? 'cmark has-image' : 'cmark'} style={style} aria-hidden="true">
      {logo ? <img className="cmark-img" src={logo} alt="" /> : <span>{initials(name)}</span>}
    </span>
  )
}

/** An empty map, referentially stable, so a pending or failed thumbnails read does not re-render every row with a fresh `{}`. */
const NO_IMAGES: CompanyImageThumbnails = {}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** UTC-formatted so a `YYYY-MM-DD` value never shifts a day under a negative-UTC-offset local timezone (`electron/shared/format.ts`'s header is about exactly this bug). */
function formatMonthYear(dateOnly: string): string {
  return MONTH_YEAR_FORMAT.format(parseDateOnly(dateOnly))
}

/** `endsOn: null` means rolling, never a blank or a missing date (`electron/shared/engagements.ts`'s header). */
function formatRange(startedOn: string, endsOn: string | null): string {
  return `${formatMonthYear(startedOn)} → ${endsOn ? formatMonthYear(endsOn) : 'rolling'}`
}

// ---------------------------------------------------------------------------
// One engagement, as a row
// ---------------------------------------------------------------------------

const EMPTY_MILESTONES: readonly Milestone[] = []
/** Referentially stable empties, so a pending read does not hand every memo below a fresh array each render. */
const EMPTY_ENGAGEMENTS: readonly EngagementWithOffering[] = []
const EMPTY_COMPANIES: readonly Company[] = []

type EditEngagement = (id: string, trigger: HTMLElement | null) => void
type DeleteEngagement = (engagement: { id: string; name: string }) => void

/** What the group header already says, so the row does not repeat it. */
interface RowContext {
  readonly hideCompany: boolean
  readonly hideStatus: boolean
  readonly hideModel: boolean
}

function contextFor(mode: GroupMode): RowContext {
  return {
    hideCompany: mode === 'client',
    hideStatus: mode === 'status',
    hideModel: mode === 'model'
  }
}

function EngagementRow({
  engagement,
  companiesById,
  images,
  milestones,
  context,
  onEdit,
  onDelete
}: {
  engagement: EngagementWithOffering
  companiesById: ReadonlyMap<string, Company>
  images: CompanyImageThumbnails
  milestones: readonly Milestone[]
  context: RowContext
  onEdit: EditEngagement
  onDelete: DeleteEngagement
}) {
  const terms = termsFor(engagement, milestones)
  const billingCompany = engagement.billingCompanyId != null ? companiesById.get(engagement.billingCompanyId) : undefined
  const forCompanyId = engagement.clientCompanyId != null && engagement.clientCompanyId !== engagement.billingCompanyId ? engagement.clientCompanyId : null
  const forCompany = forCompanyId != null ? companiesById.get(forCompanyId) : undefined
  const billingName = billingCompany?.name ?? engagement.billingCompanyId

  return (
    // The scroll target for a command-palette engagement result
    // (T-260828-37): an engagement has no detail route of its own, so ⌘K
    // lands on this view and scrolls to the row. Built by
    // `engagementAnchorId` rather than written out here, so the two halves
    // of the anchor cannot drift.
    <div className="engrow" id={engagementAnchorId(engagement.id)}>
      {/* One leading glyph, and it is always the thing the group header is
          not. Grouped by client the header carries the logo, so the row's
          glyph is its status; grouped any other way the row carries the
          logo, because "whose is this" is then the row's to answer. */}
      {context.hideCompany ? (
        <span className={`engrow-dot s-${engagement.status ?? 'none'}`} aria-hidden="true" />
      ) : billingName != null ? (
        <CompanyMark name={billingName} size={30} logo={images[engagement.billingCompanyId ?? '']?.logo?.dataUrl} />
      ) : (
        <span className="engrow-dot s-none" aria-hidden="true" />
      )}

      <div className="engrow-main">
        <div className="engrow-t">
          <span className="nm trunc">{engagement.name}</span>
          {!context.hideModel && isTaggableModel(engagement.billingModel) && (
            <ModelTag model={engagement.billingModel}>{MODEL_LABEL[engagement.billingModel]}</ModelTag>
          )}
          {!context.hideStatus && engagement.status != null && <Tag variant={STATUS_VARIANT[engagement.status]}>{STATUS_LABEL[engagement.status]}</Tag>}
        </div>
        <div className="engrow-meta">
          {!context.hideCompany && engagement.billingCompanyId != null && (
            <Link className="engrow-co" to={`/company/${engagement.billingCompanyId}`}>
              {billingName}
            </Link>
          )}
          <span className="engrow-fact">
            <CalendarIcon />
            {formatRange(engagement.startedOn, engagement.endsOn)}
          </span>
          {forCompanyId != null && (
            <span className="engrow-fact via">
              <ViaIcon />
              for{' '}
              <Link to={`/company/${forCompanyId}`}>{forCompany?.name ?? forCompanyId}</Link>
            </span>
          )}
          {/* What this was sold as — the offering behind `offeringVersionId`,
              joined on by `engagements:list` (T-260901-13). Deliberately no
              rate: `agreedRateCents` is the only source for that (P3-03),
              and a price read off the catalogue here would be the live-price
              join the acceptance forbids. */}
          {engagement.offeringName != null && (
            <span className="engrow-fact">
              <SoldAsIcon />
              {engagement.offeringName}
            </span>
          )}
        </div>
        {/* A true count of milestone rows that exist — absent when there are
            none, rather than an empty track reading "0 of 0". */}
        {milestones.length > 0 && (
          <div className="prog" title={`${milestones.filter((milestone) => milestone.completedAt != null).length} of ${milestones.length} milestones complete`}>
            {milestones.map((milestone) => (
              <i key={milestone.id} className={milestone.completedAt != null ? 'on' : undefined} title={milestone.name ?? undefined} />
            ))}
          </div>
        )}
      </div>

      {/* The price, right-aligned in its own column: a page of engagements is
          a page of amounts, and amounts are compared down a column, not
          hunted for at the end of a paragraph. */}
      <div className="engrow-value">
        {terms.value != null ? (
          <div className="engrow-amt">
            {terms.value}
            {terms.unit != null && <span className="engrow-unit">{terms.unit}</span>}
          </div>
        ) : terms.note != null ? (
          <div className="engrow-amt engrow-amt-none">{terms.note}</div>
        ) : null}
        {terms.basis.map((line) => (
          <div className="engrow-basis" key={line}>
            {line}
          </div>
        ))}
      </div>

      {/* ADR-005 leaves an engagement with no detail route, so the list is
          where editing has to happen. Icon-only with a label naming the
          engagement (ui-design.md), revealed on hover or focus and left
          visible below 700px where there is no hover. */}
      <div className="engrow-actions">
        <IconButton aria-label={`Edit "${engagement.name}"`} onClick={(event) => onEdit(engagement.id, event.currentTarget)}>
          <PencilIcon />
        </IconButton>
        <IconButton aria-label={`Delete "${engagement.name}"`} onClick={() => onDelete({ id: engagement.id, name: engagement.name })}>
          <TrashIcon />
        </IconButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One group, as a card
// ---------------------------------------------------------------------------

function GroupCard({
  group,
  mode,
  companiesById,
  images,
  milestonesByEngagementId,
  onEdit,
  onDelete
}: {
  group: EngagementGroup
  mode: GroupMode
  companiesById: ReadonlyMap<string, Company>
  images: CompanyImageThumbnails
  milestonesByEngagementId: ReadonlyMap<string, readonly Milestone[]>
  onEdit: EditEngagement
  onDelete: DeleteEngagement
}) {
  const context = contextFor(mode)
  return (
    <Card>
      <Card.Header
        title={
          <span className="enggroup">
            {group.companyId != null ? (
              <>
                <CompanyMark name={group.label} size={24} logo={images[group.companyId]?.logo?.dataUrl} />
                {/* The header links to the client — the card is about them,
                    and everything else on this page that names a company
                    does too. */}
                <Link to={`/company/${group.companyId}`}>{group.label}</Link>
              </>
            ) : group.status != null ? (
              <>
                <span className={`engrow-dot s-${group.status}`} aria-hidden="true" />
                {group.label}
              </>
            ) : group.model != null ? (
              <>
                <span className={`enggroup-swatch m-${group.model}`} aria-hidden="true" />
                {group.label}
              </>
            ) : (
              group.label
            )}
          </span>
        }
        count={group.rows.length}
      />
      {group.rows.map((engagement) => (
        <EngagementRow
          key={engagement.id}
          engagement={engagement}
          companiesById={companiesById}
          images={images}
          milestones={engagement.billingModel === 'fixed' ? (milestonesByEngagementId.get(engagement.id) ?? EMPTY_MILESTONES) : EMPTY_MILESTONES}
          context={context}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </Card>
  )
}

// ---------------------------------------------------------------------------

export function Engagements() {
  const { openSheet, editSheet } = useLayerManager()
  const handleEdit: EditEngagement = (id, trigger) => editSheet('engagement', id, trigger)
  // One dialog for the whole view, holding whichever engagement asked for it
  // — rather than one mounted per row, which would put a modal's worth of
  // state behind every card on the page.
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  const [mode, setMode] = useState<GroupMode>('client')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all')

  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  /**
   * The same entry the companies grid holds, so arriving here from there is
   * no second read (ADR-015: one call for the whole list's derivatives,
   * never one per card). Its failure is not the page's: a missing logo is a
   * derived mark, which is what every company without one draws anyway.
   */
  const thumbnailsQuery = useQuery({
    queryKey: queryKeys.companyImages.thumbnails(),
    queryFn: ipcQueryFn('companyImages:thumbnails')
  })

  const engagements = useMemo<readonly EngagementWithOffering[]>(() => engagementsQuery.data ?? EMPTY_ENGAGEMENTS, [engagementsQuery.data])
  const companies = useMemo<readonly Company[]>(() => companiesQuery.data ?? EMPTY_COMPANIES, [companiesQuery.data])
  const images = thumbnailsQuery.data ?? NO_IMAGES
  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company] as const)), [companies])

  // Milestones are fetched only for fixed-scope engagements — the one model
  // whose card needs them — one `milestones:list` query per id via
  // `useQueries`, not a bulk channel (none exists), keeping every other
  // model's row free of a query it has no use for.
  const fixedEngagementIds = engagements.filter((engagement) => engagement.billingModel === 'fixed').map((engagement) => engagement.id)
  const milestonesResults = useQueries({
    queries: fixedEngagementIds.map((id) => ({
      queryKey: queryKeys.milestones.list(id),
      queryFn: ipcQueryFn('milestones:list', { engagementId: id })
    }))
  })
  const milestonesByEngagementId = new Map<string, readonly Milestone[]>()
  fixedEngagementIds.forEach((id, index) => {
    milestonesByEngagementId.set(id, milestonesResults[index]?.data ?? EMPTY_MILESTONES)
  })

  const counts = useMemo(() => filterCounts(engagements, statusFilter, modelFilter), [engagements, statusFilter, modelFilter])
  const visible = useMemo(() => filterEngagements(engagements, statusFilter, modelFilter), [engagements, statusFilter, modelFilter])
  const groups = useMemo(() => groupEngagements(visible, mode, companiesById), [visible, mode, companiesById])

  const isLoading = engagementsQuery.isPending || companiesQuery.isPending
  const loadError = engagementsQuery.error ?? companiesQuery.error
  const filtered = statusFilter !== 'all' || modelFilter !== 'all'

  const header = (
    <ViewHeader
      icon={<EngagementsGlyph />}
      accent="var(--lapis-deep)"
      title="Engagements"
      description="Grouped by who is invoiced. Each engagement states its own terms — a retainer's monthly price, a fixed scope's contract value and milestones, T&M at its agreed rate capped by its not-to-exceed. Totals across engagements live on Revenue."
      actions={
        <>
          <Toggle options={GROUP_MODE_OPTIONS} value={mode} onChange={setMode} aria-label="Group by" />
          <Button variant="ghost" onClick={(event) => openSheet('engagement', event.currentTarget)}>
            <PlusIcon />
            New engagement
          </Button>
        </>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading engagements…</p>
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

  if (engagements.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          action={
            <Button variant="primary" onClick={(event) => openSheet('engagement', event.currentTarget)}>
              <PlusIcon />
              Add engagement
            </Button>
          }
        >
          No engagements yet. Add the first one to start tracking where work stands.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      {header}

      {/* **Two rows of chips, and each chip says what it would leave.** A
          filter that hides the size of its own result is a filter you press
          to find out what it does; the counts come from
          `filterCounts`, which counts against the *other* filter, so the
          number on a chip is the number of rows pressing it produces. A
          status or model nothing uses gets no chip at all. */}
      <div className="engfilters" role="group" aria-label="Filter engagements">
        <FilterRow
          label="Status"
          allCount={engagements.filter((engagement) => modelFilter === 'all' || engagement.billingModel === modelFilter).length}
          selected={statusFilter}
          onSelect={setStatusFilter}
          options={ENGAGEMENT_STATUSES.filter((status) => (counts.byStatus.get(status) ?? 0) > 0).map((status) => ({
            value: status,
            label: STATUS_LABEL[status],
            count: counts.byStatus.get(status) ?? 0
          }))}
        />
        <FilterRow
          label="Model"
          allCount={engagements.filter((engagement) => statusFilter === 'all' || engagement.status === statusFilter).length}
          selected={modelFilter}
          onSelect={setModelFilter}
          options={BILLING_MODELS.filter((model) => (counts.byModel.get(model) ?? 0) > 0).map((model) => ({
            value: model,
            label: MODEL_LABEL[model],
            count: counts.byModel.get(model) ?? 0
          }))}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          action={
            <Button
              variant="ghost"
              onClick={() => {
                setStatusFilter('all')
                setModelFilter('all')
              }}
            >
              Clear filters
            </Button>
          }
        >
          No engagement matches both filters. {engagements.length} engagement{engagements.length === 1 ? '' : 's'} in total.
        </EmptyState>
      ) : (
        <>
          {filtered && (
            <p className="meta engcount">
              {visible.length} of {engagements.length} engagement{engagements.length === 1 ? '' : 's'}
            </p>
          )}
          <div className="status-grid">
            {groups.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                mode={mode}
                companiesById={companiesById}
                images={images}
                milestonesByEngagementId={milestonesByEngagementId}
                onEdit={handleEdit}
                onDelete={setDeleting}
              />
            ))}
          </div>
        </>
      )}

      {/* One dialog for the view, mounted only while a row has asked for it.
          No `onDeleted`: this list is where the operator already is, and the
          delete's invalidation removes the row from under them. */}
      {deleting && <ConfirmDelete entity="engagement" id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} />}
    </div>
  )
}

/** One filter's chips: an "All" chip carrying the unfiltered count, then one per value that something actually uses. */
function FilterRow<Value extends string>({
  label,
  allCount,
  options,
  selected,
  onSelect
}: {
  label: string
  allCount: number
  options: ReadonlyArray<{ value: Value; label: string; count: number }>
  selected: Value | 'all'
  onSelect: (value: Value | 'all') => void
}) {
  // A single-value axis is not a filter — one chip that is always on tells
  // the operator nothing and takes a row to do it. Unless something on this
  // axis *is* filtered: hiding the row then would strand the filter with no
  // control left to clear it.
  if (options.length < 2 && selected === 'all') return null
  return (
    <div className="engfilter">
      <span className="engfilter-k">{label}</span>
      <Chip selected={selected === 'all'} onClick={() => onSelect('all')} aria-label={`All ${label.toLowerCase()}, ${allCount}`}>
        All <span className="engfilter-n">{allCount}</span>
      </Chip>
      {options.map((option) => (
        <Chip
          key={option.value}
          selected={selected === option.value}
          onClick={() => onSelect(option.value)}
          aria-label={`${option.label}, ${option.count}`}
        >
          {option.label} <span className="engfilter-n">{option.count}</span>
        </Chip>
      ))}
    </div>
  )
}
