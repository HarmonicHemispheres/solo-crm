import { sql } from 'drizzle-orm'
import { type AnySQLiteColumn, check, index, sqliteTable, text, integer, real, blob, unique } from 'drizzle-orm/sqlite-core'

/**
 * The Drizzle schema for requirements §5, as amended by ADR-001 through
 * ADR-003 (T-260828-01). This file is the source `drizzle-kit generate`
 * diffs against to produce `migrations/0001_*.sql` — the checked-in SQL is
 * what actually runs (`migrate.ts`), this file is what keeps the next
 * migration honest about what already exists.
 *
 * Two rules carried from CONVENTIONS.md apply to every table below and are
 * not repeated column-by-column:
 *
 * - Every date/timestamp column is `text`, never Drizzle's `integer({ mode:
 *   'timestamp' })` epoch encoding. SQLite has no date type; the app's is
 *   ISO text (`dateOnlySchema` / `timestampSchema`), written from JS via
 *   `nowTimestamp()` — never a SQL-side `DEFAULT`. No column below carries a
 *   default for `created_at`, `updated_at`, or any other timestamp/date, on
 *   purpose: `CURRENT_TIMESTAMP` produces a format `timestampSchema` rejects
 *   (CONVENTIONS.md, and T-260828-08's handoff to this task).
 * - Every money column is `integer` and ends `_cents`. Every duration/hours
 *   column is `real` (`numeric` in the §5 DDL comments) — SQLite's floating
 *   point type. That asymmetry is deliberate (CONVENTIONS.md, ADR-003).
 *
 * UUID primary keys are plain `text`, not a Drizzle-generated default: the
 * id is supplied by the repository layer at insert time (P1-xx, out of this
 * task's scope), the same way timestamps are — nothing here calls
 * `crypto.randomUUID()` or a SQL-side `DEFAULT`, so there is exactly one
 * place (the repository) that decides what an id looks like.
 *
 * `settings` and `favicons` are the two exemptions ADR-002 states as a
 * *class*, not a one-off: both are keyed by a value the outside world
 * already guarantees unique (a settings key; a favicon host), and no other
 * table holds a foreign key to either. Every other table — join tables
 * `affiliations` and `taggings` included — keeps a UUID primary key plus
 * `created_at`/`updated_at`. `schema.test.ts` asserts this table-by-table via
 * `pragma_table_info` rather than by review.
 *
 * `search_fts` and its triggers are deliberately absent (G6, ADR carried in
 * requirements §5): P1-06 creates both together, in its own migration,
 * because it needs these tables to already exist. `search_source` — FTS5's
 * content relation, materialised as a real table by T-260828-51's
 * `0003_search_content_table.sql` (ADR-009) — is absent for the same reason
 * and one more: it is not a table of records but a derived projection of the
 * five tables below, so AGENTS.md's UUID-key/timestamps rule does not reach
 * it (see that migration's own comment). Neither is declared here, so neither
 * shows up in `schema.test.ts`'s regeneration check.
 *
 * That check is incremental as of T-260828-41: it seeds a temp folder with
 * 0001's snapshot, regenerates from this file, and asserts the delta is
 * exactly `0004_fk_indexes_polymorphic_cascade.sql`'s `CREATE INDEX`
 * statements and nothing else. So this file stays the cumulative description
 * of the schema — 0001's tables *plus* 0004's indexes — while the checked-in
 * migrations stay incremental. Migration 0004's cascade triggers are not
 * declarable in Drizzle and are deliberately absent here; ADR-011 and that
 * migration's own header say where they live.
 */

// ---------------------------------------------------------------------------
// Companies, people, affiliations
// ---------------------------------------------------------------------------

