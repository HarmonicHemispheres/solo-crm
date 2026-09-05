import { z } from 'zod'
import type { CompanyKind } from './companies'
import { DEFAULT_TIMELINE_KINDS, timelineKindsSchema } from './timeline'
import { timestampSchema } from './types'

/**
 * `settings`' wire contract (ADR-002, ADR-004; T-260828-25) — the declared
 * key registry every accessor in `electron/main/db/repositories/settings.ts`
 * is typed against, as PURE zod with no Node imports, matching the discipline
 * ADR-007 established for `electron/shared/companies.ts` and for the same
 * reason (this module is typechecked under both `tsconfig.node.json` and
 * `tsconfig.web.json` — see `ipc-types.ts`'s header on TS6307 — so it may
 * only use the ES2022 lib both share and other `electron/shared/**` modules —
 * this module happens not to need any, but the constraint is the same one
 * `companies.ts` observes).
 *
 * `settings` is not an entity with a create/update/delete lifecycle — it is
 * one row per declared key (ADR-002: keyed by natural identity, no
 * `created_at`). So instead of a domain type plus two input schemas, this
 * module exports one thing: `SETTINGS_REGISTRY`, a `key -> { schema,
 * default }` map. ADR-002 rule 2 states the shape this registry exists to
 * satisfy: "The repository layer exposes one typed accessor per setting, and
 * the accessor owns its key, its zod schema and its default. An unknown key
 * or a value that fails its schema reads as the default rather than
 * throwing." Rule 3: "Keys are declared in one module" — this one — "a key
 * composed at a call site is a defect."
 *
 * ADR-004's boundary — "the `settings` table may hold only non-secret
 * configuration" — is enforced here, not by convention: `assertNoSecretKeys`
 * runs at the bottom of this module, at import time, against every key this
 * registry declares. A key named or shaped like a credential fails the
 * moment this module loads, not on the day someone happens to `grep` for it.
 */

// ---------------------------------------------------------------------------
// Shared value vocabularies
// ---------------------------------------------------------------------------

/** The three currencies the workspace identity setting (§6.11) offers. */
export const CURRENCY_CODES = ['USD', 'EUR', 'GBP'] as const
export type CurrencyCode = (typeof CURRENCY_CODES)[number]

/** Appearance density (§6.11: "compact density"). */
export const DENSITY_MODES = ['comfortable', 'compact'] as const
export type DensityMode = (typeof DENSITY_MODES)[number]

/** §6.13's per-view card/list toggle. */
export const VIEW_PRESENTATION_MODES = ['card', 'list'] as const
export type ViewPresentationMode = (typeof VIEW_PRESENTATION_MODES)[number]

/**
 * Todos' by-date / by-client partition (T-260828-33's Scope: "The grouping
 * choice in the ViewHeader, persisted per view (§6.13, T-260828-25)") — the
 * same "remembered per view" principle §6.13 states for Companies/People's
 * card/list toggle, applied to a different kind of per-view choice, so it
 * gets its own vocabulary rather than being shoehorned into
 * `VIEW_PRESENTATION_MODES` (a todo list isn't a card/list presentation
 * choice, it's a partition of the same rows).
 */
export const TODO_GROUP_BY_MODES = ['date', 'client'] as const
export type TodoGroupByMode = (typeof TODO_GROUP_BY_MODES)[number]

/**
 * The pull-only sources §6.11's "integration toggles" cover. Deliberately
 * excludes the timelog CSV import (a folder path, not an enable switch in
 * the mockup) and Notion/Drive (§7: "Pulls Nothing. Links only." — no
 * adapter, nothing to toggle).
 */
export const INTEGRATION_SOURCES = ['stripe', 'googleCalendar', 'gmail'] as const
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number]

// ---------------------------------------------------------------------------
// Registry plumbing
// ---------------------------------------------------------------------------

export interface SettingSpec<Schema extends z.ZodType = z.ZodType> {
  readonly schema: Schema
  readonly default: z.infer<Schema>
}

/**
 * Builds one registry entry. A plain object literal would work too, but this
 * keeps every entry's `default` checked against its own `schema` at the
 * point of declaration — `spec(z.boolean(), 'nope')` fails to compile —
 * rather than only at the first `getSetting` call that falls through to it.
 */
function spec<Schema extends z.ZodType>(schema: Schema, defaultValue: z.infer<Schema>): SettingSpec<Schema> {
  return { schema, default: defaultValue }
}

