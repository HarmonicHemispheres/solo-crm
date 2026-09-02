import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { ModelTag, type BillingModel as ModelTagBillingModel } from '../components/primitives/ModelTag'
import { Button } from '../components/primitives/Button'
import { IconButton } from '../components/primitives/IconButton'
import { ConfirmDelete } from '../components/primitives/ConfirmDelete'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { engagementAnchorId } from '../nav'
import { ipcQueryFn } from '../lib/ipc'
import { queryKeys } from '../lib/query-keys'
import { centsToDecimalString, parseDateOnly } from '../../shared/format'
import {
  ENGAGEMENT_STATUSES,
  type BillingModel,
  type Engagement,
  type EngagementStatus,
  type EngagementWithOffering,
  type Milestone
} from '../../shared/engagements'
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
 * `milestones:list`), a Pipeline nav item or board (ADR-005), filters
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

/** The "sold as" marker — a price-tag glyph, the catalogue's own shape. A
 * local copy for the same reason `ViaIcon` above is one. */
function SoldAsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--lapis)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width={11} height={11}>
      <path d="M11.5 3.5H20v8.5l-8.7 8.7a1.6 1.6 0 0 1-2.3 0l-6.2-6.2a1.6 1.6 0 0 1 0-2.3Z" />
      <path d="M16.5 7.5h.01" />
    </svg>
  )
}

/** The edit affordance's glyph — a local copy for the same reason `ViaIcon`
 * above is one: a view's own icons stay with the view (components/icons.tsx's
 * header: only glyphs a *primitive* renders itself live there), and
 * LinksCard.tsx already keeps its own identical copy under that rule. */
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5 17.5 9.5" />
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

/**
 * What an engagement is worth, on its own card.
 *
 * This replaces the hours bars that stood here (T-260902-10). Those read
 * "0 of 10 hrs this month" and "0 of ~18 hrs", with the 0 hardcoded and a
 * "Provisional" tag explaining that real hours arrive with a timelog import
 * (P4-05). The operator's verdict on that: "there's no way to book hours —
 * that's also not the job of this app. We're supposed to track our
 * engagements and forecast what revenue that will bring in." Which is right:
 * a permanent 0 out of N is not a fact about the engagement, it is the app
 * describing a feature it does not have, on every card, forever.
 *
 * **What is legal to show here, and what is not.** ADR-003 puts every
 * revenue figure through `revenue_lines` — and names two explicit
 * exceptions, of which the first is this one: "a single engagement's own
 * headline price — §6.4's card rendering '$6,500 / mo', '$18,000' or
 * '$175 / hr' ... It states the engagement's terms; it does not aggregate."
 * That is exactly what these lines are, read from the engagement's own
 * columns and no one else's.
 *
 * So there is deliberately **no annualised figure** here, and no total across
 * engagements. "$3,500/mo × 12 = $42,000/yr" is a projection over months,
 * which is an aggregation and an attribution to periods — the moment a
 * number does that it belongs to `revenue_lines` and the generator that
 * writes it (P3-05, scoped as T-260902-03). The Revenue view is where those
 * live; this is a card stating terms.
 *
 * The hours × rate product for a retainer is the same species as the rest:
 * one engagement's monthly price, from two of its own columns. The
 * engagement sheet shows the identical figure while it is being typed.
 */

/** `$3,500` — money as this app writes it everywhere else (`centsToDecimalString`, no locale grouping; that is P2-01's). */
function money(cents: number): string {
  return `$${centsToDecimalString(cents)}`
}

/** A retainer's monthly price, from whichever pair its basis names. `null` when the terms are not complete enough to state one — an unpriced retainer says so rather than showing `$0.00`. */
function retainerMonthly(engagement: Engagement): number | null {
  if (engagement.retainerBasis === 'amount') return engagement.monthlyAmountCents
  if (engagement.retainerBasis === 'hours') {
    if (engagement.hoursIncluded == null || engagement.hourlyRateCents == null) return null
    return Math.round(engagement.hoursIncluded * engagement.hourlyRateCents)
  }
  // No basis stated — every retainer written before migration 0008 (see its
  // header). There is nothing true to put here.
  return null
}

