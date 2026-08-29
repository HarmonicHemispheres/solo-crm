import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { ModelTag, type BillingModel as ModelTagBillingModel } from '../components/primitives/ModelTag'
import { Tag } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { engagementAnchorId } from '../nav'
import { ipcQueryFn } from '../lib/ipc'
import { queryKeys } from '../lib/query-keys'
import { centsToDecimalString, parseDateOnly } from '../../shared/format'
import { ENGAGEMENT_STATUSES, type BillingModel, type Engagement, type EngagementStatus, type Milestone } from '../../shared/engagements'
import type { Company } from '../../shared/companies'
import './Engagements.css'

/**
 * `/engagements` (T-260828-32) — under ADR-005 the only view of engagement
 * state; see this task's "Why". Cards group by `status`, and each card's
 * progress shape is model-appropriate: retainer hours against allowance,
 * fixed milestones completed, T&M hours against estimate. `equity`/`none`
 * render no progress shape — drawing one that doesn't apply "reads as
 * information" (this task's Scope) when it is really none.
 *
 * Deliberately out (this task's Scope "Out", restated so a later change here
 * doesn't quietly reintroduce it): any revenue figure (ADR-003 puts every
 * revenue question through `revenue_lines`, not per-billing-model branching
 * rendered here), the milestone editor (P3-09, read-only via
 * `engagements:milestones`), a Pipeline nav item or board (ADR-005), filters
 * and saved views (P2-08). `notToExceedCents` is the one money field this
 * view does show — a stored T&M contract term the Scope names explicitly,
 * not a computed figure.
 *
 * Hours-derived figures (retainer/T&M) are always rendered at 0 — `main`
 * has no `time_entries` channel yet (P4-05), so there is no real "hours
 * used" to plot. `ProvisionalMark` is the required caveat next to every one
 * of them (AGENTS.md: "every retainer hours-used... figure is fiction
 * within two weeks" without the timelog import) — dropping it is dropping
 * the one thing standing between an honest zero and a false one.
 */

// ---------------------------------------------------------------------------
// Local display helpers — duplicated from CompanyDetail.tsx rather than
// imported: `.eng`/`.eng-t`/`.via` have no shared home yet (CompanyDetail.css's
// own header explains why), and `formatRange`/`isTaggableModel`/`ViaIcon` are
// this same per-view-local-copy convention already established there.
// ---------------------------------------------------------------------------

/** `ModelTag` only draws the four models that get a colour (mockup's `.m-*`
 * set) — `'none'` has no swatch of its own, so an engagement with no billing
 * model (or `billingModel: null`) just shows no model pill rather than a
 * blank grey one. Matches CompanyDetail.tsx's own `isTaggableModel`. */
function isTaggableModel(model: BillingModel | null): model is ModelTagBillingModel {
  return model != null && model !== 'none'
}

const MODEL_LABEL: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed',
  tm: 'T&M',
  equity: 'Equity',
  none: '—'
}

const STATUS_LABEL: Record<EngagementStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  proposed: 'Proposed',
  held: 'Held',
  delivered: 'Delivered',
  lost: 'Lost'
}

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** UTC-formatted so a `YYYY-MM-DD` value never shifts a day under a
 * negative-UTC-offset local timezone (see `electron/shared/format.ts`'s own
 * header on exactly this bug). */
function formatMonthYear(dateOnly: string): string {
  return MONTH_YEAR_FORMAT.format(parseDateOnly(dateOnly))
}

/** `endsOn: null` means rolling, never a blank or a missing date (this
 * task's Acceptance, and `electron/shared/engagements.ts`'s header). */
function formatRange(startedOn: string, endsOn: string | null): string {
  return `${formatMonthYear(startedOn)} → ${endsOn ? formatMonthYear(endsOn) : 'rolling'}`
}

/** The mockup's `VIA_ICON` (planning/solo-crm-mockup.html line ~939) — a
 * small "redirected" glyph in front of the client-company marker. */
function ViaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--lapis)" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" width={11} height={11}>
      <path d="M7 7h6a4 4 0 014 4v6M17 17l-3-3M17 17l3-3" />
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

/** A company name, linked to its detail route when the id resolves — the
 * card's own navigation (this task's Scope: "Cards navigate to the
 * engagement's companies"). An id `companiesById` doesn't know about yet
 * (a stale reference) still links, using the raw id as its own label rather
 * than silently disappearing. */
