import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { ChainCycleError, ChainDepthExceededError, MAX_CHAIN_DEPTH, walkChain } from '../chain-walk'
import { formatDateOnly, formatTimestamp, nowTimestamp, parseDateOnly } from '../../../shared/format'
import { dateOnlySchema } from '../../../shared/types'
import type { DateOnly, Timestamp } from '../../../shared/types'
import type { CompanySeed } from './fixture'
import {
  MOCKUP_TODAY,
  activity as activityFixture,
  companies as companiesFixture,
  engagements as engagementsFixture,
  people as peopleFixture,
  serviceCategories as serviceCategoriesFixture,
  services as servicesFixture,
  tasks as tasksFixture
} from './fixture'

/**
 * Loads `./fixture.ts`'s data through the real `openDatabase()`/
 * `getDatabase()` path — this module never constructs a `better-sqlite3`
 * handle itself; `connection.test.ts`'s "single owner of the SQLite
 * connection" test forbids that of every module under `electron/`, this one
 * included.
 *
 * ---- The date-basis decision (task Risks) ----------------------------
 *
 * The mockup's dates are all relative to a frozen `TODAY` (2026-08-27,
 * `MOCKUP_TODAY` above). Two options: seed them absolute (the literal
 * mockup dates, honest and reproducible, but ageing — every cadence ring,
 * "going quiet" sort and overdue/waiting-since chip in the app computes
 * against the *real* current date, so a database seeded once and used for
 * weeks of UI work drifts further from the mockup's intended mix of fresh/
 * stale states every day that passes); or offset from today at seed time
 * (not reproducible run-to-run, but always demonstrates the states the
 * fixture exists to exercise — an overdue todo, a waiting item ageing, a
 * company past its cadence).
 *
 * This loader shifts every domain date/timestamp by the number of days
 * between `MOCKUP_TODAY` and the real date `seedFixture` runs on, computed
 * once per run (`computeOffsetDays`). That is the choice this task's
 * Outcome should record for P2-03 (decay work) and X-07 (the performance
 * harness): **offset, not absolute** — this is a *dev* fixture whose job is
 * to make every view reviewable against the mockup on whatever day someone
 * seeds it, not a stable snapshot a test asserts literal date strings
 * against (this file's own tests assert relative/derived properties, never
 * a hardcoded absolute date). `created_at`/`updated_at` on every row are
 * the one exception: those are genuinely "when this row was written," so
 * they use `nowTimestamp()` unshifted, the same as any other write.
 *
 * `computeOffsetDays` deliberately reads the operator's *local* calendar
 * date, not UTC — see that function's own comment for why that is the one
 * correct exception to CONVENTIONS.md's usual UTC rule.
 *
 * ---- Guard ---------------------------------------------------------------
 *
 * `seedFixture` refuses to insert into a database that already has rows in
 * any table this fixture writes, unless `force` is passed — and even then
 * it never deletes anything first. A seed that truncates tables to make
 * itself idempotent is a data-loss tool one flag away from a real database
 * (the task's Risks); this loader is append-only regardless of `force`.
 */

const SEED_TABLES = [
  'companies',
  'people',
  'affiliations',
  'service_categories',
  'services',
  'service_versions',
  'engagements',
  'tasks',
  'activity',
  'links'
] as const

export class SeedGuardError extends Error {}

function countRows(db: Database.Database, table: (typeof SEED_TABLES)[number]): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

function assertSeedableOrForced(db: Database.Database, force: boolean): void {
  // Checked first, before any of the ten COUNT scans below: forcing makes
  // the scan's answer irrelevant, so there is no reason to run it.
  if (force) return
  const populated = SEED_TABLES.filter((table) => countRows(db, table) > 0)
  if (populated.length === 0) return
  throw new SeedGuardError(
    `Refusing to seed: the database already has rows in ${populated.join(', ')}. ` +
      'Re-run with --force to seed anyway — this adds another copy of the fixture ' +
      'alongside the existing rows (verified: doubles every table\'s count). Forcing ' +
      'never deletes anything first, so re-seeding a populated database on purpose still ' +
      'means living with the duplicates afterward, not a clean slate.'
  )
}

// ---------------------------------------------------------------------------
// Date-basis shifting (see the header comment above)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