export const companies = sqliteTable(
  'companies',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    // client | prospect | end_client | advisory | channel
    kind: text('kind'),
    website: text('website'),
    billsDirectly: integer('bills_directly', { mode: 'boolean' }).default(true),
    // Self-referencing: a company can be billed via another company. `id`
    // does not exist yet at the point this callback is defined, so the
    // return type is spelled out explicitly (AnySQLiteColumn) to sidestep
    // TypeScript's circular-inference error on a same-table self-reference.
    billedViaCompanyId: text('billed_via_company_id').references((): AnySQLiteColumn => companies.id),
    introducedByCompanyId: text('introduced_by_company_id').references((): AnySQLiteColumn => companies.id),
    cadenceDays: integer('cadence_days').default(14),
    // Denormalised on purpose — ADR-001. Never derived from
    // MAX(activity.occurred_at); maintained by the activity repository
    // (P1-05) and written directly by the Gmail adapter (P4-xx).
    lastTouchAt: text('last_touch_at'),
    budgetNote: text('budget_note'),
    notes: text('notes'),
    since: text('since'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    // The one CHECK this task's scope names explicitly (binding constraint,
    // taskplan P1-01 acceptance: "billed_via_company_id cannot point at
    // itself, enforced in the database"). NULL passes a SQLite CHECK (the
    // expression evaluates to NULL, not 0), so the ordinary "not billed via
    // anyone" case needs no separate allowance — the `IS NULL OR` below is
    // written out anyway so the constraint reads correctly without relying
    // on a reader already knowing that SQLite NULL-in-CHECK quirk.
    check(
      'companies_billed_via_company_not_self',
      sql`(${t.billedViaCompanyId} IS NULL OR ${t.billedViaCompanyId} != ${t.id})`
    ),
    // T-260828-41. Both are read by `deleteCompany`'s referential pre-checks
    // (`refuseIfReferenced`, one `SELECT COUNT(*)` per blocker) and by
    // nothing else yet. The rule every index added by that task follows: an
    // index exists because a query names the column, never for symmetry with
    // the foreign key — each one costs write throughput on the tables the
    // Gmail and timelog importers will hammer hardest.
    index('idx_companies_billed_via_company_id').on(t.billedViaCompanyId),
    index('idx_companies_introduced_by_company_id').on(t.introducedByCompanyId)
  ]
)