function CompanyNameLink({ id, companiesById }: { id: string | null; companiesById: Map<string, Company> }) {
  if (id == null) return <>—</>
  return <Link to={`/company/${id}`}>{companiesById.get(id)?.name ?? id}</Link>
}

/** `.tag` in its default (uncoloured) variant — a small, quiet marker rather
 * than a status-like colour, since it isn't reporting a problem, only that
 * this particular number isn't real yet. Text stays the single word
 * `"Provisional"` (this task's Acceptance: asserted by a test so a later
 * styling pass can't drop it) with the reason in `title` instead of more
 * on-card text — ui-design.md's "spend text sparingly". */
function ProvisionalMark() {
  return <Tag title="No time entries logged yet — hours become real once the timelog import (P4-05) lands">Provisional</Tag>
}

// ---------------------------------------------------------------------------
// Progress shapes — one per billing model, dispatched by
// `EngagementProgress`. `equity` and `none` (and a null `billingModel`) fall
// through to no shape at all.
// ---------------------------------------------------------------------------

/** Shared shell for the two hours-derived shapes (retainer, T&M): a bar and
 * a meta line underneath it. The bar's fill is a flat CSS `width: 0` — see
 * this file's header — not a computed percentage, so there is no fictional
 * "in progress" width to un-notice once real hours land. */
function HoursProgress({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="bar">
        <i />
      </div>
      <div className="meta prog-meta">{children}</div>
    </div>
  )
}

function RetainerProgress({ hoursIncluded }: { hoursIncluded: number | null }) {
  // No allowance on record — nothing to show a ratio against.
  if (hoursIncluded == null) return null
  return (
    <HoursProgress>
      <span>0 of {hoursIncluded} hrs this month</span>
      <ProvisionalMark />
    </HoursProgress>
  )
}

function TmProgress({ estimatedHours, notToExceedCents }: { estimatedHours: number | null; notToExceedCents: number | null }) {
  if (estimatedHours == null) return null
  return (
    <HoursProgress>
      <span>0 of ~{estimatedHours} hrs</span>
      <ProvisionalMark />
      {notToExceedCents != null && <span>not to exceed ${centsToDecimalString(notToExceedCents)}</span>}
    </HoursProgress>
  )
}

/** Milestones aren't hours-derived — `completedAt` is set by hand on the
 * `milestones` table, not read from `time_entries` — so this shape carries
 * no `ProvisionalMark`. `milestones` comes back `[]` for every engagement
 * until the (out-of-scope, P3-09) milestone editor writes rows for it; that
 * renders as "0 of 0 milestones", a true count, not a placeholder. */