/**
 * Today's calendar date in the *caller's local timezone*, not UTC — the one
 * deliberate exception to CONVENTIONS.md's "always read/write dates with the
 * UTC accessors" rule (`electron/shared/format.ts`'s own header comment).
 * That rule exists to stop a *stored* date from silently shifting by a day
 * depending on which machine reads it; this calculation answers a different
 * question — "what calendar day is it for the person running `npm run
 * seed`, right now" — which is inherently local. Reading it off UTC instead
 * means anyone west of UTC (Pacific, say) gets tomorrow's date for roughly
 * the back half of every day, because UTC has already rolled over while
 * their local clock has not — the seed would land one day ahead of what the
 * operator actually typed. The mockup's own frozen reference (`const TODAY
 * = new Date('2026-08-27T09:00:00')`, no trailing `Z`) is itself a local
 * time for the same reason: the mockup's cadence math was never meant to be
 * timezone-aware, just "today" in whoever's browser rendered it.
 */
function localDateOnly(date: Date): DateOnly {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return dateOnlySchema.parse(`${year}-${month}-${day}`)
}

function computeOffsetDays(referenceNow: Date): number {
  const mockupTodayMs = parseDateOnly(MOCKUP_TODAY).getTime()
  const todayMs = parseDateOnly(localDateOnly(referenceNow)).getTime()
  return Math.round((todayMs - mockupTodayMs) / DAY_MS)
}

function shiftDateOnly(value: string, offsetDays: number): DateOnly {
  return formatDateOnly(new Date(parseDateOnly(value).getTime() + offsetDays * DAY_MS))
}

function shiftDateOnlyOrNull(value: string | null, offsetDays: number): DateOnly | null {
  return value === null ? null : shiftDateOnly(value, offsetDays)
}

/**
 * A small, deterministic (not random — same key always yields the same
 * time) hour/minute derived from a fixture key, so timestamp columns the
 * mockup only gave a date for (activity.occurred_at, last_touch_at,
 * last_contact_at, done_at) get a plausible, varied time of day rather than
 * every row landing on midnight.
 *
 * The hour is written as a UTC hour (`shiftToTimestamp` builds the instant
 * via `Date.UTC`), narrowed to 16:00-19:00 UTC — mid-morning to mid-
 * afternoon across the continental US (this business's actual operating
 * timezones) in both standard and daylight time. That is a deliberate
 * shrink from a wider band: a UTC hour near either edge of the day risks
 * displaying as the *previous* or *next* calendar day once rendered in a
 * viewer's local time, which would silently detach an activity row's
 * displayed date from the calendar day `computeOffsetDays`/`shiftDateOnly`
 * intended. This narrows the risk for this fixture's realistic operator
 * timezones; it is not a claim of safety for arbitrary timezones (a
 * viewer far enough east — UTC+10 and beyond — can still roll to the next
 * local day), which a cosmetic time-of-day on dev-only seed data does not
 * warrant solving in general.
 */
function timeOfDayFor(key: string): { hour: number; minute: number } {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return { hour: 16 + (hash % 4), minute: (hash * 7) % 60 }
}

function shiftToTimestamp(dateValue: string, offsetDays: number, key: string): Timestamp {
  const shifted = shiftDateOnly(dateValue, offsetDays)
  const [year, month, day] = shifted.split('-').map(Number)
  const { hour, minute } = timeOfDayFor(key)
  return formatTimestamp(new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0)))
}

// ---------------------------------------------------------------------------
// Company insertion order
// ---------------------------------------------------------------------------

export class FixtureIntegrityError extends Error {}

