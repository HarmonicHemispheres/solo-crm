import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_KINDS } from '../../../shared/companies'
import { assertNoSecretKeys, INTEGRATION_SOURCES, SETTINGS_REGISTRY } from '../../../shared/settings'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { ValidationError } from './errors'
import { getAllSettings, getSetting, resetSetting, setSetting } from './settings'

/**
 * Every test here runs against a real, migrated database opened through
 * `openDatabase({ userDataDir })` — `companies.test.ts`'s discipline, not an
 * in-memory stand-in — because this task's Acceptance specifically asks for
 * "a real file database, not in-memory" on the round-trip case.
 */

// ---------------------------------------------------------------------------
// Type-level guarantee (T-260828-44): `getSetting`'s `key` parameter must
// stay narrowed to `SettingKey`, never widen to plain `string`.
// ---------------------------------------------------------------------------

/**
 * Type equality, not `extends`: `SettingKey extends string` is already
 * `true` today (every string-literal union is assignable to `string`), so
 * that relation can't detect a widening. This is the standard
 * distributive-conditional identity check (the same shape `type-fest` and
 * `ts-toolbelt` use) — `Equal<'a', 'a' | 'b'>` is `false` the same way
 * `Equal<SettingKey, string>` must stay `false`.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** A constraint of literal `true` turns "this type isn't `true`" into a compile error at the declaration itself — not one that depends on a call site, a comment staying next to the right line, or a variable actually being read. */
type AssertTrue<T extends true> = T

/**
 * Replaces acceptance criterion 3's original `as never` cast (T-260828-25),
 * which typechecked trivially and proved nothing: `getSetting(db, 'not.a.real.key'
 * as never)` compiles today and would still compile if `key` were ever
 * widened to `string`, since the cast throws away the type either way. This
 * checks the parameter's actual inferred type instead. If a later refactor
 * widens `getSetting`'s `key` from `K extends SettingKey` to plain `string`
 * (the T-260828-26 pressure `settings.ts`'s header already anticipates, where
 * a key arrives as `unknown`), `GetSettingKeyParam` becomes `string` itself,
 * `Equal<string, string>` becomes `true`, and this line fails to compile with
 * "Type 'false' does not satisfy the constraint 'true'." Deliberately not a
 * `@ts-expect-error` on a `getSetting(db, 'not.a.real.key')` call: that
 * passes silently if the expected error moves to a different line or is
 * masked by an unrelated one (this task's Risks) — this fails on the type
 * itself, from any refactor, regardless of where a call site moves.
 */
type GetSettingKeyParam = Parameters<typeof getSetting>[1]
// Exported only so this compile-time proof itself counts as "used" under
// `noUnusedLocals` — nothing is meant to import it.
export type _GetSettingKeyParamIsNotWidenedToString = AssertTrue<Equal<GetSettingKeyParam, string> extends false ? true : false>

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-settings-repo-'))
}

