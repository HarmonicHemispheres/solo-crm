/**
 * The dev fixture's raw data (T-260828-13), extracted from
 * `planning/solo-crm-mockup.html`'s `let companies/people/engagements/
 * activity/todos/categories/services = [...]` arrays (that file's lines
 * ~586-791 at the time this was ported). Every value below is transcribed
 * from those literals, not invented — cross-checked field by field against
 * the mockup source.
 *
 * This file holds data only, already reshaped onto the real schema's field
 * names and enum values — the mapping `./ index.ts`'s loader assumes is
 * already done by the time it reads this file:
 *
 * - `bills` -> `billsDirectly`, `via` -> `billedViaCompanyKey`, `co` (on a
 *   person) -> `companyKey` (resolved to an `affiliations` row by the
 *   loader, not stored as a FK on `people` itself).
 * - Title Case -> the schema's lowercase enums: company `kind` (`Client` ->
 *   `client`, `End client` -> `end_client`), engagement `status` (`Active`
 *   -> `active`, ...), activity `kind` (`Call` -> `call`, ...). Engagement
 *   `model` and task `status` were already lowercase in the mockup.
 * - Dollar amounts (`agreedRate`, service `rate`, engagement `value`/
 *   `hourly`) -> integer cents (CONVENTIONS.md: money columns end `_cents`).
 * - `since`/`co` on a company that was mockup-shorthand `YYYY-MM` -> the
 *   first of that month, `YYYY-MM-01` (`dateOnlySchema` rejects a bare
 *   year-month).
 *
 * `companies.lastTouch` is deliberately NOT a field on `CompanySeed` — the
 * loader computes `last_touch_at` from `ActivitySeed` instead
 * (MAX(occurred_at) per company). This is a fixture-authoring convenience,
 * not an app-level rule: ADR-001 rule 6 is explicit that `last_touch_at`
 * and `activity` answer different questions (cadence vs. what happened)
 * and are ALLOWED to differ — the real Gmail adapter writes the column with
 * no matching activity row at all (ADR-001 rule 3). Dropping the field here
 * only works because, in this specific dataset, the mockup's per-company
 * `lastTouch` value is identical to that company's one activity row's date
 * for all ten companies (checked field-by-field against the source at port
 * time) — computing it from activity reproduces the mockup's own number
 * without stating it twice in this file. A seed that needed a company's
 * last_touch_at to disagree with its activity log (a Gmail-sourced touch,
 * say) would need to carry the field independently instead; nothing here
 * forbids that, this fixture just never needs it.
 *
 * `people.last_contact_at` is not derived the same way: the mockup's
 * `activity` array is company-scoped only (no `people` entries), so there
 * is no activity row to compute a contact's `last_contact_at` from in the
 * first place. `PersonSeed` therefore carries `lastContactDate` directly.
 *
 * Dates below are still in the mockup's own frame of reference (relative to
 * `const TODAY = new Date('2026-08-27T09:00:00')`, planning/solo-crm-mockup
 * .html line 585) — `./index.ts` shifts every date/timestamp by the same
 * number of days at load time; see that file's header comment for why.
 */

export interface LinkSeed {
  readonly url: string
  readonly title: string
  /** drive | notion | github | figma | stripe | pdf | slack | web */
  readonly kind: string
}

export interface CompanySeed {
  readonly key: string
  readonly name: string
  /** client | prospect | end_client | advisory | channel */
  readonly kind: string
  readonly website: string | null
  readonly billsDirectly: boolean
  readonly billedViaCompanyKey: string | null
  readonly cadenceDays: number
  readonly budgetNote: string | null
  readonly notes: string | null
  /** YYYY-MM-DD, mockup-relative. */
  readonly since: string
  readonly links: readonly LinkSeed[]
}

