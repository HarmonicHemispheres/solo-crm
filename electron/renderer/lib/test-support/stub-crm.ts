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
  serviceVersionId: null,
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
  'view.todos.groupBy': 'date' as const
}
