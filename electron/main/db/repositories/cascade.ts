import type Database from 'better-sqlite3'
import type { DeletionImpact, DeletionImpactEntry } from '../../../shared/deletion'

/**
 * Cascading deletes, and the preview of one (T-260902-09).
 *
 * Every `deleteX` in this directory refuses when anything still points at the
 * row — `referential-guard.ts`'s `refuseIfReferenced`, which throws a
 * `RefusalError` naming the blocker. That is still the default and still the
 * right one: a delete that quietly takes six other records with it is not a
 * delete anyone asked for.
 *
 * But it left the operator with no way out. The refusal names what is in the
 * way and nothing in the app can clear it — a company with activity on it
 * could never be removed, because activity is append-only and has no delete
 * of its own. "We cannot delete engagements, companies, people or offerings.
 * We need a way to do this."
 *
 * So there are two paths now, and the second one is explicit: ask what a
 * delete would take (`planFor(...)` + `impactOf(...)`), show it, and only
 * then run it (`runCascade(...)`).
 *
 * **The one property that matters here is that the preview and the delete
 * cannot disagree.** A confirmation dialog that under-counts is worse than
 * no dialog: the operator approves losing three things and loses nine. So a
 * step declares one `where` clause and *both* operations are derived from
 * it — `SELECT COUNT(*) FROM t WHERE <where>` and `DELETE FROM t WHERE
 * <where>` — rather than a counting query being written beside a deleting
 * one and kept in step by hand. `cascade.test.ts` also asserts the two agree
 * for real rows, because a shared string is only half the guarantee: the
 * *order* of the steps still has to leave nothing behind, which is what
 * `foreign_key_check` after the fact proves.
 *
 * **On activity and G8.** `deleteCompany`'s refusal says activity "is
 * append-only (G8) and cannot be reassigned or removed to make room", and a
 * cascade deletes it. That is not a reversal of G8, which is about a
 * correction being a new row rather than an edit to an old one — the history
 * of a relationship is not rewritable. Deleting the company *is* the
 * relationship ending; keeping its history would mean rows pointing at a
 * company that no longer exists, which the foreign keys forbid anyway. See
 * ADR-017.
 */

/**
 * One table a delete reaches, and what it does there.
 *
 * `where` is a SQL fragment with `?` placeholders, `params` says how many of
 * them there are (each is bound to the same id — a company appears twice in
 * the engagements clause, once per column). It is deliberately a string
 * rather than a structured filter: two of these need a subselect
 * (`engagement_id IN (SELECT ...)`) and inventing a query builder to express
 * that would obscure the one thing worth reading here, which is exactly
 * which rows go.
 *
 * Every fragment is a literal in this file. Nothing that crossed the IPC
 * boundary is interpolated — the same trust boundary `referential-guard.ts`
 * states for its own identifiers.
 */
export interface CascadeStep {
  readonly table: string
  readonly where: string
  readonly params: number
  /**
   * `delete` removes the matching rows. `clear` keeps them and NULLs
   * `columns` — for a reference whose target is going away but whose holder
   * is not: another company that billed through this one is still a company,
   * and an engagement sold from a deleted offering is still an engagement.
   */
  readonly action: 'delete' | 'clear'
  readonly columns?: readonly string[]
  /** What the confirmation calls these rows — plural, lowercase: "activity records". */
  readonly label: string
}

/** An entity's whole plan: the ordered steps, then the row itself. Children first, so nothing is orphaned mid-transaction. */
export interface CascadePlan {
  readonly table: string
  readonly steps: readonly CascadeStep[]
}

/** The engagements attached to a company, by either of the two independent columns (§5). Used as a subselect by the steps that clear out those engagements' own children. */
const COMPANY_ENGAGEMENTS = 'SELECT id FROM engagements WHERE billing_company_id = ? OR client_company_id = ?'

/**
 * An engagement's own children — every table with a foreign key at
 * `engagements.id`. The company plan below reaches the same five through a
 * subselect rather than reusing this list, because three of them can also
 * name the company directly and there the two clauses have to be merged into
 * one step (see that plan's comment on double-counting). Keeping this list
 * here is still worth it: it is the answer to "what points at an
 * engagement", and `cascade.test.ts` runs `foreign_key_check` after each
 * delete, so a sixth table added to the schema and missed from both plans
 * fails rather than orphaning rows.
 */
const ENGAGEMENT_CHILD_TABLES = [
  { table: 'milestones', label: 'milestones' },
  { table: 'revenue_lines', label: 'revenue lines' },
  { table: 'time_entries', label: 'time entries' },
  { table: 'tasks', label: 'todos' },
  { table: 'activity', label: 'activity records' }
] as const

const ENGAGEMENT_PLAN: CascadePlan = {
  table: 'engagements',
  steps: [
    ...ENGAGEMENT_CHILD_TABLES.map(
      ({ table, label }): CascadeStep => ({ table, where: 'engagement_id = ?', params: 1, action: 'delete', label })
    )
    // `links`, `taggings` and `external_refs` are not here: migration 0004's
    // `trg_engagements_attachments_ad` removes them on delete (ADR-011), and
    // a step doing it again would be a second, divergent copy of that rule.
  ]
}

const PERSON_PLAN: CascadePlan = {
  table: 'people',
  steps: [
    { table: 'affiliations', where: 'person_id = ?', params: 1, action: 'delete', label: 'company affiliations' },
    { table: 'activity', where: 'person_id = ?', params: 1, action: 'delete', label: 'activity records' },
    { table: 'tasks', where: 'person_id = ?', params: 1, action: 'delete', label: 'todos' }
  ]
}