/**
 * Every settable key, once. §6.11 and §6.13's requirement text is quoted in
 * each group's comment so `settings.test.ts` can check coverage against this
 * file the same way it checks against the requirements doc — by name.
 */
export const SETTINGS_REGISTRY = {
  // "Identity: workspace name, operator, currency, fiscal year start."
  'workspace.name': spec(z.string(), ''),
  'workspace.operator': spec(z.string(), ''),
  'workspace.currency': spec(z.enum(CURRENCY_CODES), 'USD'),
  // A month number (1-12), not a closed enum of the mockup's three sample
  // options — the mockup's <select> is a UI convenience, not a domain
  // constraint, and a fiscal year can start in any month.
  'workspace.fiscalYearStartMonth': spec(z.int().min(1).max(12), 1),

  // "Default cadence per company kind. New companies inherit; any company
  // overrides its own." One key per `COMPANY_KINDS` member (companies.ts) —
  // hand-listed here so each keeps its own literal type and default, with
  // `settings.test.ts` asserting the set never drifts from `COMPANY_KINDS`.
  //
  // Nullable, and `null` is the default for every kind: "N/A" — no default
  // cadence, so a company of that kind with no cadence of its own is simply
  // not tracked (`renderer/lib/decay.ts` reads a null here as "no cadence",
  // which is the `ok` band, not overdue). The mockup's 7/14/14/21/30 were
  // the defaults until the operator asked for N/A to be the one to default
  // to: a number nobody chose was putting companies in the red on a fresh
  // install. The settings page offers those same four steps plus N/A.
  'cadence.defaultDays.client': spec(z.int().positive().nullable(), null),
  'cadence.defaultDays.end_client': spec(z.int().positive().nullable(), null),
  'cadence.defaultDays.prospect': spec(z.int().positive().nullable(), null),
  'cadence.defaultDays.advisory': spec(z.int().positive().nullable(), null),
  'cadence.defaultDays.channel': spec(z.int().positive().nullable(), null),

  // "Integration toggles with per-source status. All pull-only." Stripe and
  // Calendar default on, Gmail off — the mockup's own defaults.
  'integrations.stripe.enabled': spec(z.boolean(), true),
  'integrations.googleCalendar.enabled': spec(z.boolean(), true),
  'integrations.gmail.enabled': spec(z.boolean(), false),

  // "Backup: nightly JSON export toggle and target folder." No default
  // folder path — a machine-specific path picked by the operator (X-04,
  // out of this task's scope) has no sensible cross-platform default, and
  // guessing one risks landing in a sync folder (AGENTS.md).
  'backup.enabled': spec(z.boolean(), true),
  'backup.folder': spec(z.string(), ''),
  // When the operator last took a manual backup (`backup:run`) — a
  // timestamp, or `null` when they never have. Written by main after the
  // copy lands, read by the Backup section and by `db:stats.lastBackupAt`.
  // A setting rather than a column because it is one fact about the
  // workspace, not a record (ADR-002), and not a secret (ADR-004).
  'backup.lastRunAt': spec(timestampSchema.nullable(), null),

  // "Appearance: interface motion, compact density."
  'appearance.motion': spec(z.boolean(), true),
  'appearance.density': spec(z.enum(DENSITY_MODES), 'comfortable'),

  // §6.13: "Companies and People each support card and list presentation...
  // remembered per view." 'card' is the shared default — §6.13's own
  // guidance ("cards for under ~20 records") holds for a workspace just
  // getting started.
  'view.companies.mode': spec(z.enum(VIEW_PRESENTATION_MODES), 'card'),
  'view.people.mode': spec(z.enum(VIEW_PRESENTATION_MODES), 'card'),

  // T-260828-33's Scope: "The grouping choice in the ViewHeader, persisted
  // per view." 'date' is the default — "what's owed now" (Overdue/Today)
  // is the more common way to open the list than "who do I owe".
  'view.todos.groupBy': spec(z.enum(TODO_GROUP_BY_MODES), 'date'),

  // The operator's own timeline categories — the list every event and todo
  // files itself under, and the one place `activity.kind` / `tasks.kind`'s
  // vocabulary is declared now that neither is a closed enum
  // (`electron/shared/timeline.ts`). A setting rather than a table because
  // it is one fact about the workspace, not a set of records: nothing holds
  // a foreign key to a category, and a row carrying an id the list no longer
  // has still renders (`resolveTimelineKind`) rather than erroring.
  //
  // The default is `DEFAULT_TIMELINE_KINDS` rather than a literal repeated
  // here — migration 0010 backfills `tasks.kind` from that same module's
  // `DEFAULT_TODO_KIND_ID`, and two hand-kept copies of the starting list is
  // exactly the drift ADR-002 rule 3 is about. Spread into a mutable array
  // because `SettingSpec`'s `default` is the schema's own output type and
  // `timelineKindsSchema` parses to `TimelineKind[]`, not a readonly one.
  'timeline.kinds': spec(timelineKindsSchema, [...DEFAULT_TIMELINE_KINDS]),

  // T-260828-40 / X-03: the Data view's saved query snippets. A saved
  // snippet has to survive a restart (that task's Acceptance), and ADR-002's
  // settings table is the store this app already has — a second one for a
  // handful of strings would be a schema change to avoid a key.
  //
  // Only the *statements the operator wrote* live here. The starter set the
  // console offers is a constant in the view (`WorkspaceData.tsx`), not
  // seeded into this default: a default the user can edit but never restore
  // is worse than a built-in list that is always there, and an empty array
  // is the honest "you have saved nothing yet".
  //
  // ADR-004's guard applies here like everywhere: a snippet is a SELECT the
  // operator typed against their own local file, not a credential — and the
  // console it feeds is read-only either way (T-260828-39).
  'view.data.snippets': spec(
    z.array(z.object({ name: z.string().min(1), statement: z.string().min(1) }).strict()),
    [] as { name: string; statement: string }[]
  ),

  // T-260902-13: the rail's Reports group, expanded or collapsed. Chrome
  // rather than a view's own state, hence `nav.` and not `view.` — the rail
  // is on every route and belongs to none of them.
  //
  // `true` is the default because a collapsed group hides the only report
  // there is: an operator who has never touched this would otherwise open a
  // fresh install and find Revenue gone. The rail falls back to this same
  // value while `settings:getAll` is in flight, so the group never flashes
  // shut and then open on a cold start.
  //
  // One key, not one per subgroup: `NAV_SUBGROUP_SETTING_KEY` in
  // `renderer/nav.ts` maps the group id to this key the way
  // `CADENCE_SETTING_KEY` above maps a company kind, so a second subgroup
  // adds a key here and an entry there rather than composing one at a call
  // site (ADR-002 rule 3).
  'nav.reportsExpanded': spec(z.boolean(), true),

  // T-260829-15's first-run walkthrough. `false` is the honest default —
  // a fresh install has not seen it — and the overlay's *second* condition
  // (the workspace holds no companies) is what stops an existing workspace
  // updating into this version from being shown it.
  //
  // Deliberately a boolean and not a version number, and the trade is
  // written here rather than discovered later: a boolean cannot answer
  // "seen which version of the tour", so adding a sixth step marks everyone
  // who saw the five-step tour as done. That is the right way round. The
  // alternative — `onboarding.tourVersion`, re-nagging every operator on
  // every edit to the copy — makes an editable overlay into a recurring
  // interruption, which is the one failure mode that would make this
  // feature worse than not having it. If a later tour is genuinely worth
  // re-showing, that is a new key with its own decision, not a silent
  // change of meaning for this one.
  'onboarding.tourSeen': spec(z.boolean(), false)
} as const