/** The terms line: mono, quiet, no sentence — `.claude/rules/ui-design.md`'s "numbers take a unit, not a sentence". */
function TermsLine({ children }: { children: ReactNode }) {
  return <div className="meta eng-terms">{children}</div>
}

function RetainerTerms({ engagement }: { engagement: Engagement }) {
  const monthly = retainerMonthly(engagement)
  if (monthly == null) {
    // Reachable two ways: a retainer from before the basis existed, and one
    // whose basis is set but whose numbers are not. Both are the same thing
    // to the operator — a retainer nobody has priced — and both are fixed in
    // the same place.
    return <TermsLine>No price set</TermsLine>
  }
  if (engagement.retainerBasis === 'hours') {
    return (
      <TermsLine>
        <strong>{money(monthly)} / mo</strong>
        <span className="eng-terms-basis">
          {engagement.hoursIncluded} hrs × {money(engagement.hourlyRateCents ?? 0)}
        </span>
      </TermsLine>
    )
  }
  return (
    <TermsLine>
      <strong>{money(monthly)} / mo</strong>
    </TermsLine>
  )
}

function FixedTerms({ engagement, milestones }: { engagement: Engagement; milestones: readonly Milestone[] }) {
  const done = milestones.filter((milestone) => milestone.completedAt != null).length
  return (
    <div>
      {/* The milestone pips stay — they are a true count of rows that exist,
          not a stand-in for a feature (which is what the hours bar was). They
          are simply absent when there are none, rather than drawing an empty
          track and "0 of 0". */}
      {milestones.length > 0 && (
        <div className="prog">
          {milestones.map((milestone) => (
            <i key={milestone.id} className={milestone.completedAt != null ? 'on' : undefined} title={milestone.name ?? undefined} />
          ))}
        </div>
      )}
      <TermsLine>
        {engagement.contractValueCents != null ? <strong>{money(engagement.contractValueCents)}</strong> : <span>No contract value set</span>}
        {milestones.length > 0 && (
          <span className="eng-terms-basis">
            {done} of {milestones.length} milestone{milestones.length === 1 ? '' : 's'}
          </span>
        )}
      </TermsLine>
    </div>
  )
}

function TmTerms({ engagement }: { engagement: Engagement }) {
  const { hourlyRateCents, estimatedHours, notToExceedCents } = engagement
  if (hourlyRateCents == null && estimatedHours == null && notToExceedCents == null) {
    return <TermsLine>No rate set</TermsLine>
  }
  // The estimate at the agreed rate — this engagement's own expected value,
  // capped by its own not-to-exceed where it has one. Still one engagement's
  // headline number (ADR-003), not a rollup.
  const estimate = hourlyRateCents != null && estimatedHours != null ? Math.round(estimatedHours * hourlyRateCents) : null
  const capped = estimate != null && notToExceedCents != null ? Math.min(estimate, notToExceedCents) : estimate
  return (
    <TermsLine>
      {capped != null && <strong>{money(capped)}</strong>}
      {hourlyRateCents != null && (
        <span className="eng-terms-basis">
          {estimatedHours != null ? `~${estimatedHours} hrs × ` : ''}
          {money(hourlyRateCents)} / hr
        </span>
      )}
      {notToExceedCents != null && <span className="eng-terms-basis">max {money(notToExceedCents)}</span>}
    </TermsLine>
  )
}

function EngagementProgress({ engagement, milestones }: { engagement: Engagement; milestones: readonly Milestone[] }) {
  switch (engagement.billingModel) {
    case 'retainer':
      return <RetainerTerms engagement={engagement} />
    case 'fixed':
      return <FixedTerms engagement={engagement} milestones={milestones} />
    case 'tm':
      return <TmTerms engagement={engagement} />
    default:
      // 'equity', 'none', and a null billingModel all render nothing: there
      // is no price to state, and inventing a line saying so on every equity
      // deal is text spent for nothing.
      return null
  }
}