export interface PersonSeed {
  readonly key: string
  readonly name: string
  readonly email: string | null
  /**
   * The person's role — stored on the `affiliations` row when `companyKey`
   * is set (affiliations has its own `title` column); folded into
   * `people.notes` when it is not (no company means no affiliations row to
   * hold it).
   */
  readonly title: string | null
  readonly companyKey: string | null
  /** YYYY-MM-DD, mockup-relative. Maps to `people.last_contact_at`. */
  readonly lastContactDate: string
  /** The mockup's contact-card chip (e.g. "Decision maker") — folded into `people.notes`, no schema column of its own. */
  readonly tag: string | null
}

export interface ServiceCategorySeed {
  readonly key: string
  readonly name: string
  readonly color: string
  readonly sort: number
}

export interface ServiceVersionSeed {
  readonly version: number
  readonly rateCents: number
  /** YYYY-MM-DD, mockup-relative. */
  readonly effectiveFrom: string
  /** YYYY-MM-DD, mockup-relative, or null (current version). */
  readonly effectiveTo: string | null
}

export interface ServiceSeed {
  readonly key: string
  readonly name: string
  /** service | product */
  readonly type: string
  readonly categoryKey: string
  /** retainer | fixed | tm */
  readonly billingModel: string
  /** fixed | from | mo | hr */
  readonly unit: string
  readonly blurb: string
  readonly active: boolean
  readonly versions: readonly ServiceVersionSeed[]
}

export interface EngagementSeed {
  readonly key: string
  readonly name: string
  readonly billingCompanyKey: string
  readonly clientCompanyKey: string
  readonly serviceKey: string | null
  readonly serviceVersion: number | null
  readonly agreedRateCents: number | null
  /** retainer | fixed | tm | equity | none */
  readonly billingModel: string
  /** active | pending | proposed | held | delivered | lost */
  readonly status: string
  /** YYYY-MM-DD, mockup-relative. */
  readonly startedOn: string
  /** YYYY-MM-DD, mockup-relative, or null (rolling — no agreed finish). */
  readonly endsOn: string | null
  readonly hoursIncluded: number | null
  readonly contractValueCents: number | null
  readonly hourlyRateCents: number | null
  readonly estimatedHours: number | null
  readonly notToExceedCents: number | null
  readonly notes: string | null
}

export interface ActivitySeed {
  readonly key: string
  readonly companyKey: string
  /** call | email | meeting | note */
  readonly kind: string
  readonly title: string
  readonly body: string | null
  /** YYYY-MM-DD, mockup-relative. The loader assigns a synthetic time of day and derives the owning company's last_touch_at from this value. */
  readonly occurredOn: string
}

export interface TaskSeed {
  readonly key: string
  readonly title: string
  /** todo | waiting | done */
  readonly status: string
  readonly isNextStep: boolean
  readonly companyKey: string | null
  readonly engagementKey: string | null
  /** YYYY-MM-DD, mockup-relative, or null. */
  readonly dueOn: string | null
  /** YYYY-MM-DD, mockup-relative, or null — set only when status is 'waiting'. */
  readonly waitingSince: string | null
  /** YYYY-MM-DD, mockup-relative, or null — set only when status is 'done'; the mockup carries no separate completion date, so the due date stands in. */
  readonly doneOn: string | null
}

/** planning/solo-crm-mockup.html line 585: `const TODAY = new Date('2026-08-27T09:00:00')`. Every date below is relative to this. */
export const MOCKUP_TODAY = '2026-08-27'