/**
 * Returns `companies` reordered so that a company's `billedViaCompanyKey`
 * target always comes before it. SQLite checks foreign keys **immediately**
 * on every `INSERT` — nothing in migration 0001 is `DEFERRABLE` — so the
 * order rows are actually written in matters; pre-assigning every company's
 * id up front (in `seedFixture`, below) only resolves what *value* a FK
 * column holds, it does not make the insertion order safe by itself.
 * Without this function, correctness would depend on `fixture.ts` happening
 * to list EZDeploy before W+K and Programetrix — true today, and silent and
 * easy to break with an unrelated edit to that file. This makes insertion
 * order correct regardless of how `companies` is ordered in the fixture;
 * `index.test.ts` proves it against a deliberately reversed copy, and a
 * genuine cycle (two companies billed via each other) fails loudly here,
 * before any `INSERT` runs, rather than surfacing as an opaque SQLite
 * FOREIGN KEY constraint failure.
 *
 * The cycle/depth detection itself is `../chain-walk.ts`'s `walkChain` — the
 * same traversal `repositories/companies.ts` calls for its
 * `billed_via_company_id`/`introduced_by_company_id` write-time guard
 * (T-260828-42), so the rule "a billed-via chain may not loop back on
 * itself" is expressed once, not twice with the risk of the two drifting.
 * This function still owns the parts that are genuinely seed-loader-specific
 * — resolving a `billedViaCompanyKey` to a fixture row (and refusing a
 * dangling one) and producing a full topological order — `walkChain` only
 * supplies the "does this chain repeat a node" primitive.
 */
export function orderCompaniesForInsert(companies: readonly CompanySeed[]): readonly CompanySeed[] {
  const byKey = new Map(companies.map((c) => [c.key, c]))
  const ordered: CompanySeed[] = []
  const orderedKeys = new Set<string>()

  const getParent = (company: CompanySeed): CompanySeed | null => {
    if (!company.billedViaCompanyKey) return null
    const parent = byKey.get(company.billedViaCompanyKey)
    if (!parent) {
      throw new FixtureIntegrityError(
        `company "${company.key}" has billedViaCompanyKey "${company.billedViaCompanyKey}", ` +
          'which is not a key of any company in fixture.ts.'
      )
    }
    return parent
  }

  for (const company of companies) {
    if (orderedKeys.has(company.key)) continue

    let chain: readonly CompanySeed[]
    try {
      // `chain` runs from `company` up to the root (no parent), farthest
      // ancestor last — exactly the reverse of the order they must be
      // inserted in.
      chain = walkChain(company, getParent, (c) => c.key, MAX_CHAIN_DEPTH)
    } catch (error) {
      // A cycle and a chain that is merely absurdly long are different facts
      // about the fixture and each gets its own sentence (T-260828-56) —
      // saying "cycle" for a 60-deep acyclic chain sends whoever edited
      // fixture.ts looking for a loop that is not there.
      if (error instanceof ChainCycleError) {
        const at = (error.node as CompanySeed).key
        throw new FixtureIntegrityError(
          `fixture.ts's companies form a billed-via cycle involving "${at}" — ` +
            'a company cannot be billed via itself, even transitively.'
        )
      }
      if (error instanceof ChainDepthExceededError) {
        throw new FixtureIntegrityError(
          `fixture.ts's billed-via chain starting at "${company.key}" runs more than ` +
            `${MAX_CHAIN_DEPTH} companies deep without reaching one that bills directly. ` +
            'That is past the runaway bound the walk stops at; shorten the chain.'
        )
      }
      throw error
    }

    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const node = chain[i]
      if (orderedKeys.has(node.key)) continue
      ordered.push(node)
      orderedKeys.add(node.key)
    }
  }

  return ordered
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface SeedFixtureOptions {
  /** Bypasses the non-empty-database guard. Never causes a delete — see the header comment. */
  readonly force?: boolean
  /** Tests only: the instant `MOCKUP_TODAY`-relative dates are shifted against, in place of the real current time. */
  readonly referenceNow?: Date
}