// ---------------------------------------------------------------------------
// One engagement's card body, and the status-grouped card it sits in.
// ---------------------------------------------------------------------------

const EMPTY_MILESTONES: readonly Milestone[] = []

/** Opens the engagement sheet on an existing record. `trigger` is where focus returns when the sheet closes — the button that was clicked. */
/** The delete affordance's glyph — a local copy for the same reason `PencilIcon` is one (this file's header on per-view visuals). */
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

type EditEngagement = (id: string, trigger: HTMLElement | null) => void
/** Opens the delete confirmation on one engagement. The dialog itself is mounted once, by the view. */
type DeleteEngagement = (engagement: { id: string; name: string }) => void

function EngagementCardRow({
  engagement,
  companiesById,
  milestones,
  onEdit,
  onDelete
}: {
  engagement: EngagementWithOffering
  companiesById: Map<string, Company>
  milestones: readonly Milestone[]
  onEdit: EditEngagement
  onDelete: DeleteEngagement
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
        {/* ADR-005 leaves an engagement with no detail route, so the list is
            where editing has to happen. Icon-only with a label naming the
            engagement (ui-design.md), revealed on hover or focus and left
            visible below 700px where there is no hover — the same rule
            Row.css states for every other row action. */}
        <div className="eng-actions">
          <IconButton aria-label={`Edit "${engagement.name}"`} onClick={(event) => onEdit(engagement.id, event.currentTarget)}>
            <PencilIcon />
          </IconButton>
          <IconButton
            aria-label={`Delete "${engagement.name}"`}
            onClick={() => onDelete({ id: engagement.id, name: engagement.name })}
          >
            <TrashIcon />
          </IconButton>
        </div>
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
      {/* What this was sold as — the offering behind `offeringVersionId`,
          joined on by `engagements:list` (T-260901-13). A label in the same
          shape as the `for <company>` line above, not a sentence
          (ui-design.md), and deliberately no rate: the engagement's own
          `agreedRateCents` is the only source for that (P3-03), and a price
          read off the catalogue here would be the live-price join the
          acceptance forbids. Sold from nothing renders nothing. */}
      {engagement.offeringName != null && (
        <div className="sold-as">
          <SoldAsIcon />
          sold as {engagement.offeringName}
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
  rows: readonly EngagementWithOffering[]
}

function StatusCard({
  group,
  companiesById,
  milestonesByEngagementId,
  onEdit,
  onDelete
}: {
  group: StatusGroup
  companiesById: Map<string, Company>
  milestonesByEngagementId: Map<string, readonly Milestone[]>
  onEdit: EditEngagement
  onDelete: DeleteEngagement
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
  // One dialog for the whole view, holding whichever engagement asked for
  // it — rather than one mounted per row, which would put a modal's worth of
  // state behind every card on the page.
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })

  const engagements: readonly EngagementWithOffering[] = engagementsQuery.data ?? []
  const companies: readonly Company[] = companiesQuery.data ?? []
  const companiesById = new Map(companies.map((company) => [company.id, company] as const))

  // Milestones are fetched only for fixed-scope engagements — the one model
  // whose progress shape needs them (this task's Scope) — one
  // `milestones:list` query per id via `useQueries`, not a bulk
  // channel (none exists), keeping every other model's card free of a query
  // it has no use for.
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
        <Button variant="ghost" onClick={(event) => openSheet('engagement', event.currentTarget)}>
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
      <div className="status-grid">
        {groups.map((group) => (
          <StatusCard
            key={group.status}
            group={group}
            companiesById={companiesById}
            milestonesByEngagementId={milestonesByEngagementId}
            onEdit={handleEdit}
            onDelete={setDeleting}
          />
        ))}
      </div>
      {/* One dialog for the view, mounted only while a row has asked for it
          — see `deleting`'s own comment. No `onDeleted`: this list is where
          the operator already is, and the delete's invalidation removes the
          card from under them. */}
      {deleting && (
        <ConfirmDelete entity="engagement" id={deleting.id} name={deleting.name} onClose={() => setDeleting(null)} />
      )}
    </div>
  )
}