export const companies: readonly CompanySeed[] = [
  {
    key: 'rinvii',
    name: 'Rinvii',
    kind: 'client',
    website: 'rinvii.com',
    billsDirectly: true,
    billedViaCompanyKey: null,
    cadenceDays: 7,
    budgetNote: null,
    notes: 'Recurring monthly retainer — advising plus hands-on development.',
    since: '2026-03-01',
    links: [
      { url: 'https://notion.so/rinvii-hub', title: 'Rinvii — engagement hub', kind: 'notion' },
      { url: 'https://drive.google.com/drive/folders/rinvii', title: '04 Rinvii / SOWs', kind: 'drive' },
      { url: 'https://drive.google.com/file/rinvii-msa.pdf', title: 'Rinvii MSA (signed).pdf', kind: 'pdf' },
      { url: 'https://dashboard.stripe.com/customers/cus_RNV', title: 'Stripe · cus_RNV', kind: 'stripe' }
    ]
  },
  {
    key: 'sandsage',
    name: 'Sand & Sage',
    kind: 'client',
    website: 'sandandsage.co',
    billsDirectly: true,
    billedViaCompanyKey: null,
    cadenceDays: 7,
    budgetNote: null,
    notes: 'SiteFacts build on a monthly retainer. Sand & Sage owns the IP; 5% equity held personally.',
    since: '2025-11-01',
    links: [
      { url: 'https://notion.so/sitefacts-gis', title: 'SiteFacts — GIS catalog', kind: 'notion' },
      { url: 'https://drive.google.com/drive/folders/sitefacts', title: 'SiteFacts / schema explorer', kind: 'drive' },
      { url: 'https://github.com/sitefacts/pipeline', title: 'sitefacts-pipeline', kind: 'github' },
      { url: 'https://drive.google.com/file/ss-retainer.pdf', title: 'S&S retainer agreement.pdf', kind: 'pdf' }
    ]
  },
  {
    key: 'ezdeploy',
    name: 'EZDeploy',
    kind: 'client',
    website: 'ezdeploy.io',
    billsDirectly: true,
    billedViaCompanyKey: null,
    cadenceDays: 10,
    budgetNote: null,
    notes: 'Bills for work delivered to their own customers, plus their internal platform work.',
    since: '2026-02-01',
    links: [
      { url: 'https://notion.so/ezdeploy-msa', title: 'EZDeploy — master agreement', kind: 'notion' },
      { url: 'https://drive.google.com/drive/folders/ezdeploy', title: 'EZDeploy /', kind: 'drive' },
      { url: 'https://dashboard.stripe.com/customers/cus_EZD', title: 'Stripe · cus_EZD', kind: 'stripe' }
    ]
  },
  {
    key: 'wk',
    name: 'W+K',
    kind: 'end_client',
    website: 'wk.com',
    billsDirectly: false,
    billedViaCompanyKey: 'ezdeploy',
    cadenceDays: 14,
    budgetNote: '$18,000 approved',
    notes: 'Samay timesheet agent. Delivery relationship only — EZDeploy holds the contract.',
    since: '2026-02-01',
    links: [
      { url: 'https://notion.so/samay-arch', title: 'Samay — architecture', kind: 'notion' },
      { url: 'https://figma.com/file/samay-ui', title: 'Samay UI flows', kind: 'figma' },
      { url: 'https://drive.google.com/drive/folders/wk', title: 'W+K / demos', kind: 'drive' }
    ]
  },
  {
    key: 'programetrix',
    name: 'Programetrix',
    kind: 'end_client',
    website: 'programetrix.com',
    billsDirectly: false,
    billedViaCompanyKey: 'ezdeploy',
    cadenceDays: 30,
    budgetNote: '$4,200 spent',
    notes: 'Agents audit, delivered. Dormant unless EZDeploy re-opens it.',
    since: '2026-04-01',
    links: [{ url: 'https://drive.google.com/file/prog-audit.pdf', title: 'Programetrix audit.pdf', kind: 'pdf' }]
  },
  {
    key: 'radial',
    name: 'Radial Holdings',
    kind: 'client',
    website: 'vedx.com',
    billsDirectly: true,
    billedViaCompanyKey: null,
    cadenceDays: 21,
    budgetNote: null,
    notes: 'VedX portal and support agent, both delivered. No live scope.',
    since: '2025-09-01',
    links: [
      { url: 'https://notion.so/vedx-handoff', title: 'VedX — handoff', kind: 'notion' },
      { url: 'https://dashboard.stripe.com/customers/cus_RAD', title: 'Stripe · cus_RAD', kind: 'stripe' }
    ]
  },
  {
    key: 'naslund',
    name: 'Naslund Waste',
    kind: 'prospect',
    website: 'naslundwaste.com',
    billsDirectly: true,
    billedViaCompanyKey: null,
    cadenceDays: 7,
    budgetNote: '$28,500 proposed',
    notes: 'Fixed-scope SOW out for signature.',
    since: '2026-08-01',
    links: [
      { url: 'https://drive.google.com/file/naslund-sow-v2.pdf', title: 'Naslund SOW v2.pdf', kind: 'pdf' },
      { url: 'https://drive.google.com/drive/folders/naslund', title: 'Naslund Waste /', kind: 'drive' }
    ]
  },
  {
    key: 'theroute',
    name: 'The Route',
    kind: 'advisory',
    website: null,
    billsDirectly: false,
    billedViaCompanyKey: null,
    cadenceDays: 21,
    budgetNote: 'Next-year budget',
    notes: 'Federal AI grant pending; budget starts next year across 12 months.',
    since: '2026-05-01',
    links: [{ url: 'https://notion.so/route-grant', title: 'The Route — grant narrative', kind: 'notion' }]
  },
  {
    key: 'northbank',
    name: 'Northbank Innovations',
    kind: 'channel',
    website: 'northbank.org',
    billsDirectly: false,
    billedViaCompanyKey: null,
    cadenceDays: 30,
    budgetNote: null,
    notes: 'Referral channel. Sponsorship tier under review.',
    since: '2026-01-01',
    links: [{ url: 'https://notion.so/northbank-ev', title: 'Northbank — sponsorship EV', kind: 'notion' }]
  },
  {
    key: 'thompson',
    name: 'Ben Thompson — LEGO resale',
    kind: 'prospect',
    website: null,
    billsDirectly: true,
    billedViaCompanyKey: null,
    cadenceDays: 14,
    budgetNote: null,
    notes: 'Wants the side business to run itself.',
    since: '2026-06-01',
    links: [{ url: 'https://notion.so/thompson-discovery', title: 'Ben Thompson — discovery', kind: 'notion' }]
  }
]

