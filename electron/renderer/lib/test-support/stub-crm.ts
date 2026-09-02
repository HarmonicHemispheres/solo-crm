import { vi } from 'vitest'
import type { CrmApi } from '../../../shared/ipc-types'

/**
 * A minimal but fully-typed `CrmApi` stub for `lib/*.test.ts(x)` — every
 * test overrides just the channel(s) it cares about via `overrides`, so a
 * channel added later that a given test doesn't know about still leaves it
 * compiling and passing. Shared by `ipc.test.ts` and
 * `query-integration.test.tsx` rather than each keeping its own
 * byte-identical copy.
 *
 * T-260828-26 added the whole entity surface (`companies:*` through
 * `settings:*`) to `CrmApi`, so every one of those channels needs a default
 * here too — `window.crm: CrmApi` (window.d.ts) is not partial, and `stubCrm()`
 * with no arguments has to satisfy the full type. Each default below returns
 * a shape that actually matches its channel's response schema (an empty
 * list for a `list` channel, `null` for a `get` on an id nothing seeded, a
 * successful `{ ok: true, data }` mutation result) rather than a
 * placeholder value — a test that calls a channel without overriding it
 * gets a realistic "nothing here yet" response instead of a shape its own
 * code would reject.
 */
export function stubCrm(overrides: Partial<CrmApi> = {}): CrmApi {
  return {
    'app:version': vi.fn(async () => ({ ok: true as const, data: { version: '0.1.0' } })),
    'db:schemaVersion': vi.fn(async () => ({ ok: true as const, data: { version: 1, lastMigrationAt: null } })),
    // T-260828-40's live file facts. The default describes a real but empty
    // database — a path, a page size, WAL journalling, no tables — rather
    // than zeroes across the board, so a test that renders the Data view
    // without overriding this gets the shape the view actually formats.
    'db:stats': vi.fn(async () => ({
      ok: true as const,
      data: {
        path: '/stub/userData/solocrm.db',
        // The default describes an ordinary installed copy; the Data view's
        // own tests override this for the portable case.
        portable: false,
        fileBytes: 32_768,
        walBytes: 0,
        pageSize: 4096,
        pageCount: 8,
        journalMode: 'wal',
        schemaVersion: 1,
        lastMigrationAt: null,
        lastBackupAt: null,
        lastIntegrityCheckAt: null,
        lastIntegrityCheckOk: null,
        tables: [],
        readAt: STUB_TIMESTAMP
      }
    })),
    // T-260828-39's read-only query channel. The default is a successful
    // empty result rather than a refusal: "nothing here yet" is the
    // realistic no-override response for every other channel above, and a
    // test that wants a refusal is testing refusals and will override.
    'db:query': vi.fn(async () => ({
      ok: true as const,
      data: {
        ok: true as const,
        data: { columns: [], rows: [], rowCount: 0, truncated: false, rowLimit: 1000, durationMs: 0 }
      }
    })),

    'companies:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'companies:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'companies:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_COMPANY } })),
    'companies:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_COMPANY } })),
    'companies:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    /**
     * Nothing points at the stub record, which is the shape a confirmation
     * dialog shows for the ordinary case: "delete this, it takes nothing
     * with it". A test about the cascade overrides this with real entries.
     */
    'companies:deleteImpact': vi.fn(async ({ id }: { id: string }) => ({
      ok: true as const,
      data: { entity: 'company' as const, id, name: 'Stub company', entries: [] }
    })),

    'people:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'people:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'people:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_PERSON } })),
    'people:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_PERSON } })),
    'people:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    /**
     * Nothing points at the stub record, which is the shape a confirmation
     * dialog shows for the ordinary case: "delete this, it takes nothing
     * with it". A test about the cascade overrides this with real entries.
     */
    'people:deleteImpact': vi.fn(async ({ id }: { id: string }) => ({
      ok: true as const,
      data: { entity: 'person' as const, id, name: 'Stub person', entries: [] }
    })),
    'people:addAffiliation': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),
    'people:updateAffiliation': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),
    'people:endAffiliation': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),
    'people:move': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),

    'engagements:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'engagements:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'engagements:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT } })),
    'engagements:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT } })),
    'engagements:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    /**
     * Nothing points at the stub record, which is the shape a confirmation
     * dialog shows for the ordinary case: "delete this, it takes nothing
     * with it". A test about the cascade overrides this with real entries.
     */
    'engagements:deleteImpact': vi.fn(async ({ id }: { id: string }) => ({
      ok: true as const,
      data: { entity: 'engagement' as const, id, name: 'Stub engagement', entries: [] }
    })),
    // T-260902-02's milestone writes. `STUB_MILESTONE` is a complete row so a
    // mutation's response passes `milestoneSchema` under the real bridge too.
    'milestones:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'milestones:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_MILESTONE } })),
    'milestones:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_MILESTONE } })),
    'milestones:complete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_MILESTONE } })),
    'milestones:uncomplete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_MILESTONE } })),
    'milestones:reorder': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: [STUB_MILESTONE] } })),
    'milestones:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    'milestones:sum': vi.fn(async () => ({ ok: true as const, data: { engagementId: 'stub-id', totalCents: 0, count: 0 } })),

    // T-260901-07's catalogue. Empty lists and `null` for the three reads,
    // successful envelopes for the seven writes — and each write's `data` is a
    // shape that really matches its channel's response schema (an
    // `OfferingWithVersions` carries its history inline, so the stub carries
    // exactly one version, the one `createOffering` writes in the same
    // transaction), not a placeholder a view would reject.
    'offerings:listCategories': vi.fn(async () => ({ ok: true as const, data: [] })),
    'offerings:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'offerings:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'offerings:createCategory': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: STUB_OFFERING_CATEGORY }
    })),
    'offerings:updateCategory': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: STUB_OFFERING_CATEGORY }
    })),
    'offerings:deleteCategory': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { id: 'stub-id' } }
    })),
    'offerings:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_OFFERING } })),
    'offerings:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_OFFERING } })),
    'offerings:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    'offerings:deleteImpact': vi.fn(async ({ id }: { id: string }) => ({
      ok: true as const,
      data: { entity: 'offering' as const, id, name: 'Stub offering', entries: [] }
    })),
    'offerings:archive': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { ...STUB_OFFERING, active: false } }
    })),
    'offerings:duplicate': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_OFFERING } })),

    'tasks:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'tasks:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'tasks:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_TASK } })),
    'tasks:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_TASK } })),
    'tasks:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    'tasks:setNextStep': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_TASK } })),
    'tasks:countOpen': vi.fn(async () => ({ ok: true as const, data: { count: 0 } })),

    'activity:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'activity:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'activity:log': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_ACTIVITY } })),

    // T-260828-37's palette read. Default is an empty result set — the same
    // "nothing here yet" every list channel above answers with, and the
    // honest answer for a test that never seeded anything to match.
    'search:query': vi.fn(async () => ({ ok: true as const, data: [] })),

    // T-260828-48's links, reached from a view by T-260828-50. Empty list
    // for the read, successful envelopes for the three writes — the same
    // "nothing seeded here yet" default every other entity above answers
    // with.
    'links:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'links:add': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_LINK } })),
    'links:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_LINK } })),
    'links:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),

    // T-260828-49's favicon cache read. The default is the honest
    // no-override answer for a test that seeded no cache — and, deliberately,
    // an *answer*: `state: 'none'` with a reason, never a promise left
    // pending. A renderer that cannot render a definite absence in a test is
    // a renderer that would reflow in the app.
    'favicons:get': vi.fn(async () => ({
      ok: true as const,
      data: { state: 'none' as const, reason: 'never-fetched' as const, retryAfter: null }
    })),

    // T-260829-05. The default is both slots absent — the state every install
    // starts in and the one the rail draws its built-in mark against, so a
    // test that renders the shell without overriding this gets the ordinary
    // case rather than a fabricated logo. `branding:choose` defaults to
    // `cancelled` deliberately: a stub must never look like it opened a native
    // dialog, and cancellation is the one outcome that is true without one.
    'branding:get': vi.fn(async () => ({
      ok: true as const,
      data: { icon: { state: 'absent' as const, slot: 'icon' as const }, logo: { state: 'absent' as const, slot: 'logo' as const } }
    })),
    'branding:choose': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { outcome: 'cancelled' as const } }
    })),
    'branding:clear': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { state: 'absent' as const, slot: 'icon' as const } }
    })),

    // Company images (T-260901-12) default the way branding does and for the
    // same reasons: no company has an image — the thumbnails map is empty
    // and both of a company's slots are absent, which is what the seeded
    // database looks like and what every card draws its derived mark
    // against — and `companyImages:choose` answers `cancelled`, the one
    // outcome that is true without a native dialog having opened.
    'companyImages:thumbnails': vi.fn(async () => ({ ok: true as const, data: {} })),
    'companyImages:get': vi.fn(async () => ({
      ok: true as const,
      data: {
        logo: { state: 'absent' as const, slot: 'logo' as const },
        banner: { state: 'absent' as const, slot: 'banner' as const }
      }
    })),
    'companyImages:choose': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { outcome: 'cancelled' as const } }
    })),
    'companyImages:clear': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { state: 'absent' as const, slot: 'logo' as const } }
    })),

    'settings:get': vi.fn(async () => ({ ok: true as const, data: { key: 'workspace.name' as const, value: '' } })),
    'settings:getAll': vi.fn(async () => ({ ok: true as const, data: STUB_SETTINGS_SNAPSHOT })),
    'settings:set': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { key: 'workspace.name' as const, value: '' } }
    })),
    'settings:reset': vi.fn(async () => ({
      ok: true as const,
      data: { ok: true as const, data: { key: 'workspace.name' as const, value: '' } }
    })),

    ...overrides
  }
}