export const people = sqliteTable('people', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  notes: text('notes'),
  // As companies.last_touch_at — ADR-001.
  lastContactAt: text('last_contact_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// A UUID key rather than (person_id, company_id): a person can leave a
// company and return, so the pair legitimately repeats — ADR-002 settles
// this explicitly as "no unique constraint on the pair", unlike taggings
// below. §5's modelling note: "affiliations is its own table... a
// company_id on people would erase a contact's history the day they move."
export const affiliations = sqliteTable(
  'affiliations',
  {
    id: text('id').primaryKey().notNull(),
    personId: text('person_id').references(() => people.id),
    companyId: text('company_id').references(() => companies.id),
    title: text('title'),
    isPrimary: integer('is_primary', { mode: 'boolean' }),
    started: text('started'),
    ended: text('ended'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41. `person_id` is the hotter of the two: `people.ts` filters
  // on it for the primary-affiliation read and rewrite as well as for
  // `deletePerson`'s pre-check. `company_id` is read by `deleteCompany`'s.
  (t) => [index('idx_affiliations_person_id').on(t.personId), index('idx_affiliations_company_id').on(t.companyId)]
)

// ---------------------------------------------------------------------------
// Catalogue: services and products
// ---------------------------------------------------------------------------

export const serviceCategories = sqliteTable('service_categories', {
  id: text('id').primaryKey().notNull(),
  name: text('name'),
  color: text('color'),
  sort: integer('sort'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const services = sqliteTable('services', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  // service | product
  type: text('type'),
  categoryId: text('category_id').references(() => serviceCategories.id),
  // retainer | fixed | tm
  billingModel: text('billing_model'),
  // fixed | from | mo | hr
  unit: text('unit'),
  blurb: text('blurb'),
  active: integer('active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const serviceVersions = sqliteTable('service_versions', {
  id: text('id').primaryKey().notNull(),
  serviceId: text('service_id').references(() => services.id),
  version: integer('version'),
  rateCents: integer('rate_cents'),
  effectiveFrom: text('effective_from'),
  effectiveTo: text('effective_to'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// ---------------------------------------------------------------------------
// Engagements: the money-bearing unit
// ---------------------------------------------------------------------------

export const engagements = sqliteTable(
  'engagements',
  {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull(),
    // Who is on the invoice. Deliberately independent of client_company_id —
    // see §5's "modelling decisions to preserve": billing party and delivery
    // client are separate columns, never a parent/child link between
    // companies.
    billingCompanyId: text('billing_company_id').references(() => companies.id),
    // Who the work is for.
    clientCompanyId: text('client_company_id').references(() => companies.id),
    serviceVersionId: text('service_version_id').references(() => serviceVersions.id),
    // Snapshot at signature; never re-read from the price list (§5).
    agreedRateCents: integer('agreed_rate_cents'),
    // retainer | fixed | tm | equity | none
    billingModel: text('billing_model'),
    // active | pending | proposed | held | delivered | lost — 'lost' is part
    // of §5 as originally written (G3: "no DDL change; §5 already spans all
    // six statuses"), carried here so it is not silently dropped by a future
    // edit of this comment.
    status: text('status'),
    startedOn: text('started_on').notNull(),
    // NULL = rolling, not a far-future sentinel (§5's modelling note). No
    // default of any kind on this column.
    endsOn: text('ends_on'),
    renewsOn: text('renews_on'),
    // retainer
    hoursIncluded: real('hours_included'),
    // fixed
    contractValueCents: integer('contract_value_cents'),
    // tm
    hourlyRateCents: integer('hourly_rate_cents'),
    estimatedHours: real('estimated_hours'),
    notToExceedCents: integer('not_to_exceed_cents'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41. Both are read by `deleteEngagement`'s referential
  // pre-checks and by the engagement list filtered to one company.
  (t) => [
    index('idx_engagements_billing_company_id').on(t.billingCompanyId),
    index('idx_engagements_client_company_id').on(t.clientCompanyId)
  ]
)

export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey().notNull(),
    engagementId: text('engagement_id').references(() => engagements.id),
    name: text('name'),
    sort: integer('sort'),
    completedAt: text('completed_at'),
    amountCents: integer('amount_cents'),
    expectedMonth: text('expected_month'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41. Read by `deleteEngagement`'s first blocker, and by every
  // read of one engagement's milestones.
  (t) => [index('idx_milestones_engagement_id').on(t.engagementId)]
)

// Materialised revenue (ADR-003): one row per expected/actual amount per
// month. Every revenue rollup is SUM(amount_cents) ... GROUP BY period_month,
// status over this table — no other table produces a revenue figure.
export const revenueLines = sqliteTable(
  'revenue_lines',
  {
    id: text('id').primaryKey().notNull(),
    engagementId: text('engagement_id').references(() => engagements.id),
    // First-of-month, always (CONVENTIONS.md periodMonthSchema). Indexed —
    // this task's Risks note names it as one of the two tables that grow
    // (§8 targets 20k time entries; revenue_lines grows with it) and
    // retrofitting an index onto a populated table is the harder version of
    // adding it now.
    periodMonth: text('period_month').notNull(),
    amountCents: integer('amount_cents').notNull(),
    // retainer | milestone | tm_estimate | tm_actual | expense
    kind: text('kind'),
    // projected | invoiced | paid
    status: text('status'),
    invoicedAt: text('invoiced_at'),
    paidAt: text('paid_at'),
    stripeInvoiceId: text('stripe_invoice_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    index('idx_revenue_lines_period_month').on(t.periodMonth),
    // T-260828-41. Read by `deleteEngagement`'s blocker and by every
    // per-engagement revenue rollup; period_month's index does not help a
    // query that names only the engagement.
    index('idx_revenue_lines_engagement_id').on(t.engagementId)
  ]
)

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: text('id').primaryKey().notNull(),
    engagementId: text('engagement_id').references(() => engagements.id),
    companyId: text('company_id').references(() => companies.id),
    // date (YYYY-MM-DD), not a timestamp — CONVENTIONS.md.
    workedOn: text('worked_on'),
    // numeric/REAL, not integer minutes — CONVENTIONS.md's "why hours are
    // floating point and money is not".
    hours: real('hours'),
    note: text('note'),
    // manual | timelog_csv
    source: text('source'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    // Same note as revenue_lines.period_month: §8 targets 20k time entries,
    // and worked_on is the column every hours-derived figure filters or
    // sorts by (retainer hours-used, effective rate).
    index('idx_time_entries_worked_on').on(t.workedOn),
    // T-260828-41. Both are delete pre-checks — `engagement_id` in
    // `deleteEngagement`, `company_id` in `deleteCompany` — and both are
    // how hours-used and effective-rate are derived per engagement/company.
    index('idx_time_entries_engagement_id').on(t.engagementId),
    index('idx_time_entries_company_id').on(t.companyId)
  ]
)

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

// §5's literal DDL omits explicit `references` clauses on tasks'
// company_id/engagement_id/person_id (unlike every other single-target FK
// column in the schema) — read as terseness rather than a deliberate
// unconstrained-by-design choice: nothing in the ADRs states a reason to
// leave these three unenforced, and this task's own Risks section names
// "a schema full of unenforced references" as the exact failure mode this
// pair of tasks exists to avoid. A nullable FK still accepts NULL (SQLite
// never checks a NULL FK column against the referenced table), so adding
// the constraint costs nothing against the columns' documented optionality
// and only rules out a bogus non-null id. See this task's report for the
// alternative read.
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey().notNull(),
    title: text('title').notNull(),
    // todo | waiting | done
    status: text('status'),
    isNextStep: integer('is_next_step', { mode: 'boolean' }).default(false),
    dueOn: text('due_on'),
    waitingSince: text('waiting_since'),
    doneAt: text('done_at'),
    companyId: text('company_id').references(() => companies.id),
    engagementId: text('engagement_id').references(() => engagements.id),
    personId: text('person_id').references(() => people.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41. All three are delete pre-checks (one per owning
  // repository), and `company_id` is additionally what `tasks.ts`'s
  // next-step transaction reads and rewrites on every task write.
  (t) => [
    index('idx_tasks_company_id').on(t.companyId),
    index('idx_tasks_engagement_id').on(t.engagementId),
    index('idx_tasks_person_id').on(t.personId)
  ]
)

// Append-only under G8 (enforced at the repository boundary — no update/
// delete channel — not by a trigger, which would also block the
// repository's own writes). created_at and updated_at are always equal as a
// consequence, kept anyway for a uniform rule across every table (§5).
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey().notNull(),
    occurredAt: text('occurred_at').notNull(),
    // call | email | meeting | note
    kind: text('kind'),
    title: text('title'),
    body: text('body'),
    // See the note on tasks above — the same reasoning applies here.
    companyId: text('company_id').references(() => companies.id),
    personId: text('person_id').references(() => people.id),
    engagementId: text('engagement_id').references(() => engagements.id),
    // manual | gcal — 'gmail' is reserved with no writer (ADR-001): the Gmail
    // adapter writes companies.last_touch_at / people.last_contact_at
    // directly and never inserts an activity row.
    source: text('source'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41, and the one set of the group that is not optional: activity
  // is append-only and the fastest-growing table in the app (§8 targets 20k
  // rows before the Gmail adapter adds any), it is a blocker in all three
  // entity deletes, and the timeline read for one company/person/engagement
  // filters on exactly these columns.
  (t) => [
    index('idx_activity_company_id').on(t.companyId),
    index('idx_activity_person_id').on(t.personId),
    index('idx_activity_engagement_id').on(t.engagementId)
  ]
)

// ---------------------------------------------------------------------------
// External references: links, favicons, external_refs
// ---------------------------------------------------------------------------

// entity_type/entity_id is a polymorphic reference (a link can attach to a
// company, a person, an engagement, ...) — no single-table FK is possible,
// so unlike tasks/activity above there is no `references()` to add here.
export const links = sqliteTable(
  'links',
  {
    id: text('id').primaryKey().notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    url: text('url'),
    title: text('title'),
    // drive | notion | github | figma | stripe | pdf | slack | web
    kind: text('kind'),
    addedAt: text('added_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41. The composite, in this column order, is what every query
  // against a polymorphic reference looks like: `listLinks` filters on both
  // columns together, never `entity_id` alone (see `links.ts`), and so do
  // the cascade and existence triggers migration 0004 installs. A pair of
  // single-column indexes would leave SQLite to pick one and filter the
  // rest by hand.
  (t) => [index('idx_links_entity').on(t.entityType, t.entityId)]
)

// Keyed by host — a natural identity, ADR-002's exemption class alongside
// `settings`. Carries fetched_at only: a cache entry has one timestamp that
// matters, and neither created_at nor updated_at is written.
export const favicons = sqliteTable('favicons', {
  host: text('host').primaryKey().notNull(),
  bytes: blob('bytes', { mode: 'buffer' }),
  fetchedAt: text('fetched_at')
})

export const externalRefs = sqliteTable(
  'external_refs',
  {
    id: text('id').primaryKey().notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    source: text('source'),
    externalId: text('external_id'),
    url: text('url'),
    lastSyncedAt: text('last_synced_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  // T-260828-41, same shape and same reason as `links` above: this is the
  // column pair migration 0004's cascade trigger deletes by. No repository
  // writes this table yet; the index exists because the trigger does.
  (t) => [index('idx_external_refs_entity').on(t.entityType, t.entityId)]
)

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey().notNull(),
  name: text('name'),
  color: text('color'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

// Keeps a UUID key; the natural triple is enforced as a unique index, not
// as the primary key (ADR-002) — unlike affiliations, a tag genuinely
// applies to a thing once.
export const taggings = sqliteTable(
  'taggings',
  {
    id: text('id').primaryKey().notNull(),
    tagId: text('tag_id').references(() => tags.id),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    unique('taggings_tag_entity_unique').on(t.tagId, t.entityType, t.entityId),
    // T-260828-41. `taggings_tag_entity_unique` cannot serve the cascade:
    // its leading column is `tag_id`, and a query that names only
    // `entity_type`/`entity_id` cannot use an index whose first column it
    // does not constrain.
    index('idx_taggings_entity').on(t.entityType, t.entityId)
  ]
)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Keyed by `key` — a natural identity, exempt from the UUID primary key
// rule along with favicons (ADR-002). Carries updated_at (last-write-wins is
// what a future replica needs) and no created_at (a setting has no creation
// event worth recording — its default was in force before the row existed).
// NON-SECRET VALUES ONLY — ADR-004: credentials live in Electron
// safeStorage, never here. Nothing in this migration enforces that at the
// database level; it is a rule the settings repository (P2-01) owns.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull()
})