export const people: readonly PersonSeed[] = [
  {
    key: 'don',
    name: 'Don Healy',
    email: 'don@sandandsage.co',
    title: 'Owner / CEO',
    companyKey: 'sandsage',
    lastContactDate: '2026-08-25',
    tag: 'Decision maker'
  },
  {
    key: 'dave',
    name: 'Dave Barcos',
    email: 'dave@northbank.org',
    title: 'Northbank Innovations',
    companyKey: 'northbank',
    lastContactDate: '2026-06-14',
    tag: 'Referral source'
  },
  {
    key: 'ben',
    name: 'Ben Thompson',
    email: 'ben@example.com',
    title: 'Sr. accounting lead, Waste Connections',
    companyKey: 'thompson',
    lastContactDate: '2026-07-08',
    tag: 'Prospect'
  },
  {
    key: 'jereme',
    name: 'Jereme Wingert',
    email: 'jereme@example.com',
    title: 'Contractor — Magic Factory R&D',
    companyKey: null,
    lastContactDate: '2026-08-24',
    tag: 'Bench'
  },
  {
    key: 'carrie',
    name: 'Carrie Hefner',
    email: 'carrie@example.com',
    title: 'Bookkeeping & payroll',
    companyKey: null,
    lastContactDate: '2026-08-05',
    tag: 'Back office'
  },
  {
    key: 'justin',
    name: 'Justin Jenks',
    email: 'justin@example.com',
    title: 'CPA',
    companyKey: null,
    lastContactDate: '2026-07-22',
    tag: 'Back office'
  },
  {
    key: 'vincent',
    name: 'Vincent Rosan',
    email: 'vincent@example.com',
    title: 'Strategic advisor',
    companyKey: null,
    lastContactDate: '2026-08-02',
    tag: 'Advisor'
  }
]