afterEach(() => {
  closeDatabase()
  vi.restoreAllMocks()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir()
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}

function tableInfo(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}

describe('getSetting / setSetting: round trip against a real, reopened database', () => {
  it('a key written, the database closed and reopened, is read back unchanged', () => {
    const tmpDir = makeTmpDir()
    try {
      openDatabase({ userDataDir: tmpDir })
      setSetting(getDatabase(), 'workspace.name', 'MagicPill Labs')
      closeDatabase()

      openDatabase({ userDataDir: tmpDir })
      expect(getSetting(getDatabase(), 'workspace.name')).toBe('MagicPill Labs')
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('getSetting: unset keys', () => {
  it('returns the declared default for a key that has never been written', () => {
    withDatabase((db) => {
      expect(getSetting(db, 'workspace.currency')).toBe('USD')
      expect(getSetting(db, 'appearance.density')).toBe('comfortable')
      expect(getSetting(db, 'backup.enabled')).toBe(true)
    })
  })

  it('creates no row as a side effect of reading an unset key', () => {
    withDatabase((db) => {
      getSetting(db, 'workspace.name')
      const count = (db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }).count
      expect(count).toBe(0)
    })
  })
})

describe('setSetting / getSetting: writes actually persist, including falsy and boundary values', () => {
  it('an explicit false actually flips a boolean whose default is true', () => {
    withDatabase((db) => {
      expect(getSetting(db, 'backup.enabled')).toBe(true)
      setSetting(db, 'backup.enabled', false)
      expect(getSetting(db, 'backup.enabled')).toBe(false)
    })
  })

  it('an explicit true actually flips a boolean whose default is false', () => {
    withDatabase((db) => {
      expect(getSetting(db, 'integrations.gmail.enabled')).toBe(false)
      setSetting(db, 'integrations.gmail.enabled', true)
      expect(getSetting(db, 'integrations.gmail.enabled')).toBe(true)
    })
  })

  it('an empty string actually overwrites a non-empty stored value', () => {
    withDatabase((db) => {
      setSetting(db, 'workspace.operator', 'Robby Boney')
      expect(getSetting(db, 'workspace.operator')).toBe('Robby Boney')
      setSetting(db, 'workspace.operator', '')
      expect(getSetting(db, 'workspace.operator')).toBe('')
    })
  })

  it('setSetting rejects an explicit undefined rather than writing it as a value', () => {
    withDatabase((db) => {
      // A caller that does `setSetting(db, key, maybeUndefinedValue)` must
      // get a validation failure, not a row silently holding "undefined" or
      // a NULL that later reads back as something no schema describes.
      expect(() => setSetting(db, 'workspace.name', undefined as unknown as string)).toThrow(ValidationError)
      const count = (db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }).count
      expect(count).toBe(0)
    })
  })

  it('setSetting rejects a value of the wrong shape for the key, and does not write a row', () => {
    withDatabase((db) => {
      expect(() => setSetting(db, 'backup.enabled', 'yes' as unknown as boolean)).toThrow(ValidationError)
      const count = (db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }).count
      expect(count).toBe(0)
    })
  })

  it('setSetting rejects a currency outside the declared set', () => {
    withDatabase((db) => {
      expect(() => setSetting(db, 'workspace.currency', 'JPY' as unknown as 'USD')).toThrow(ValidationError)
    })
  })
})

describe('a key not in the registry', () => {
  it('is rejected at runtime by getSetting, setSetting and resetSetting alike', () => {
    withDatabase((db) => {
      // `as never` deliberately smuggles an invalid key past the compiler
      // (TypeScript refuses `getSetting(db, 'not.a.real.key')` without the
      // cast — see `_GetSettingKeyParamIsNotWidenedToString` above for the
      // real, standalone proof of that, rather than trusting this cast to
      // demonstrate it) so these calls can exercise the *runtime* guard that
      // catches a value already widened to `string` by the time it arrives,
      // e.g. a key deserialised from JSON with no compile-time literal type.
      expect(() => getSetting(db, 'not.a.real.key' as never)).toThrow(ValidationError)
      expect(() => setSetting(db, 'not.a.real.key' as never, 'x' as never)).toThrow(ValidationError)
      expect(() => resetSetting(db, 'not.a.real.key' as never)).toThrow(ValidationError)
    })
  })
})

describe('a row whose stored JSON no longer matches its schema', () => {
  function insertRawRow(db: Database.Database, key: string, rawValue: string): void {
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, rawValue, '2026-08-28T10:00:00.000Z')
  }

  it('falls back to the declared default and logs once, rather than throwing', () => {
    withDatabase((db) => {
      insertRawRow(db, 'workspace.currency', JSON.stringify('not-a-real-currency'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const value = getSetting(db, 'workspace.currency')

      expect(value).toBe('USD')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('falls back to the declared default when the stored text is not valid JSON at all', () => {
    withDatabase((db) => {
      insertRawRow(db, 'appearance.density', 'not json {{{')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const value = getSetting(db, 'appearance.density')

      expect(value).toBe('comfortable')
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('the app still starts: a corrupted row for one key does not prevent reading any other key', () => {
    withDatabase((db) => {
      insertRawRow(db, 'workspace.currency', 'not json {{{')
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(getSetting(db, 'workspace.currency')).toBe('USD')
      expect(getSetting(db, 'workspace.operator')).toBe('')
      expect(() => setSetting(db, 'workspace.operator', 'Robby Boney')).not.toThrow()
    })
  })
})

describe('updated_at and the absence of created_at (ADR-002)', () => {
  it('the settings table has no created_at column, and updated_at is NOT NULL', () => {
    withDatabase((db) => {
      const columns = tableInfo(db, 'settings')
      expect(columns.find((c) => c.name === 'created_at')).toBeUndefined()
      const updatedAt = columns.find((c) => c.name === 'updated_at')
      expect(updatedAt?.notnull).toBe(1)
    })
  })

  it('updated_at moves on every setSetting call, including one that repeats the same value', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'))
      withDatabase((db) => {
        setSetting(db, 'workspace.name', 'MagicPill Labs')
        const first = (db.prepare('SELECT updated_at FROM settings WHERE key = ?').get('workspace.name') as { updated_at: string })
          .updated_at
        expect(first).toBe('2026-08-28T10:00:00.000Z')

        vi.setSystemTime(new Date('2026-08-28T10:05:00.000Z'))
        setSetting(db, 'workspace.name', 'MagicPill Labs')
        const second = (db.prepare('SELECT updated_at FROM settings WHERE key = ?').get('workspace.name') as { updated_at: string })
          .updated_at
        expect(second).toBe('2026-08-28T10:05:00.000Z')
        expect(second).not.toBe(first)
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('resetSetting', () => {
  it('deletes the stored override so the next read returns the declared default', () => {
    withDatabase((db) => {
      setSetting(db, 'appearance.density', 'compact')
      expect(getSetting(db, 'appearance.density')).toBe('compact')

      const reset = resetSetting(db, 'appearance.density')

      expect(reset).toBe('comfortable')
      expect(getSetting(db, 'appearance.density')).toBe('comfortable')
      const row = db.prepare('SELECT * FROM settings WHERE key = ?').get('appearance.density')
      expect(row).toBeUndefined()
    })
  })

  it('is a no-op, not an error, when the key was never written', () => {
    withDatabase((db) => {
      expect(() => resetSetting(db, 'workspace.name')).not.toThrow()
    })
  })
})

describe('getAllSettings', () => {
  it('returns every declared key, mixing stored overrides with declared defaults', () => {
    withDatabase((db) => {
      setSetting(db, 'workspace.name', 'MagicPill Labs')
      setSetting(db, 'backup.enabled', false)

      const all = getAllSettings(db)

      expect(all['workspace.name']).toBe('MagicPill Labs')
      expect(all['backup.enabled']).toBe(false)
      // Untouched keys still resolve to their declared default, not undefined.
      expect(all['workspace.operator']).toBe('')
      expect(all['appearance.density']).toBe('comfortable')
      expect(Object.keys(all).sort()).toEqual(Object.keys(SETTINGS_REGISTRY).sort())
    })
  })
})

describe('the credential guard (ADR-004, G7)', () => {
  it('the real registry declares no key that reads as a credential', () => {
    expect(() => assertNoSecretKeys()).not.toThrow()
  })

  it('every registered key passes through the guard — not a hand-picked subset', () => {
    // `assertNoSecretKeys()` with no argument already defaults to
    // `SETTINGS_KEYS` (`Object.keys(SETTINGS_REGISTRY)` — the same set the
    // module-load call at the bottom of `settings.ts` checks), so the test
    // above already covers this. Passed explicitly here so a future key
    // literally cannot bypass the check without this line changing too —
    // the guard is worthless if a key can reach `SETTINGS_REGISTRY` without
    // ever reaching `assertNoSecretKeys` (this task's Scope).
    expect(() => assertNoSecretKeys(Object.keys(SETTINGS_REGISTRY))).not.toThrow()
  })

  it('a credential-shaped key added to the registry is caught alongside the real ones', () => {
    // Simulates the mutation this task's Acceptance calls for directly —
    // adding e.g. `stripe.apiSecret` to `SETTINGS_REGISTRY` — without
    // actually editing the registry: proves the same array the previous
    // test just accepted starts throwing the moment one bad key joins it.
    expect(() => assertNoSecretKeys([...Object.keys(SETTINGS_REGISTRY), 'stripe.apiSecret'])).toThrow(/credential-shaped/)
  })

  it('does not flag a benign key', () => {
    expect(() => assertNoSecretKeys(['workspace.name'])).not.toThrow()
  })

  it('segments on "." and camelCase, so a benign word does not collide with a forbidden one', () => {
    // "cadence.defaultDays.client" segments to ["cadence", "default", "days",
    // "client"] — none of which is a forbidden word on its own, unlike a
    // naive substring search that would spuriously match "days" against
    // nothing in particular but is exactly the shape of false positive this
    // guards against.
    expect(() => assertNoSecretKeys(['cadence.defaultDays.client'])).not.toThrow()
  })

  // One case per word `electron/shared/settings.ts` currently declares in
  // `FORBIDDEN_KEY_WORDS`, each run through the real `assertNoSecretKeys` —
  // never a re-declared copy of the list. This is the fix for the defect
  // this task exists to close: deleting any one of these words from
  // `FORBIDDEN_KEY_WORDS` now fails exactly the case built from it, because
  // that case calls the guard the runtime actually uses, rather than
  // (as the previous version of this test did) checking registry keys
  // against an independent regex literal that duplicated the word list and
  // never called `assertNoSecretKeys` at all.
  it.each([
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
  ])('flags a key whose name contains the forbidden word "%s"', (word) => {
    expect(() => assertNoSecretKeys([`workspace.${word}`])).toThrow(/credential-shaped/)
  })
})

describe('§6.11 and §6.13 coverage: every key those sections need has an entry', () => {
  it('identity: workspace name, operator, currency, fiscal year start', () => {
    expect('workspace.name' in SETTINGS_REGISTRY).toBe(true)
    expect('workspace.operator' in SETTINGS_REGISTRY).toBe(true)
    expect('workspace.currency' in SETTINGS_REGISTRY).toBe(true)
    expect('workspace.fiscalYearStartMonth' in SETTINGS_REGISTRY).toBe(true)
  })

  it('default cadence: one key per COMPANY_KINDS member, none extra, none missing', () => {
    const cadenceKeys = Object.keys(SETTINGS_REGISTRY).filter((key) => key.startsWith('cadence.defaultDays.'))
    const expected = COMPANY_KINDS.map((kind) => `cadence.defaultDays.${kind}`).sort()
    expect(cadenceKeys.sort()).toEqual(expected)
  })

  it('integration toggles: one key per INTEGRATION_SOURCES member, none extra, none missing', () => {
    // Mirrors the cadence-key guard above against `COMPANY_KINDS`: adding a
    // fourth source to `INTEGRATION_SOURCES` with no matching
    // `integrations.<source>.enabled` key now fails here instead of
    // silently getting no key (this task's Scope — `INTEGRATION_SOURCES`
    // was previously declared and used nowhere).
    const integrationKeys = Object.keys(SETTINGS_REGISTRY).filter(
      (key) => key.startsWith('integrations.') && key.endsWith('.enabled')
    )
    const expected = INTEGRATION_SOURCES.map((source) => `integrations.${source}.enabled`).sort()
    expect(integrationKeys.sort()).toEqual(expected)
  })

  it('backup: nightly toggle and target folder', () => {
    expect('backup.enabled' in SETTINGS_REGISTRY).toBe(true)
    expect('backup.folder' in SETTINGS_REGISTRY).toBe(true)
  })

  it('appearance: interface motion, compact density', () => {
    expect('appearance.motion' in SETTINGS_REGISTRY).toBe(true)
    expect('appearance.density' in SETTINGS_REGISTRY).toBe(true)
  })

  it('§6.13 per-view presentation mode: companies and people', () => {
    expect('view.companies.mode' in SETTINGS_REGISTRY).toBe(true)
    expect('view.people.mode' in SETTINGS_REGISTRY).toBe(true)
  })
})