export function seedFixture(db: Database.Database, options: SeedFixtureOptions = {}): void {
  assertSeedableOrForced(db, options.force ?? false)

  const offsetDays = computeOffsetDays(options.referenceNow ?? new Date())
  const seededAt = nowTimestamp()

  const run = db.transaction(() => {
    // ---- ids, assigned up front so any row's FK column can be resolved to
    // a value regardless of *lookup* order. This does not by itself make
    // *insertion* order safe (SQLite's foreign keys are checked
    // immediately, not deferred) — see orderCompaniesForInsert above for
    // the one table here that actually needs a specific insertion order. ----
    const companyIds = new Map(companiesFixture.map((c) => [c.key, randomUUID()]))
    const personIds = new Map(peopleFixture.map((p) => [p.key, randomUUID()]))
    const categoryIds = new Map(serviceCategoriesFixture.map((c) => [c.key, randomUUID()]))
    const serviceIds = new Map(servicesFixture.map((s) => [s.key, randomUUID()]))
    // Keyed "serviceKey:version" -> service_versions.id, so engagements can
    // resolve their (service, version) pair to the row that actually
    // carries that price.
    const serviceVersionIds = new Map<string, string>()
    for (const service of servicesFixture) {
      for (const version of service.versions) {
        serviceVersionIds.set(`${service.key}:${version.version}`, randomUUID())
      }
    }
    const engagementIds = new Map(engagementsFixture.map((e) => [e.key, randomUUID()]))

    // ---- service_categories ----
    const insertCategory = db.prepare(
      `INSERT INTO service_categories (id, name, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const category of serviceCategoriesFixture) {
      insertCategory.run(categoryIds.get(category.key), category.name, category.color, category.sort, seededAt, seededAt)
    }

    // ---- services ----
    const insertService = db.prepare(
      `INSERT INTO services (id, name, type, category_id, billing_model, unit, blurb, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const service of servicesFixture) {
      insertService.run(
        serviceIds.get(service.key),
        service.name,
        service.type,
        categoryIds.get(service.categoryKey),
        service.billingModel,
        service.unit,
        service.blurb,
        service.active ? 1 : 0,
        seededAt,
        seededAt
      )
    }

    // ---- service_versions ----
    const insertServiceVersion = db.prepare(
      `INSERT INTO service_versions (id, service_id, version, rate_cents, effective_from, effective_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const service of servicesFixture) {
      for (const version of service.versions) {
        insertServiceVersion.run(
          serviceVersionIds.get(`${service.key}:${version.version}`),
          serviceIds.get(service.key),
          version.version,
          version.rateCents,
          shiftDateOnly(version.effectiveFrom, offsetDays),
          shiftDateOnlyOrNull(version.effectiveTo, offsetDays),
          seededAt,
          seededAt
        )
      }
    }

    // ---- last_touch_at is computed from this fixture's own activity rows,
    // grouped by company, before any company row is written. This is a
    // property of how THIS fixture happens to be constructed, not a rule
    // the app enforces: ADR-001 rule 6 is explicit that the column and
    // `activity` answer different questions (cadence vs. what happened) and
    // are ALLOWED to differ — the real Gmail adapter writes last_touch_at
    // directly with no matching activity row at all (ADR-001 rule 3). The
    // mockup's own per-company `lastTouch` value happens to equal that
    // company's one activity row's date for all ten companies here
    // (checked against the source at port time), so computing it from
    // activity reproduces the mockup's own number without stating it twice
    // in fixture.ts — that is why `CompanySeed` carries no separate
    // `lastTouch` field. Nothing here would stop a future seed from setting
    // last_touch_at independently for a company with no matching activity
    // row; this fixture simply never needs to. ----
    const lastTouchByCompany = new Map<string, { occurredAt: Timestamp; occurredAtMs: number }>()
    for (const entry of activityFixture) {
      const occurredAt = shiftToTimestamp(entry.occurredOn, offsetDays, entry.key)
      const occurredAtMs = new Date(occurredAt).getTime()
      const existing = lastTouchByCompany.get(entry.companyKey)
      if (!existing || occurredAtMs > existing.occurredAtMs) {
        lastTouchByCompany.set(entry.companyKey, { occurredAt, occurredAtMs })
      }
    }

    // ---- companies ----
    const insertCompany = db.prepare(
      `INSERT INTO companies
         (id, name, kind, website, bills_directly, billed_via_company_id, cadence_days, last_touch_at, budget_note, notes, since, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const company of orderCompaniesForInsert(companiesFixture)) {
      insertCompany.run(
        companyIds.get(company.key),
        company.name,
        company.kind,
        company.website,
        company.billsDirectly ? 1 : 0,
        company.billedViaCompanyKey ? companyIds.get(company.billedViaCompanyKey) : null,
        company.cadenceDays,
        lastTouchByCompany.get(company.key)?.occurredAt ?? null,
        company.budgetNote,
        company.notes,
        shiftDateOnly(company.since, offsetDays),
        seededAt,
        seededAt
      )
    }

    // ---- people ----
    const insertPerson = db.prepare(
      `INSERT INTO people (id, name, email, phone, notes, last_contact_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertAffiliation = db.prepare(
      `INSERT INTO affiliations (id, person_id, company_id, title, is_primary, started, ended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const person of peopleFixture) {
      // people has no column for the mockup's title/tag chip — title lives
      // on the affiliations row when there is a company to attach it to
      // (see below); with no company there is no affiliations row, so both
      // fold into notes instead of being silently dropped.
      const notes = person.companyKey ? person.tag : [person.title, person.tag].filter(Boolean).join(' · ')
      insertPerson.run(
        personIds.get(person.key),
        person.name,
        person.email,
        null,
        notes || null,
        shiftToTimestamp(person.lastContactDate, offsetDays, person.key),
        seededAt,
        seededAt
      )
      if (person.companyKey) {
        insertAffiliation.run(
          randomUUID(),
          personIds.get(person.key),
          companyIds.get(person.companyKey),
          person.title,
          1,
          null,
          null,
          seededAt,
          seededAt
        )
      }
    }

    // ---- engagements ----
    const insertEngagement = db.prepare(
      `INSERT INTO engagements
         (id, name, billing_company_id, client_company_id, service_version_id, agreed_rate_cents, billing_model, status,
          started_on, ends_on, renews_on, hours_included, contract_value_cents, hourly_rate_cents, estimated_hours,
          not_to_exceed_cents, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const engagement of engagementsFixture) {
      insertEngagement.run(
        engagementIds.get(engagement.key),
        engagement.name,
        companyIds.get(engagement.billingCompanyKey),
        companyIds.get(engagement.clientCompanyKey),
        // `!= null` on purpose, not `&&`/truthiness: a service version
        // number of 0 is a legitimate value and must not be treated the
        // same as "no service" the way a falsy check would.
        engagement.serviceKey != null && engagement.serviceVersion != null
          ? serviceVersionIds.get(`${engagement.serviceKey}:${engagement.serviceVersion}`)
          : null,
        engagement.agreedRateCents,
        engagement.billingModel,
        engagement.status,
        shiftDateOnly(engagement.startedOn, offsetDays),
        shiftDateOnlyOrNull(engagement.endsOn, offsetDays),
        null,
        engagement.hoursIncluded,
        engagement.contractValueCents,
        engagement.hourlyRateCents,
        engagement.estimatedHours,
        engagement.notToExceedCents,
        engagement.notes,
        seededAt,
        seededAt
      )
    }

    // ---- tasks ----
    const insertTask = db.prepare(
      `INSERT INTO tasks (id, title, status, is_next_step, due_on, waiting_since, done_at, company_id, engagement_id, person_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const task of tasksFixture) {
      insertTask.run(
        randomUUID(),
        task.title,
        task.status,
        task.isNextStep ? 1 : 0,
        shiftDateOnlyOrNull(task.dueOn, offsetDays),
        shiftDateOnlyOrNull(task.waitingSince, offsetDays),
        task.doneOn ? shiftToTimestamp(task.doneOn, offsetDays, task.key) : null,
        task.companyKey ? companyIds.get(task.companyKey) : null,
        task.engagementKey ? engagementIds.get(task.engagementKey) : null,
        null,
        seededAt,
        seededAt
      )
    }

    // ---- activity ----
    const insertActivity = db.prepare(
      `INSERT INTO activity (id, occurred_at, kind, title, body, company_id, person_id, engagement_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const entry of activityFixture) {
      insertActivity.run(
        randomUUID(),
        shiftToTimestamp(entry.occurredOn, offsetDays, entry.key),
        entry.kind,
        entry.title,
        entry.body,
        companyIds.get(entry.companyKey),
        null,
        null,
        'manual',
        seededAt,
        seededAt
      )
    }

    // ---- links (Scope: "the links attached to each company") ----
    const insertLink = db.prepare(
      `INSERT INTO links (id, entity_type, entity_id, url, title, kind, added_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const company of companiesFixture) {
      for (const link of company.links) {
        insertLink.run(randomUUID(), 'company', companyIds.get(company.key), link.url, link.title, link.kind, seededAt, seededAt, seededAt)
      }
    }
  })

  run()
}