export const serviceCategories: readonly ServiceCategorySeed[] = [
  { key: 'c1', name: 'Audits', color: '#C9A84C', sort: 0 },
  { key: 'c2', name: 'Builds', color: '#6F9BD8', sort: 1 },
  { key: 'c3', name: 'Retainers', color: '#5BA4A4', sort: 2 },
  { key: 'c4', name: 'Advisory', color: '#888F9C', sort: 3 },
  { key: 'c5', name: 'Products', color: '#8B7FD8', sort: 4 }
]

// Rates below are the mockup's dollar figures * 100 (CONVENTIONS.md: money
// is integer cents, always) — the dollar amount is left in a trailing
// comment on each version for anyone auditing the port against the source.
export const services: readonly ServiceSeed[] = [
  {
    key: 's1',
    name: 'Discovery Audit',
    type: 'service',
    categoryKey: 'c1',
    billingModel: 'fixed',
    unit: 'fixed',
    blurb: 'Map a business for automation opportunity.',
    active: true,
    versions: [
      { version: 1, rateCents: 350_000, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }, // $3,500
      { version: 2, rateCents: 450_000, effectiveFrom: '2026-07-01', effectiveTo: null } // $4,500
    ]
  },
  {
    key: 's2',
    name: 'Systems / Agent Audit',
    type: 'service',
    categoryKey: 'c1',
    billingModel: 'fixed',
    unit: 'fixed',
    blurb: 'Review an existing agent stack, findings and remediation plan.',
    active: true,
    versions: [{ version: 1, rateCents: 420_000, effectiveFrom: '2026-01-01', effectiveTo: null }] // $4,200
  },
  {
    key: 's3',
    name: 'AI Agent Build',
    type: 'service',
    categoryKey: 'c2',
    billingModel: 'fixed',
    unit: 'from',
    blurb: 'Fixed-scope agent delivery against milestones.',
    active: true,
    versions: [{ version: 1, rateCents: 1_800_000, effectiveFrom: '2025-09-01', effectiveTo: null }] // $18,000
  },
  {
    key: 's4',
    name: 'Product Build',
    type: 'service',
    categoryKey: 'c2',
    billingModel: 'fixed',
    unit: 'from',
    blurb: 'Full application delivery.',
    active: true,
    versions: [{ version: 1, rateCents: 2_200_000, effectiveFrom: '2025-09-01', effectiveTo: null }] // $22,000
  },
  {
    key: 's5',
    name: 'Advisory Retainer',
    type: 'service',
    categoryKey: 'c3',
    billingModel: 'retainer',
    unit: 'mo',
    blurb: 'Standing advisory plus hands-on build time.',
    active: true,
    versions: [{ version: 1, rateCents: 650_000, effectiveFrom: '2026-03-01', effectiveTo: null }] // $6,500/mo
  },
  {
    key: 's6',
    name: 'Embedded Development Retainer',
    type: 'service',
    categoryKey: 'c3',
    billingModel: 'retainer',
    unit: 'mo',
    blurb: 'Ongoing engineering capacity, monthly hours allowance.',
    active: true,
    versions: [
      { version: 1, rateCents: 180_000, effectiveFrom: '2025-11-01', effectiveTo: '2026-06-30' }, // $1,800/mo
      { version: 2, rateCents: 260_000, effectiveFrom: '2026-07-01', effectiveTo: null } // $2,600/mo
    ]
  },
  {
    key: 's7',
    name: 'Platform Advisory',
    type: 'service',
    categoryKey: 'c4',
    billingModel: 'tm',
    unit: 'hr',
    blurb: 'Hourly technical advisory.',
    active: true,
    versions: [
      { version: 1, rateCents: 16_500, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-31' }, // $165/hr
      { version: 2, rateCents: 18_500, effectiveFrom: '2026-08-01', effectiveTo: null } // $185/hr
    ]
  },
  {
    key: 's8',
    name: 'Agent Starter Kit',
    type: 'product',
    categoryKey: 'c5',
    billingModel: 'fixed',
    unit: 'fixed',
    blurb: 'Placeholder — rename me.',
    active: true,
    versions: [{ version: 1, rateCents: 75_000, effectiveFrom: '2026-08-01', effectiveTo: null }] // $750
  },
  {
    key: 's9',
    name: 'Automation Playbook',
    type: 'product',
    categoryKey: 'c5',
    billingModel: 'fixed',
    unit: 'fixed',
    blurb: 'Placeholder — archived example.',
    active: false,
    versions: [{ version: 1, rateCents: 25_000, effectiveFrom: '2026-02-01', effectiveTo: null }] // $250
  }
]

export const engagements: readonly EngagementSeed[] = [
  {
    key: 'e1',
    name: 'Advisory + development retainer',
    billingCompanyKey: 'rinvii',
    clientCompanyKey: 'rinvii',
    serviceKey: 's5',
    serviceVersion: 1,
    agreedRateCents: 650_000, // $6,500
    billingModel: 'retainer',
    status: 'active',
    startedOn: '2026-03-01',
    endsOn: null,
    hoursIncluded: 20,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e2',
    name: 'SiteFacts — parcel & setback engine',
    billingCompanyKey: 'sandsage',
    clientCompanyKey: 'sandsage',
    serviceKey: 's6',
    serviceVersion: 1,
    agreedRateCents: 180_000, // $1,800
    billingModel: 'retainer',
    status: 'active',
    startedOn: '2025-11-01',
    endsOn: null,
    hoursIncluded: 12,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e3',
    name: 'SiteFacts equity position',
    billingCompanyKey: 'sandsage',
    clientCompanyKey: 'sandsage',
    serviceKey: null,
    serviceVersion: null,
    agreedRateCents: null,
    billingModel: 'equity',
    status: 'held',
    startedOn: '2026-04-01',
    endsOn: null,
    hoursIncluded: null,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: '5% · 83(b) filed'
  },
  {
    key: 'e4',
    name: 'Samay — AI timesheet agent',
    billingCompanyKey: 'ezdeploy',
    clientCompanyKey: 'wk',
    serviceKey: 's3',
    serviceVersion: 1,
    agreedRateCents: 1_800_000, // $18,000
    billingModel: 'fixed',
    status: 'active',
    startedOn: '2026-02-10',
    endsOn: '2026-10-15',
    hoursIncluded: null,
    contractValueCents: 1_800_000,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e5',
    name: 'Programetrix agents audit',
    billingCompanyKey: 'ezdeploy',
    clientCompanyKey: 'programetrix',
    serviceKey: 's2',
    serviceVersion: 1,
    agreedRateCents: 420_000, // $4,200
    billingModel: 'fixed',
    status: 'delivered',
    startedOn: '2026-04-01',
    endsOn: '2026-05-20',
    hoursIncluded: null,
    contractValueCents: 420_000,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e6',
    name: 'Platform advisory',
    billingCompanyKey: 'ezdeploy',
    clientCompanyKey: 'ezdeploy',
    serviceKey: 's7',
    serviceVersion: 1,
    agreedRateCents: 16_500, // $165/hr
    billingModel: 'tm',
    status: 'active',
    startedOn: '2026-05-01',
    endsOn: null,
    hoursIncluded: null,
    contractValueCents: null,
    hourlyRateCents: 16_500,
    estimatedHours: 30,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e7',
    name: 'VedX customer portal',
    billingCompanyKey: 'radial',
    clientCompanyKey: 'radial',
    serviceKey: 's4',
    serviceVersion: 1,
    agreedRateCents: 2_200_000, // $22,000
    billingModel: 'fixed',
    status: 'delivered',
    startedOn: '2025-09-01',
    endsOn: '2026-03-15',
    hoursIncluded: null,
    contractValueCents: 2_200_000,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e8',
    name: 'VedX email support agent',
    billingCompanyKey: 'radial',
    clientCompanyKey: 'radial',
    serviceKey: 's3',
    serviceVersion: 1,
    agreedRateCents: 750_000, // $7,500
    billingModel: 'fixed',
    status: 'delivered',
    startedOn: '2026-01-10',
    endsOn: '2026-04-30',
    hoursIncluded: null,
    contractValueCents: 750_000,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e9',
    name: 'Naslund Waste — fixed scope SOW',
    billingCompanyKey: 'naslund',
    clientCompanyKey: 'naslund',
    serviceKey: 's3',
    serviceVersion: 1,
    agreedRateCents: 2_850_000, // $28,500
    billingModel: 'fixed',
    status: 'proposed',
    startedOn: '2026-09-15',
    endsOn: '2027-01-31',
    hoursIncluded: null,
    contractValueCents: 2_850_000,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  },
  {
    key: 'e10',
    name: 'Grant advisory + prototype',
    billingCompanyKey: 'theroute',
    clientCompanyKey: 'theroute',
    serviceKey: null,
    serviceVersion: null,
    agreedRateCents: null,
    billingModel: 'none',
    status: 'pending',
    startedOn: '2026-05-01',
    endsOn: '2027-06-30',
    hoursIncluded: null,
    contractValueCents: null,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: 'Next-year budget'
  },
  {
    key: 'e11',
    name: 'Discovery Audit',
    billingCompanyKey: 'thompson',
    clientCompanyKey: 'thompson',
    serviceKey: 's1',
    serviceVersion: 2,
    agreedRateCents: 450_000, // $4,500
    billingModel: 'fixed',
    status: 'proposed',
    startedOn: '2026-09-01',
    endsOn: '2026-10-15',
    hoursIncluded: null,
    contractValueCents: 450_000,
    hourlyRateCents: null,
    estimatedHours: null,
    notToExceedCents: null,
    notes: null
  }
]

export const activity: readonly ActivitySeed[] = [
  {
    key: 'a1',
    companyKey: 'rinvii',
    kind: 'call',
    title: 'Weekly sync',
    body: 'Next sprint aimed at onboarding.',
    occurredOn: '2026-08-26'
  },
  {
    key: 'a2',
    companyKey: 'sandsage',
    kind: 'email',
    title: 'Setback engine tier 3',
    body: 'Sent the waterfall write-up. OR counties before WA.',
    occurredOn: '2026-08-25'
  },
  {
    key: 'a3',
    companyKey: 'naslund',
    kind: 'meeting',
    title: 'SOW walkthrough',
    body: 'Walked the four milestones. Signature expected next week.',
    occurredOn: '2026-08-21'
  },
  {
    key: 'a4',
    companyKey: 'wk',
    kind: 'meeting',
    title: 'Samay demo',
    body: 'Graph auth working end to end. One open item on edge cases.',
    occurredOn: '2026-08-19'
  },
  {
    key: 'a5',
    companyKey: 'ezdeploy',
    kind: 'email',
    title: 'Milestone 3 invoice',
    body: 'Invoiced against the W+K build. Platform hours billed separately.',
    occurredOn: '2026-08-19'
  },
  {
    key: 'a6',
    companyKey: 'theroute',
    kind: 'note',
    title: 'Grant submitted',
    body: 'Decision expected this year.',
    occurredOn: '2026-08-11'
  },
  {
    key: 'a7',
    companyKey: 'radial',
    kind: 'email',
    title: 'Portal handoff wrap',
    body: 'Phase two mentioned, no timeline.',
    occurredOn: '2026-07-30'
  },
  {
    key: 'a8',
    companyKey: 'thompson',
    kind: 'call',
    title: 'Intro call',
    body: 'He asked for a written scope.',
    occurredOn: '2026-07-08'
  },
  {
    key: 'a9',
    companyKey: 'northbank',
    kind: 'meeting',
    title: 'Northbank mixer',
    body: '$750 Location tier looked EV-positive.',
    occurredOn: '2026-06-14'
  },
  {
    key: 'a10',
    companyKey: 'programetrix',
    kind: 'note',
    title: 'Audit delivered',
    body: 'Findings handed to EZDeploy.',
    occurredOn: '2026-05-20'
  }
]

export const tasks: readonly TaskSeed[] = [
  {
    key: 't1',
    title: 'Send Naslund the countersigned SOW',
    status: 'todo',
    isNextStep: true,
    companyKey: 'naslund',
    engagementKey: 'e9',
    dueOn: '2026-08-28',
    waitingSince: null,
    doneOn: null
  },
  {
    key: 't2',
    title: 'Write the Samay edge-case test plan',
    status: 'todo',
    isNextStep: false,
    companyKey: 'wk',
    engagementKey: 'e4',
    dueOn: '2026-08-31',
    waitingSince: null,
    doneOn: null
  },
  {
    key: 't3',
    title: 'Raise the retainer conversation — hours running over',
    status: 'todo',
    isNextStep: true,
    companyKey: 'sandsage',
    engagementKey: 'e2',
    dueOn: '2026-09-05',
    waitingSince: null,
    doneOn: null
  },
  {
    key: 't4',
    title: 'Invoice Rinvii + Sand & Sage for September',
    status: 'todo',
    isNextStep: false,
    companyKey: 'rinvii',
    engagementKey: 'e1',
    dueOn: '2026-09-01',
    waitingSince: null,
    doneOn: null
  },
  {
    key: 't5',
    title: 'Send Ben the written scope he asked for',
    status: 'todo',
    isNextStep: true,
    companyKey: 'thompson',
    engagementKey: 'e11',
    dueOn: '2026-08-15',
    waitingSince: null,
    doneOn: null
  },
  {
    key: 't6',
    title: 'Decide on the Northbank Location tier',
    status: 'todo',
    isNextStep: true,
    companyKey: 'northbank',
    engagementKey: null,
    dueOn: '2026-09-10',
    waitingSince: null,
    doneOn: null
  },
  {
    key: 't7',
    title: 'Don to confirm OR county priority order',
    status: 'waiting',
    isNextStep: false,
    companyKey: 'sandsage',
    engagementKey: 'e2',
    dueOn: null,
    waitingSince: '2026-08-25',
    doneOn: null
  },
  {
    key: 't8',
    title: 'W+K feedback on the demo build',
    status: 'waiting',
    isNextStep: true,
    companyKey: 'wk',
    engagementKey: 'e4',
    dueOn: null,
    waitingSince: '2026-08-19',
    doneOn: null
  },
  {
    key: 't9',
    title: 'Federal grant decision',
    status: 'waiting',
    isNextStep: true,
    companyKey: 'theroute',
    engagementKey: 'e10',
    dueOn: null,
    waitingSince: '2026-08-11',
    doneOn: null
  },
  {
    key: 't10',
    title: 'Milestone 3 invoice to EZDeploy',
    status: 'done',
    isNextStep: false,
    companyKey: 'ezdeploy',
    engagementKey: 'e4',
    dueOn: '2026-08-19',
    waitingSince: null,
    doneOn: '2026-08-19'
  },
  {
    key: 't11',
    title: 'Prep the VedX phase-two outline',
    status: 'todo',
    isNextStep: true,
    companyKey: 'radial',
    engagementKey: null,
    dueOn: '2026-09-18',
    waitingSince: null,
    doneOn: null
  }
]