export type SettingKey = keyof typeof SETTINGS_REGISTRY
export const SETTINGS_KEYS = Object.keys(SETTINGS_REGISTRY) as readonly SettingKey[]

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_REGISTRY)[K]['schema']>

/** Every declared key with its current (default, until overridden) value — `getAllSettings`'s return shape. */
export type SettingsSnapshot = { readonly [K in SettingKey]: SettingValue<K> }

/** The five `cadence.defaultDays.*` keys as a union, derived from the registry
 * rather than restated — every one of them is declared `z.int().positive()`
 * above, so `SettingValue<CadenceSettingKey>` is `number` and a snapshot read
 * through `CADENCE_SETTING_KEY` needs no `as number` at the call site. */
export type CadenceSettingKey = Extract<SettingKey, `cadence.defaultDays.${string}`>

/**
 * The one place `cadence.defaultDays.<kind>` keys are composed, as a literal
 * map rather than a template-literal function — ADR-002 rule 3 names a key
 * built at a call site a defect outright ("it makes what settings exist
 * unanswerable by grep"), and `Companies.tsx`'s `MODE_SETTING_KEY` const is
 * the merged precedent for declaring one instead. A literal also lets `tsc`
 * prove each value against `SettingKey` on its own, and — the direction that
 * actually matters — a `cadence.defaultDays.*` key renamed or dropped from
 * `SETTINGS_REGISTRY` fails the build here instead of silently reading
 * `undefined` from a snapshot and writing a key the repository rejects.
 *
 * It lives in this module, not in the one view that first needed it
 * (T-260829-13), because ADR-002 rule 3's "keys are declared in one module"
 * is this module, and there are now two readers: `WorkspaceSettings.tsx`
 * writes these defaults and `renderer/lib/decay.ts` resolves a company's
 * null `cadence_days` against them. A view is not somewhere a second reader
 * can import from without dragging a React tree behind it.
 */