const STUB_TIMESTAMP = '2026-08-28T00:00:00.000Z'

const STUB_MILESTONE = {
  id: 'stub-milestone-id',
  engagementId: 'stub-id',
  name: 'Stub milestone',
  sort: 0,
  completedAt: null,
  amountCents: 0,
  expectedMonth: '2026-01-01',
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_COMPANY = {
  id: 'stub-company-id',
  name: 'Stub Co',
  kind: null,
  website: null,
  billsDirectly: null,
  billedViaCompanyId: null,
  introducedByCompanyId: null,
  cadenceDays: null,
  lastTouchAt: null,
  budgetNote: null,
  notes: null,
  since: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_PERSON = {
  id: 'stub-person-id',
  name: 'Stub Person',
  email: null,
  phone: null,
  notes: null,
  lastContactAt: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_AFFILIATION = {
  id: 'stub-affiliation-id',
  personId: 'stub-person-id',
  companyId: 'stub-company-id',
  title: null,
  isPrimary: null,
  started: '2026-08-28',
  ended: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_ENGAGEMENT = {
  id: 'stub-engagement-id',
  name: 'Stub Engagement',
  billingCompanyId: null,
  clientCompanyId: null,
  offeringVersionId: null,
  agreedRateCents: null,
  billingModel: null,
  status: null,
  startedOn: '2026-08-28',
  endsOn: null,
  renewsOn: null,
  retainerBasis: null,
  monthlyAmountCents: null,
  hoursIncluded: null,
  contractValueCents: null,
  hourlyRateCents: null,
  estimatedHours: null,
  notToExceedCents: null,
  notes: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_OFFERING_CATEGORY = {
  id: 'stub-offering-category-id',
  name: 'Stub Category',
  // Stored operator data, but a hex literal in a renderer file is exactly
  // what `local/no-literal-colour` exists to catch, and the schema makes the
  // column nullable — a test that needs a coloured chip overrides this.
  color: null,
  sort: 1,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_OFFERING_VERSION = {
  id: 'stub-offering-version-id',
  offeringId: 'stub-offering-id',
  version: 1,
  rateCents: 500_000,
  // Unbounded on both ends — "this is the price", the range `createOffering`
  // writes when a caller names none.
  effectiveFrom: null,
  effectiveTo: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_OFFERING = {
  id: 'stub-offering-id',
  name: 'Stub Offering',
  type: 'service' as const,
  categoryId: STUB_OFFERING_CATEGORY.id,
  billingModel: 'retainer' as const,
  unit: 'mo' as const,
  blurb: null,
  active: true,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP,
  versions: [STUB_OFFERING_VERSION]
}

const STUB_TASK = {
  id: 'stub-task-id',
  title: 'Stub Task',
  status: null,
  isNextStep: false,
  dueOn: null,
  waitingSince: null,
  doneAt: null,
  companyId: null,
  engagementId: null,
  personId: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_LINK = {
  id: 'stub-link-id',
  entityType: 'company' as const,
  entityId: 'stub-company-id',
  url: 'https://example.com/',
  title: 'example.com',
  kind: 'web' as const,
  addedAt: STUB_TIMESTAMP,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

const STUB_ACTIVITY = {
  id: 'stub-activity-id',
  occurredAt: STUB_TIMESTAMP,
  kind: 'note' as const,
  title: 'Stub Activity',
  body: null,
  companyId: null,
  personId: null,
  engagementId: null,
  source: 'manual' as const,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
}

/** One entry per `SETTINGS_REGISTRY` key (electron/shared/settings.ts), each set to its own declared default — kept in sync by `stub-crm.test.ts`'s coverage check against that registry, not by hand. */
const STUB_SETTINGS_SNAPSHOT = {
  'workspace.name': '',
  'workspace.operator': '',
  'workspace.currency': 'USD' as const,
  'workspace.fiscalYearStartMonth': 1,
  'cadence.defaultDays.client': 7,
  'cadence.defaultDays.end_client': 14,
  'cadence.defaultDays.prospect': 14,
  'cadence.defaultDays.advisory': 21,
  'cadence.defaultDays.channel': 30,
  'integrations.stripe.enabled': true,
  'integrations.googleCalendar.enabled': true,
  'integrations.gmail.enabled': false,
  'backup.enabled': true,
  'backup.folder': '',
  'appearance.motion': true,
  'appearance.density': 'comfortable' as const,
  'view.companies.mode': 'card' as const,
  'view.people.mode': 'card' as const,
  'view.todos.groupBy': 'date' as const,
  'view.data.snippets': [],
  // The one value here that deliberately does NOT match its registry default
  // (`false`, electron/shared/settings.ts). This stub stands in for a
  // workspace that is already up and running — every harness that reaches
  // for it is testing a view, a sheet or the shell, not first run — and a
  // `false` here would drop T-260829-15's tour overlay on top of all of
  // them, where a step titled "Companies" collides with the Companies view's
  // own heading. The three tests that care about the flag (Tour.test.tsx)
  // set it explicitly in all three of its states, which is the honest place
  // for that to be asserted.
  'onboarding.tourSeen': true
}