function MilestoneProgress({ milestones }: { milestones: readonly Milestone[] }) {
  const total = milestones.length
  const done = milestones.filter((milestone) => milestone.completedAt != null).length
  return (
    <div>
      <div className="prog">
        {milestones.map((milestone) => (
          <i key={milestone.id} className={milestone.completedAt != null ? 'on' : undefined} title={milestone.name ?? undefined} />
        ))}
      </div>
      <div className="meta prog-meta">
        {done} of {total} milestone{total === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function EngagementProgress({ engagement, milestones }: { engagement: Engagement; milestones: readonly Milestone[] }) {
  switch (engagement.billingModel) {
    case 'retainer':
      return <RetainerProgress hoursIncluded={engagement.hoursIncluded} />
    case 'fixed':
      return <MilestoneProgress milestones={milestones} />
    case 'tm':
      return <TmProgress estimatedHours={engagement.estimatedHours} notToExceedCents={engagement.notToExceedCents} />
    default:
      // 'equity', 'none', and a null billingModel all render nothing.
      return null
  }
}

// ---------------------------------------------------------------------------
// One engagement's card body, and the status-grouped card it sits in.
// ---------------------------------------------------------------------------

const EMPTY_MILESTONES: readonly Milestone[] = []

function EngagementCardRow({
  engagement,
  companiesById,
  milestones
}: {
  engagement: Engagement
  companiesById: Map<string, Company>
  milestones: readonly Milestone[]
}) {
  const showClient = engagement.clientCompanyId != null && engagement.clientCompanyId !== engagement.billingCompanyId
  return (
    // The scroll target for a command-palette engagement result
    // (T-260828-37): an engagement has no detail route of its own, so ⌘K
    // lands on this view and scrolls to the row. The id is built by
    // `engagementAnchorId` rather than written out here, so the two halves of
    // the anchor cannot drift.
    <div className="eng" id={engagementAnchorId(engagement.id)}>
      <div className="eng-t">
        <span className="nm trunc">{engagement.name}</span>
        {isTaggableModel(engagement.billingModel) && <ModelTag model={engagement.billingModel}>{MODEL_LABEL[engagement.billingModel]}</ModelTag>}
      </div>
      <div className="meta" style={{ marginTop: 6 }}>
        <CompanyNameLink id={engagement.billingCompanyId} companiesById={companiesById} />
      </div>
      {showClient && (
        <div className="via">
          <ViaIcon />
          for <CompanyNameLink id={engagement.clientCompanyId} companiesById={companiesById} />
        </div>
      )}
      <div className="meta" style={{ marginTop: 5 }}>
        {formatRange(engagement.startedOn, engagement.endsOn)}
      </div>
      <EngagementProgress engagement={engagement} milestones={milestones} />
    </div>
  )
}

interface StatusGroup {
  status: EngagementStatus
  rows: readonly Engagement[]
}

function StatusCard({
  group,
  companiesById,
  milestonesByEngagementId
}: {
  group: StatusGroup
  companiesById: Map<string, Company>
  milestonesByEngagementId: Map<string, readonly Milestone[]>
}) {
  return (
    <Card>
      <Card.Header title={STATUS_LABEL[group.status]} count={group.rows.length} />
      {group.rows.map((engagement) => (
        <EngagementCardRow
          key={engagement.id}
          engagement={engagement}
          companiesById={companiesById}
          milestones={engagement.billingModel === 'fixed' ? (milestonesByEngagementId.get(engagement.id) ?? EMPTY_MILESTONES) : EMPTY_MILESTONES}
        />
      ))}
    </Card>
  )
}

// ---------------------------------------------------------------------------

export function Engagements() {
  const { openSheet } = useLayerManager()

  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })

  const engagements: readonly Engagement[] = engagementsQuery.data ?? []
  const companies: readonly Company[] = companiesQuery.data ?? []
  const companiesById = new Map(companies.map((company) => [company.id, company] as const))

  // Milestones are fetched only for fixed-scope engagements — the one model
  // whose progress shape needs them (this task's Scope) — one
  // `engagements:milestones` query per id via `useQueries`, not a bulk
  // channel (none exists), keeping every other model's card free of a query
  // it has no use for.
  const fixedEngagementIds = engagements.filter((engagement) => engagement.billingModel === 'fixed').map((engagement) => engagement.id)
  const milestonesResults = useQueries({
    queries: fixedEngagementIds.map((id) => ({
      queryKey: queryKeys.engagements.milestones(id),
      queryFn: ipcQueryFn('engagements:milestones', { engagementId: id })
    }))
  })
  const milestonesByEngagementId = new Map<string, readonly Milestone[]>()
  fixedEngagementIds.forEach((id, index) => {
    milestonesByEngagementId.set(id, milestonesResults[index]?.data ?? EMPTY_MILESTONES)
  })

  // Grouped in `ENGAGEMENT_STATUSES`' own order (this task's Acceptance:
  // "all six status groups... an empty group is omitted rather than shown
  // empty") — an engagement whose `status` is `null` matches no group and
  // does not render; the six named statuses are the whole vocabulary this
  // task's Scope draws cards for.
  const groups: StatusGroup[] = ENGAGEMENT_STATUSES.map((status) => ({
    status,
    rows: engagements.filter((engagement) => engagement.status === status)
  })).filter((group) => group.rows.length > 0)

  const isLoading = engagementsQuery.isPending || companiesQuery.isPending
  const loadError = engagementsQuery.error ?? companiesQuery.error

  const header = (
    <ViewHeader
      icon={<EngagementsGlyph />}
      accent="var(--lapis-deep)"
      title="Engagements"
      description="Each engagement carries a billing model. Retainers show hours against the monthly allowance, fixed scopes show milestones completed, T&M shows hours against the estimate — hours stay provisional until the timelog import lands."
      actions={
        <Button variant="ghost" onClick={(event) => openSheet('engagement', 'New engagement', event.currentTarget)}>
          <PlusIcon />
          New engagement
        </Button>
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

  if (groups.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          action={
            <Button variant="primary" onClick={(event) => openSheet('engagement', 'New engagement', event.currentTarget)}>
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
      <div className="status-grid">
        {groups.map((group) => (
          <StatusCard key={group.status} group={group} companiesById={companiesById} milestonesByEngagementId={milestonesByEngagementId} />
        ))}
      </div>
    </div>
  )
}
