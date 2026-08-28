import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPANY_KINDS } from '../../../shared/companies'
import { assertNoSecretKeys, SETTINGS_REGISTRY } from '../../../shared/settings'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { ValidationError } from './errors'
import { getAllSettings, getSetting, resetSetting, setSetting } from './settings'

/**
 * Every test here runs against a real, migrated database opened through
 * `openDatabase({ userDataDir })` — `companies.test.ts`'s discipline, not an
 * in-memory stand-in — because this task's Acceptance specifically asks for
 * "a real file database, not in-memory" on the round-trip case.
 */

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
      // `as never` — TypeScript already refuses this at the call site (the
      // type-level half of this task's Acceptance); these calls exercise
      // the runtime check that guards a value smuggled past that, e.g. a
      // key deserialised from JSON with no compile-time literal type.
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

  it('no declared key contains a forbidden word — checked directly against every registry key', () => {
    const forbidden = /\b(key|apikey|token|accesstoken|refreshtoken|clientsecret|secret|password|passphrase|credential|credentials|privatekey)\b/i
    for (const key of Object.keys(SETTINGS_REGISTRY)) {
      // Segment on '.' and camelCase boundaries the same way the guard
      // does, so e.g. "cadence.defaultDays.client" is checked as
      // ["cadence", "default", "days", "client"], not as one long string
      // that would spuriously contain "days" ~ "day"-shaped false positives.
      const words = key.split(/[._]/).flatMap((segment) => segment.split(/(?=[A-Z])/))
      for (const word of words) {
        expect(word).not.toMatch(forbidden)
      }
    }
  })

  it('actually detects a credential-shaped key — proving the check is not vacuously true', () => {
    expect(() => assertNoSecretKeys(['stripe.apiKey'])).toThrow(/credential-shaped/)
    expect(() => assertNoSecretKeys(['gmail.refreshToken'])).toThrow(/credential-shaped/)
    expect(() => assertNoSecretKeys(['workspace.name'])).not.toThrow()
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

  it('integration toggles: stripe, google calendar, gmail', () => {
    expect('integrations.stripe.enabled' in SETTINGS_REGISTRY).toBe(true)
    expect('integrations.googleCalendar.enabled' in SETTINGS_REGISTRY).toBe(true)
    expect('integrations.gmail.enabled' in SETTINGS_REGISTRY).toBe(true)
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