const COMPANY_PLAN: CascadePlan = {
  table: 'companies',
  steps: [
    // Milestones and revenue lines hang off engagements only, so they are
    // reached through the subselect and nothing else.
    { table: 'milestones', where: `engagement_id IN (${COMPANY_ENGAGEMENTS})`, params: 2, action: 'delete', label: 'milestones' },
    { table: 'revenue_lines', where: `engagement_id IN (${COMPANY_ENGAGEMENTS})`, params: 2, action: 'delete', label: 'revenue lines' },
    // These three can name the company *or* one of its engagements, and one
    // row often names both. Each is therefore ONE step with an `OR`, not a
    // company step beside an engagement step: two overlapping steps count
    // the same row twice, and the preview would tell the operator that five
    // activity records are going when four are. Over-counting is the safer
    // direction to be wrong in and still wrong — the dialog's numbers are
    // the only thing it is for. `cascade.test.ts` compares the promised
    // total against rows actually removed, which is what caught this.
    {
      table: 'time_entries',
      where: `company_id = ? OR engagement_id IN (${COMPANY_ENGAGEMENTS})`,
      params: 3,
      action: 'delete',
      label: 'time entries'
    },
    { table: 'tasks', where: `company_id = ? OR engagement_id IN (${COMPANY_ENGAGEMENTS})`, params: 3, action: 'delete', label: 'todos' },
    {
      table: 'activity',
      where: `company_id = ? OR engagement_id IN (${COMPANY_ENGAGEMENTS})`,
      params: 3,
      action: 'delete',
      label: 'activity records'
    },
    // Now the engagements themselves, everything that pointed at them having
    // gone above.
    { table: 'engagements', where: 'billing_company_id = ? OR client_company_id = ?', params: 2, action: 'delete', label: 'engagements' },
    { table: 'affiliations', where: 'company_id = ?', params: 1, action: 'delete', label: 'contact affiliations' },
    // Other companies survive; only their pointer at this one goes. A
    // company that billed through this one is still a company, and deleting
    // it would be a cascade nobody could have predicted from the dialog.
    {
      table: 'companies',
      where: 'billed_via_company_id = ?',
      params: 1,
      action: 'clear',
      columns: ['billed_via_company_id'],
      label: 'companies that bill through it'
    },
    {
      table: 'companies',
      where: 'introduced_by_company_id = ?',
      params: 1,
      action: 'clear',
      columns: ['introduced_by_company_id'],
      label: 'companies it introduced'
    }
    // `company_images` is absent deliberately: its foreign key is the
    // schema's one `ON DELETE cascade` (migration 0007), so SQLite removes
    // those rows itself. A step here would still work, but it would imply
    // the cascade is this file's doing when it is the schema's.
  ]
}

const OFFERING_PLAN: CascadePlan = {
  table: 'offerings',
  steps: [
    // An engagement sold from this offering is not deleted with it — it is a
    // signed piece of work, and the price list is only where its terms were
    // copied from. It loses the link and keeps the `agreed_rate_cents`
    // snapshot it took at signature, which is the whole point of that column
    // being a snapshot (electron/shared/engagements.ts's header).
    {
      table: 'engagements',
      where: 'offering_version_id IN (SELECT id FROM offering_versions WHERE offering_id = ?)',
      params: 1,
      action: 'clear',
      columns: ['offering_version_id'],
      label: 'engagements sold from it (they keep their agreed rate)'
    },
    { table: 'offering_versions', where: 'offering_id = ?', params: 1, action: 'delete', label: 'price versions' }
  ]
}

const PLANS = {
  company: COMPANY_PLAN,
  person: PERSON_PLAN,
  engagement: ENGAGEMENT_PLAN,
  offering: OFFERING_PLAN
} as const

export type CascadeEntity = keyof typeof PLANS

export function planFor(entity: CascadeEntity): CascadePlan {
  return PLANS[entity]
}

/** The id, bound once per `?` in the step's `where`. */
function bindings(step: CascadeStep, id: string): string[] {
  return Array.from({ length: step.params }, () => id)
}

/**
 * What `runCascade` would do, without doing it — the numbers a confirmation
 * dialog shows. Steps that match nothing are omitted rather than listed as
 * zero: a dialog offering to delete "0 todos" is noise standing between the
 * operator and the counts that are real.
 */
export function impactOf(db: Database.Database, entity: CascadeEntity, id: string, name: string): DeletionImpact {
  const entries: DeletionImpactEntry[] = []
  for (const step of planFor(entity).steps) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${step.table} WHERE ${step.where}`).get(...bindings(step, id)) as {
      count: number
    }
    if (row.count === 0) continue
    entries.push({ label: step.label, count: row.count, action: step.action })
  }
  return { entity, id, name, entries }
}

/**
 * Runs the plan, then deletes the row itself. **Caller supplies the
 * transaction** — every `deleteX` in this directory already opens one around
 * its existence check, and the check and the cascade have to be inside the
 * same one or a row could arrive between them.
 *
 * Order is the plan's order, which is children-before-parents. Nothing here
 * re-checks the foreign keys afterwards; `cascade.test.ts` runs
 * `foreign_key_check` on a seeded database after each entity's cascade,
 * which is the assertion that the order is right.
 */
export function runCascade(db: Database.Database, entity: CascadeEntity, id: string): void {
  const plan = planFor(entity)
  for (const step of plan.steps) {
    const params = bindings(step, id)
    if (step.action === 'delete') {
      db.prepare(`DELETE FROM ${step.table} WHERE ${step.where}`).run(...params)
    } else {
      const assignments = (step.columns ?? []).map((column) => `${column} = NULL`).join(', ')
      db.prepare(`UPDATE ${step.table} SET ${assignments} WHERE ${step.where}`).run(...params)
    }
  }
  db.prepare(`DELETE FROM ${plan.table} WHERE id = ?`).run(id)
}
