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

    'people:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'people:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'people:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_PERSON } })),
    'people:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_PERSON } })),
    'people:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),
    'people:addAffiliation': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),
    'people:updateAffiliation': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),
    'people:endAffiliation': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),
    'people:move': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_AFFILIATION } })),

    'engagements:list': vi.fn(async () => ({ ok: true as const, data: [] })),
    'engagements:get': vi.fn(async () => ({ ok: true as const, data: null })),
    'engagements:milestones': vi.fn(async () => ({ ok: true as const, data: [] })),
    'engagements:create': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT } })),
    'engagements:update': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: STUB_ENGAGEMENT } })),
    'engagements:delete': vi.fn(async () => ({ ok: true as const, data: { ok: true as const, data: { id: 'stub-id' } } })),

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
  hoursIncluded: null,
  contractValueCents: null,
  hourlyRateCents: null,
  estimatedHours: null,
  notToExceedCents: null,
  notes: null,
  createdAt: STUB_TIMESTAMP,
  updatedAt: STUB_TIMESTAMP
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
  'view.data.snippets': []
}
