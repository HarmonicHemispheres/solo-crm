import { BILLING_MODELS, ENGAGEMENT_STATUSES, type BillingModel, type EngagementStatus, type EngagementWithOffering } from '../../shared/engagements'
import type { Company } from '../../shared/companies'

/**
 * How the engagements page is grouped and filtered — the arithmetic, with no
 * React in it, so the ordering rules below can be stated as tests rather than
 * inferred from a rendered list.
 *
 * The view used to group by `status` and only by `status`, which is the wrong
 * default for a one-person consultancy: three cards headed Active, Delivered
 * and Proposed answer "what state is my work in", and the question actually
 * being asked of this page is "what am I doing for whom". Grouping by client
 * puts one card per payer with everything you have ever done for them in it;
 * status and model stay available for the other two questions.
 */

export const GROUP_MODES = ['client', 'status', 'model'] as const
export type GroupMode = (typeof GROUP_MODES)[number]

export const GROUP_MODE_OPTIONS = [
  { value: 'client', label: 'Client' },
  { value: 'status', label: 'Status' },
  { value: 'model', label: 'Model' }
] as const satisfies ReadonlyArray<{ value: GroupMode; label: string }>

export type StatusFilter = EngagementStatus | 'all'
export type ModelFilter = BillingModel | 'all'

export const STATUS_LABEL: Record<EngagementStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  proposed: 'Proposed',
  held: 'Held',
  delivered: 'Delivered',
  lost: 'Lost'
}

export const MODEL_LABEL: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed',
  tm: 'T&M',
  equity: 'Equity',
  none: 'Unpriced'
}

/** The key a group with nothing to name it uses — an engagement with no billing party, or no model. */
export const UNGROUPED_KEY = '__none__'

/**
 * Sorting inside a group: live work first, finished work last, and within a
 * band the most recently started first. Not alphabetical — a card holding
 * eight years of one client's work should open on this year's.
 */
const STATUS_RANK: Record<EngagementStatus, number> = {
  active: 0,
  pending: 1,
  proposed: 2,
  held: 3,
  delivered: 4,
  lost: 5
}

export interface EngagementGroup {
  readonly key: string
  readonly label: string
  /** Set when the group *is* a company, so the header can draw its logo and link to it. */
  readonly companyId: string | null
  /** Set when grouping by status — the header's swatch. */
  readonly status: EngagementStatus | null
  /** Set when grouping by model, for the same reason. */
  readonly model: BillingModel | null
  readonly rows: readonly EngagementWithOffering[]
}

/** One count per option, so a filter chip can say how many rows choosing it leaves. Counts are over the *other* filter's result, which is what makes the numbers add up to what you then see. */
export interface FilterCounts {
  readonly total: number
  readonly byStatus: ReadonlyMap<EngagementStatus, number>
  readonly byModel: ReadonlyMap<BillingModel, number>
}

function sortWithinGroup(a: EngagementWithOffering, b: EngagementWithOffering): number {
  const rank = (a.status == null ? 99 : STATUS_RANK[a.status]) - (b.status == null ? 99 : STATUS_RANK[b.status])
  if (rank !== 0) return rank
  // `started_on` is a date-only value (CONVENTIONS.md), so a plain string
  // compare is a date compare — no parsing, and no timezone to get wrong.
  return b.startedOn.localeCompare(a.startedOn) || a.name.localeCompare(b.name)
}

export function filterEngagements(
  engagements: readonly EngagementWithOffering[],
  status: StatusFilter,
  model: ModelFilter
): readonly EngagementWithOffering[] {
  return engagements.filter(
    (engagement) => (status === 'all' || engagement.status === status) && (model === 'all' || engagement.billingModel === model)
  )
}

/**
 * The counts each chip shows. A status chip counts rows matching *the model
 * filter*, and vice versa — so picking Retainer changes the status counts to
 * the retainers in each status, and the chip you press next tells the truth
 * about what you will get. Counting the unfiltered list instead would show
 * "Delivered 3" and then produce one row.
 */
export function filterCounts(engagements: readonly EngagementWithOffering[], status: StatusFilter, model: ModelFilter): FilterCounts {
  const byStatus = new Map<EngagementStatus, number>()
  const byModel = new Map<BillingModel, number>()
  for (const engagement of engagements) {
    if (engagement.status != null && (model === 'all' || engagement.billingModel === model)) {
      byStatus.set(engagement.status, (byStatus.get(engagement.status) ?? 0) + 1)
    }
    if (engagement.billingModel != null && (status === 'all' || engagement.status === status)) {
      byModel.set(engagement.billingModel, (byModel.get(engagement.billingModel) ?? 0) + 1)
    }
  }
  return { total: filterEngagements(engagements, status, model).length, byStatus, byModel }
}

/**
 * The groups, in the order they are drawn. An empty group is never emitted —
 * a card headed "Held 0" is a card spent saying nothing happened.
 *
 * Client groups are alphabetical: a page you come to looking for one client
 * should let you find them, and "most engagements first" makes the position
 * of every card depend on data that changes. The unnamed group — engagements
 * with no billing party — sorts last whatever its name would be, because it
 * is a gap in the data rather than a payer.
 *
 * Status and model groups keep their vocabulary's own declared order
 * (`ENGAGEMENT_STATUSES`, `BILLING_MODELS`), which is already the order they
 * mean something in: live work before finished work.
 */
export function groupEngagements(
  engagements: readonly EngagementWithOffering[],
  mode: GroupMode,
  companiesById: ReadonlyMap<string, Company>
): readonly EngagementGroup[] {
  if (mode === 'status') {
    return ENGAGEMENT_STATUSES.map((status) => ({
      key: status,
      label: STATUS_LABEL[status],
      companyId: null,
      status,
      model: null,
      rows: engagements.filter((engagement) => engagement.status === status).sort(sortWithinGroup)
    })).filter((group) => group.rows.length > 0)
  }

  if (mode === 'model') {
    const groups: EngagementGroup[] = BILLING_MODELS.map((model) => ({
      key: model,
      label: MODEL_LABEL[model],
      companyId: null,
      status: null,
      model,
      rows: engagements.filter((engagement) => engagement.billingModel === model).sort(sortWithinGroup)
    }))
    const unmodelled = engagements.filter((engagement) => engagement.billingModel == null)
    if (unmodelled.length > 0) {
      groups.push({ key: UNGROUPED_KEY, label: 'No billing model', companyId: null, status: null, model: null, rows: [...unmodelled].sort(sortWithinGroup) })
    }
    return groups.filter((group) => group.rows.length > 0)
  }

  // By client — the billing party, which is who the invoice goes to and
  // therefore who a page of engagements is *about*. Work delivered for
  // someone else still files under its payer; the row says who it is for.
  const byCompany = new Map<string, EngagementWithOffering[]>()
  for (const engagement of engagements) {
    const key = engagement.billingCompanyId ?? UNGROUPED_KEY
    const rows = byCompany.get(key)
    if (rows) rows.push(engagement)
    else byCompany.set(key, [engagement])
  }

  return [...byCompany.entries()]
    .map(([key, rows]): EngagementGroup => ({
      key,
      label: key === UNGROUPED_KEY ? 'No billing party' : (companiesById.get(key)?.name ?? key),
      companyId: key === UNGROUPED_KEY ? null : key,
      status: null,
      model: null,
      rows: rows.sort(sortWithinGroup)
    }))
    .sort((a, b) => {
      if (a.key === UNGROUPED_KEY) return 1
      if (b.key === UNGROUPED_KEY) return -1
      return a.label.localeCompare(b.label)
    })
}
