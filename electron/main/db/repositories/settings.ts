import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../../shared/format'
import {
  assertNoSecretKeys,
  CURRENCY_CODES,
  DENSITY_MODES,
  INTEGRATION_SOURCES,
  SETTINGS_KEYS,
  SETTINGS_REGISTRY,
  type CurrencyCode,
  type DensityMode,
  type IntegrationSource,
  type SettingKey,
  type SettingsSnapshot,
  type SettingValue,
  type TodoGroupByMode,
  TODO_GROUP_BY_MODES,
  type ViewPresentationMode,
  VIEW_PRESENTATION_MODES
} from '../../../shared/settings'
import { ValidationError } from './errors'

/**
 * The `settings` repository (T-260828-25). `SETTINGS_REGISTRY` — every
 * declared key, its zod schema and its default — lives in
 * `electron/shared/settings.ts` (ADR-007's split, applied to the one table
 * that is a registry rather than an entity); this file is the accessors:
 * `getSetting`, `setSetting`, `getAllSettings`, `resetSetting`. Deliberately
 * no `set(key: string, value: unknown)` escape hatch (this task's Risks) —
 * every exported function is generic over `K extends SettingKey`, so an
 * unregistered key fails to typecheck at the call site, and `requireKnownKey`
 * below repeats the same check at runtime for a value that reaches this
 * module already widened to `string` (a future IPC channel deserialising a
 * request body, `settings.test.ts`'s own "key not in the registry" case).
 *
 * `settings` has no `id` and no `created_at` (ADR-002) — the primary key is
 * `key` itself and `updated_at` is the only timestamp, so every write below
 * is a single upsert, not the insert/update pair `companies.ts` needs for a
 * UUID-keyed table.
 *
 * A row whose stored JSON no longer parses, or no longer matches its
 * declared schema, is not a thrown error here: ADR-002 rule 2 states the
 * behaviour ("a value that fails its schema reads as default rather than
 * throwing") and this task's Scope restates why — "an app that will not boot
 * because of one bad settings row is a worse failure than one that ignores
 * it." `getSetting` logs once via `console.warn` and returns the declared
 * default in both failure shapes (invalid JSON; JSON that parses but fails
 * the schema).
 */
export {
  assertNoSecretKeys,
  CURRENCY_CODES,
  DENSITY_MODES,
  INTEGRATION_SOURCES,
  SETTINGS_KEYS,
  SETTINGS_REGISTRY,
  TODO_GROUP_BY_MODES,
  VIEW_PRESENTATION_MODES
}
export type {
  CurrencyCode,
  DensityMode,
  IntegrationSource,
  SettingKey,
  SettingsSnapshot,
  SettingValue,
  TodoGroupByMode,
  ViewPresentationMode
}

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------

/**
 * Runtime half of "a key not in the registry is rejected... at runtime"
 * (this task's Acceptance). `K extends SettingKey` on every exported
 * function's signature is the compile-time half; this guards a `key` that
 * has already been widened to `string` by the time it reaches here (an `as
 * SettingKey` cast at a call site, or — later — an IPC payload deserialised
 * from JSON, which carries no compile-time literal type at all).
 */
function requireKnownKey(key: string): asserts key is SettingKey {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key)) {
    throw new ValidationError(`"${key}" is not a declared setting (see electron/shared/settings.ts)`)
  }
}

function formatIssues(issues: ReadonlyArray<{ readonly path: PropertyKey[]; readonly message: string }>): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface SettingRow {
  readonly value: string
}

/**
 * Returns `key`'s stored value, or its declared default when the row is
 * absent, its JSON does not parse, or its JSON fails `key`'s schema. Never
 * creates a row — reading an unset key is not a write (this task's
 * Acceptance).
 */
export function getSetting<K extends SettingKey>(db: Database.Database, key: K): SettingValue<K> {
  requireKnownKey(key)
  const entry = SETTINGS_REGISTRY[key]

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined
  if (!row) return entry.default as SettingValue<K>

  let parsed: unknown
  try {
    parsed = JSON.parse(row.value)
  } catch (error) {
    console.warn(`[settings] "${key}" contains invalid JSON — using its declared default.`, error)
    return entry.default as SettingValue<K>
  }

  const result = entry.schema.safeParse(parsed)
  if (!result.success) {
    console.warn(`[settings] "${key}" failed its schema — using its declared default.`, formatIssues(result.error.issues))
    return entry.default as SettingValue<K>
  }

  return result.data as SettingValue<K>
}

/** Every declared key, each resolved the same way `getSetting` resolves one — stored value, or default on absence/corruption. */
export function getAllSettings(db: Database.Database): SettingsSnapshot {
  // Built via `Object.fromEntries` rather than assigning into a mapped-type
  // object key by key: TypeScript cannot narrow `out[key] = getSetting(db,
  // key)` back to the specific `K` a loop variable ranges over (`key`'s type
  // widens to the union `SettingKey`, so the assignment's RHS and LHS types
  // no longer agree at any single element), even though the value produced
  // for each key is exactly the type that key's own entry in the snapshot
  // requires. The cast on return is the one place that fact is asserted.
  const entries = SETTINGS_KEYS.map((key) => [key, getSetting(db, key)] as const)
  return Object.fromEntries(entries) as SettingsSnapshot
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Validates `value` against `key`'s declared schema and upserts it as JSON
 * text, stamping `updated_at` on every call — including a write that leaves
 * the value unchanged, matching `companies.ts`'s `updateCompany` (this
 * task's Acceptance: "`updated_at` moves on every `setSetting`"). Returns
 * the validated value (zod's parsed output, e.g. with defaults/coercions
 * applied by the schema) rather than the raw `value` argument, the same
 * reason `createCompany`/`updateCompany` return a fresh read rather than
 * echoing their input.
 */
export function setSetting<K extends SettingKey>(db: Database.Database, key: K, value: SettingValue<K>): SettingValue<K> {
  requireKnownKey(key)
  const entry = SETTINGS_REGISTRY[key]

  const result = entry.schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(formatIssues(result.error.issues), result.error.issues)
  }

  const timestamp = nowTimestamp()
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(result.data), timestamp)

  return result.data as SettingValue<K>
}

/** Deletes `key`'s stored row, if any, so the next `getSetting` returns its declared default. Idempotent: resetting an already-default key is not an error. */
export function resetSetting<K extends SettingKey>(db: Database.Database, key: K): SettingValue<K> {
  requireKnownKey(key)
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  return SETTINGS_REGISTRY[key].default as SettingValue<K>
}