export const CADENCE_SETTING_KEY: Record<CompanyKind, CadenceSettingKey> = {
  client: 'cadence.defaultDays.client',
  end_client: 'cadence.defaultDays.end_client',
  prospect: 'cadence.defaultDays.prospect',
  advisory: 'cadence.defaultDays.advisory',
  channel: 'cadence.defaultDays.channel'
}

/**
 * Compile-time pin (T-260828-44), mirroring the runtime pin
 * `settings.test.ts` gives the cadence keys against `COMPANY_KINDS`: every
 * `IntegrationSource` must have a matching `integrations.<source>.enabled`
 * entry above, or the line below fails to typecheck with "Type
 * '\"integrations.<source>.enabled\"' does not satisfy the constraint
 * 'never'" — a fourth source added to `INTEGRATION_SOURCES` with no
 * matching key fails `npm run typecheck`, not only the test suite. Purely
 * type-level: `IntegrationToggleKey` and `AssertNever` are erased at
 * compile time, so this has no runtime effect (this task's Scope: "no
 * behaviour change").
 */
type IntegrationToggleKey = `integrations.${IntegrationSource}.enabled`
type AssertNever<T extends never> = T
// Exported only so this compile-time proof itself counts as "used" under
// `noUnusedLocals` — nothing is meant to import it.
export type _IntegrationTogglesPinnedToSources = AssertNever<Exclude<IntegrationToggleKey, SettingKey>>

// ---------------------------------------------------------------------------
// ADR-004's credential guard
// ---------------------------------------------------------------------------

/**
 * Whole words a declared key may not contain, checked per `.`/camelCase
 * segment so `cadence.defaultDays.client` (segments: cadence, default, days,
 * client) does not collide with `credential` and a hypothetical
 * `workspace.monkeyName` would not collide with `key`. This is the
 * enforcement side of ADR-004's rule: "The `settings` table may hold only
 * non-secret configuration... if this value would be dangerous sitting in a
 * plaintext JSON file in the user's Drive folder, it is a secret and it does
 * not go in the database." A key named `stripe.apiKey` or `gmail.token`
 * reads exactly as dangerous as the value it would hold, which is why this
 * checks the *name*, not just the runtime value — the leak this guards
 * against is the nightly JSON export (§8) and the §6.12 query console, both
 * of which show whatever is in the row whether or not anything downstream
 * ever validates it as "safe."
 */
const FORBIDDEN_KEY_WORDS = new Set([
  'key',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'secret',
  'password',
  'passphrase',
  'credential',
  'credentials',
  'privatekey'
])

function keyWords(key: string): readonly string[] {
  return key
    .split(/[._]/)
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0)
}

/**
 * Throws if any of `keys` is named or shaped like a credential field.
 * Exported (rather than only run internally) so `settings.test.ts` can also
 * prove the check actually catches something, not just that the real
 * registry happens to pass it.
 */
export function assertNoSecretKeys(keys: readonly string[] = SETTINGS_KEYS): void {
  const offenders = keys.filter((key) => keyWords(key).some((word) => FORBIDDEN_KEY_WORDS.has(word)))
  if (offenders.length > 0) {
    throw new Error(
      `settings registry may not declare credential-shaped keys (ADR-004): ${offenders.join(', ')}. ` +
        'Credentials live in Electron safeStorage, never in the settings table.'
    )
  }
}

// Runs at import time: a future key that reads as a credential fails the
// build/test run the moment this module is loaded, not only when someone
// remembers to run the dedicated test.
assertNoSecretKeys()
