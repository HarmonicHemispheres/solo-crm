import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompany, getCompany } from './companies'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { createEngagement } from './engagements'
import { addLink, deleteLink, getLink, listLinks, updateLink } from './links'
import { createPerson } from './people'
import { NotFoundError, ValidationError } from './errors'
import { detectLinkKind, LINK_KIND_RULES, LINK_KINDS, type LinkKind, linkSchema } from '../../../shared/links'

/**
 * Every test here runs against a real, migrated database opened through
 * `openDatabase({ userDataDir })` — same discipline as `companies.test.ts`,
 * not a mock or an in-memory stub of the repository's own making.
 */

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-links-repo-'))
}

afterEach(() => {
  closeDatabase()
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

// ---------------------------------------------------------------------------
// Kind detection — driven from LINK_KIND_RULES (electron/shared/links.ts),
// itself ported verbatim from planning/solo-crm-mockup.html's `linkKind`.
// One assertion per host substring, generated from the map rather than a
// re-declared list of hosts — the exact re-declaration failure T-260828-44
// exists to fix (settings.test.ts had re-declared FORBIDDEN_KEY_WORDS as its
// own regex literal and could not fail when the real list was weakened).
// ---------------------------------------------------------------------------

describe('addLink: kind detection, one case per host in LINK_KIND_RULES', () => {
  for (const rule of LINK_KIND_RULES) {
    if (rule.type === 'host') {
      for (const domain of rule.domains) {
        it(`the registrable domain "${domain}" resolves kind "${rule.kind}", bare and with a subdomain`, () => {
          withDatabase((db) => {
            const company = createCompany(db, { name: 'Host Test Co' })
            const bare = addLink(db, {
              entityType: 'company',
              entityId: company.id,
              url: `https://${domain}.test/some/path`
            })
            expect(bare.kind).toBe(rule.kind)
            const subdomain = addLink(db, {
              entityType: 'company',
              entityId: company.id,
              url: `https://www.${domain}.test/some/path`
            })
            expect(subdomain.kind).toBe(rule.kind)
          })
        })

        it(`"${domain}" does not match as a bare substring — my${domain}.test and ${domain}.evil.test are both "web"`, () => {
          withDatabase((db) => {
            const company = createCompany(db, { name: 'Boundary Test Co' })
            const glued = addLink(db, {
              entityType: 'company',
              entityId: company.id,
              url: `https://my${domain}.test/some/path`
            })
            expect(glued.kind).toBe('web')
            const impostor = addLink(db, {
              entityType: 'company',
              entityId: company.id,
              url: `https://${domain}.evil.test/some/path`
            })
            expect(impostor.kind).toBe('web')
          })
        })
      }
    } else {
      it(`a path ending "${rule.suffix}" resolves kind "${rule.kind}"`, () => {
        withDatabase((db) => {
          const company = createCompany(db, { name: 'PDF Test Co' })
          const url = `https://files.example.com/report${rule.suffix}`
          const created = addLink(db, { entityType: 'company', entityId: company.id, url })
          expect(created.kind).toBe(rule.kind)
        })
      })
    }
  }

  it('every declared LinkKind is reachable from LINK_KIND_RULES or the "web" default — the map is exhaustive against the closed union', () => {
    const reachable = new Set<LinkKind>(LINK_KIND_RULES.map((rule) => rule.kind))
    reachable.add('web')
    expect([...reachable].sort()).toEqual([...LINK_KINDS].sort())
  })

  it('an unrecognised host stores "web" and does not throw', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Unrecognised Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/whatever' })
      expect(created.kind).toBe('web')
    })
  })

  it('a substring appearing only in the query string, not the host, does not match — the T-260828-48 Risks case', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Spoof Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'https://evil.test/?ref=notion.so'
      })
      expect(created.kind).toBe('web')
    })
  })

  // The false-positive direction, named host by host (T-260828-55). The
  // generated cases above cover it for every rule in the map; these four are
  // the concrete hosts the task was written against, each asserted
  // separately so a failure names which host regressed.
  it.each([
    ['mynotion.com'],
    ['notion.evil.com'],
    ['github.evil.com'],
    ['drive.google.evil.com']
  ])('%s is not the vendor it looks like — resolves "web"', (host) => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Impostor Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: `https://${host}/doc` })
      expect(created.kind).toBe('web')
    })
  })

  it('notion.so itself still resolves "notion" — the suffix rule does not forget the exact case', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Exact Notion Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://notion.so/doc' })
      expect(created.kind).toBe('notion')
    })
  })

  it('www.notion.so still resolves "notion"', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'WWW Notion Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://www.notion.so/doc' })
      expect(created.kind).toBe('notion')
    })
  })

  it('a subdomain host still matches — figma.example.com resolves "figma"', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Subdomain Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://www.figma.com/file/abc' })
      expect(created.kind).toBe('figma')
    })
  })

  it('a URL with no path resolves kind from the host alone', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'No Path Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://notion.so' })
      expect(created.kind).toBe('notion')
    })
  })

  it('a URL with an explicit port resolves kind correctly — host extraction is not a naive string split', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Port Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://notion.so:8443/page' })
      expect(created.kind).toBe('notion')
    })
  })

  it('a URL with query parameters resolves kind correctly', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Query Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'https://github.com/org/repo?tab=readme'
      })
      expect(created.kind).toBe('github')
    })
  })
})

// ---------------------------------------------------------------------------
// URL scheme allowlist
// ---------------------------------------------------------------------------

describe('addLink: URL scheme allowlist — http:/https: only', () => {
  it('refuses javascript: with a stated reason', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'JS Co' })
      let thrown: unknown
      try {
        addLink(db, { entityType: 'company', entityId: company.id, url: 'javascript:alert(1)' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ValidationError)
      expect((thrown as ValidationError).message).toMatch(/scheme/)
      expect(listLinks(db, { entityType: 'company', entityId: company.id })).toHaveLength(0)
    })
  })

  it('refuses file:///etc/passwd with a stated reason', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'File Co' })
      let thrown: unknown
      try {
        addLink(db, { entityType: 'company', entityId: company.id, url: 'file:///etc/passwd' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ValidationError)
      expect((thrown as ValidationError).message).toMatch(/scheme/)
      expect(listLinks(db, { entityType: 'company', entityId: company.id })).toHaveLength(0)
    })
  })

  it('accepts http:', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'HTTP Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'http://example.com' })
      // Normalised: a bare origin gains its trailing slash (see the
      // normalisation suite below).
      expect(created.url).toBe('http://example.com/')
    })
  })

  it('accepts https:', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'HTTPS Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      expect(created.url).toBe('https://example.com/')
    })
  })

  it('rejects a string that is not a valid absolute URL at all', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Bad URL Co' })
      expect(() => addLink(db, { entityType: 'company', entityId: company.id, url: 'not a url' })).toThrow(ValidationError)
    })
  })
})

// ---------------------------------------------------------------------------
// One table, three entity types
// ---------------------------------------------------------------------------

describe('the one links table serving companies, people and engagements', () => {
  it('attaches to a company, a person and an engagement, and listLinks for one entity never returns another\'s', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Attach Co' })
      const person = createPerson(db, { name: 'Attach Person' })
      const engagement = createEngagement(db, { name: 'Attach Engagement', billingModel: 'none', startedOn: '2026-01-01' })

      const companyLink = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://drive.google.com/co' })
      const personLink = addLink(db, { entityType: 'person', entityId: person.id, url: 'https://notion.so/person' })
      const engagementLink = addLink(db, {
        entityType: 'engagement',
        entityId: engagement.id,
        url: 'https://figma.com/engagement'
      })

      const companyLinks = listLinks(db, { entityType: 'company', entityId: company.id })
      const personLinks = listLinks(db, { entityType: 'person', entityId: person.id })
      const engagementLinks = listLinks(db, { entityType: 'engagement', entityId: engagement.id })

      expect(companyLinks.map((l) => l.id)).toEqual([companyLink.id])
      expect(personLinks.map((l) => l.id)).toEqual([personLink.id])
      expect(engagementLinks.map((l) => l.id)).toEqual([engagementLink.id])
    })
  })

  it('never leaks another entity\'s links even when two different entities happen to share the same id value', () => {
    withDatabase((db) => {
      const sharedId = randomUUID()
      const company = createCompany(db, { name: 'Shared Id Co' })
      // Force a person row to exist with the literal same id as the company —
      // a direct insert since createPerson always assigns its own uuid.
      const now = new Date().toISOString()
      db.prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        sharedId,
        'Shared Id Person',
        now,
        now
      )
      db.prepare('UPDATE companies SET id = ? WHERE id = ?').run(sharedId, company.id)

      addLink(db, { entityType: 'company', entityId: sharedId, url: 'https://drive.google.com/co-doc' })
      addLink(db, { entityType: 'person', entityId: sharedId, url: 'https://notion.so/person-doc' })

      const companyLinks = listLinks(db, { entityType: 'company', entityId: sharedId })
      const personLinks = listLinks(db, { entityType: 'person', entityId: sharedId })

      expect(companyLinks).toHaveLength(1)
      expect(companyLinks[0].url).toBe('https://drive.google.com/co-doc')
      expect(personLinks).toHaveLength(1)
      expect(personLinks[0].url).toBe('https://notion.so/person-doc')
    })
  })

  it('entity_type rejects a value outside the closed union', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Bad Entity Type Co' })
      expect(() =>
        addLink(db, { entityType: 'invoice', entityId: company.id, url: 'https://example.com' })
      ).toThrow(ValidationError)
      expect(() => listLinks(db, { entityType: 'invoice', entityId: company.id })).toThrow(ValidationError)
    })
  })
})

// ---------------------------------------------------------------------------
// Title default and edit
// ---------------------------------------------------------------------------

describe('title: defaults from the URL, editable afterward', () => {
  it('defaults the title from the URL when omitted', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Default Title Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/agreement' })
      expect(created.title).toBe('example.com/agreement')
    })
  })

  it('keeps a caller-supplied title instead of deriving one', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Explicit Title Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'https://example.com/agreement',
        title: 'Signed SOW'
      })
      expect(created.title).toBe('Signed SOW')
    })
  })

  it('updateLink changes only the title, leaving url/kind/entity untouched', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Update Title Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://notion.so/doc', title: 'Old Title' })

      const updated = updateLink(db, created.id, { title: 'New Title' })

      expect(updated.title).toBe('New Title')
      expect(updated.url).toBe(created.url)
      expect(updated.kind).toBe(created.kind)
      expect(updated.entityType).toBe(created.entityType)
      expect(updated.entityId).toBe(created.entityId)
      expect(updated.createdAt).toBe(created.createdAt)
    })
  })

  it('updateLink throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => updateLink(db, randomUUID(), { title: 'x' })).toThrow(NotFoundError)
    })
  })

  it('updateLink rejects an unknown field instead of silently no-opping', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Typo Update Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      expect(() => updateLink(db, created.id, { url: 'https://evil.example.com' })).toThrow(ValidationError)
      expect(getLink(db, created.id)?.url).toBe(created.url)
    })
  })
})

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe('deleteLink', () => {
  it('deletes a link by id', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Delete Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      deleteLink(db, created.id)
      expect(getLink(db, created.id)).toBeNull()
    })
  })

  it('throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => deleteLink(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

// ---------------------------------------------------------------------------
// Adding a link never mutates the entity it attaches to
// ---------------------------------------------------------------------------

describe('addLink does not mutate the entity it attaches to', () => {
  it('leaves the company row (including updatedAt) unchanged', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Untouched Co' })
      addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      const after = getCompany(db, company.id)
      expect(after).toEqual(company)
    })
  })
})

// ---------------------------------------------------------------------------
// The stored URL is the URL that was validated (T-260828-55)
//
// Every assertion below reads the row back through `getLink` rather than
// inspecting `addLink`'s return value alone, because the defect being fixed
// was in what reached the *column*.
// ---------------------------------------------------------------------------

/** Char-code scan rather than a regex — a control-character range in a regex literal is an eslint `no-control-regex` error. */
function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 0x20)
}

describe('addLink stores the parsed, normalised URL rather than the caller string', () => {
  it('strips an embedded tab — the stored column holds no control character', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Tab Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'https://exa\tmple.com/a\tgreement'
      })
      const readBack = getLink(db, created.id)
      expect(readBack?.url).toBe('https://example.com/agreement')
      expect(hasControlCharacter(readBack?.url ?? '')).toBe(false)
    })
  })

  // A NUL in the *host* is a forbidden host code point, so the WHATWG parser
  // refuses the URL outright and `linkUrlSchema` turns that into a
  // ValidationError — the second test below. In the path it is
  // percent-encoded instead, and it is that encoded form, never the raw byte,
  // that must reach the column.
  it('percent-encodes an embedded NUL in the path — the stored column holds no control character', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'NUL Path Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'https://example.com/do\u0000c'
      })
      const readBack = getLink(db, created.id)
      expect(readBack?.url).toBe('https://example.com/do%00c')
      expect(hasControlCharacter(readBack?.url ?? '')).toBe(false)
    })
  })

  it('refuses a NUL in the host outright rather than storing it', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'NUL Host Co' })
      expect(() =>
        addLink(db, { entityType: 'company', entityId: company.id, url: 'https://exa\u0000mple.com/doc' })
      ).toThrow(ValidationError)
      expect(listLinks(db, { entityType: 'company', entityId: company.id })).toHaveLength(0)
    })
  })

  it('lowercases the host and gives a bare origin its trailing slash — the stored text can differ from what was pasted, deliberately', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Normalise Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'HTTPS://EXAMPLE.COM'
      })
      expect(getLink(db, created.id)?.url).toBe('https://example.com/')
    })
  })

  it('the stored URL still parses back to the kind the row records', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Round Trip Co' })
      const created = addLink(db, {
        entityType: 'company',
        entityId: company.id,
        url: 'https://noti\ton.so/page'
      })
      const readBack = getLink(db, created.id)
      expect(readBack?.url).toBe('https://notion.so/page')
      expect(readBack?.kind).toBe('notion')
      expect(detectLinkKind(new URL(readBack!.url))).toBe(readBack?.kind)
    })
  })
})

// ---------------------------------------------------------------------------
// linkSchema carries the same URL guarantee as the write side (T-260828-55)
// ---------------------------------------------------------------------------

describe('linkSchema.url is linkUrlSchema, not a bare string', () => {
  it('accepts a row whose url passed the write-side check', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Read Side Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/x' })
      expect(() => linkSchema.parse(created)).not.toThrow()
    })
  })

  it('rejects a row carrying a disallowed scheme — the read side does not trust the table', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Smuggled Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/x' })
      // A row that reached the table by some route other than `addLink`:
      // a migration, an import, a hand-edited database file.
      db.prepare('UPDATE links SET url = ? WHERE id = ?').run('javascript:alert(1)', created.id)
      expect(() => linkSchema.parse(getLink(db, created.id))).toThrow()
    })
  })

  it('rejects an empty url on the read side too', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Empty Read Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/x' })
      db.prepare('UPDATE links SET url = ? WHERE id = ?').run('', created.id)
      expect(() => linkSchema.parse(getLink(db, created.id))).toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// Mutation survivors review found (T-260828-55): every `.strict()` could
// become `.passthrough()` and the empty-string guards could be relaxed with
// the whole suite still green. One assertion per guard, so relaxing any one
// of them fails a named test.
// ---------------------------------------------------------------------------

describe('schema guards: unknown keys are refused, not ignored', () => {
  it('createLinkInputSchema is strict — addLink rejects an unknown key and writes nothing', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Strict Create Co' })
      expect(() =>
        addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com', kind: 'stripe' })
      ).toThrow(ValidationError)
      expect(listLinks(db, { entityType: 'company', entityId: company.id })).toHaveLength(0)
    })
  })

  it('listLinksInputSchema is strict — listLinks rejects an unknown filter key rather than ignoring it', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Strict List Co' })
      addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      expect(() => listLinks(db, { entityType: 'company', entityId: company.id, kind: 'web' })).toThrow(ValidationError)
    })
  })

  it('updateLinkInputSchema is strict — updateLink rejects an unknown key alongside a valid one', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Strict Update Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      expect(() => updateLink(db, created.id, { title: 'ok', kind: 'stripe' })).toThrow(ValidationError)
      expect(getLink(db, created.id)?.title).toBe(created.title)
    })
  })
})

describe('schema guards: empty strings are refused', () => {
  it('addLink refuses an empty entityId', () => {
    withDatabase((db) => {
      expect(() => addLink(db, { entityType: 'company', entityId: '', url: 'https://example.com' })).toThrow(
        ValidationError
      )
    })
  })

  it('addLink refuses an empty title rather than storing a blank one', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Empty Title Co' })
      expect(() =>
        addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com', title: '' })
      ).toThrow(ValidationError)
    })
  })

  it('addLink refuses an empty url', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Empty URL Co' })
      expect(() => addLink(db, { entityType: 'company', entityId: company.id, url: '' })).toThrow(ValidationError)
    })
  })

  it('listLinks refuses an empty entityId rather than matching on a blank', () => {
    withDatabase((db) => {
      expect(() => listLinks(db, { entityType: 'company', entityId: '' })).toThrow(ValidationError)
    })
  })

  it('updateLink refuses an empty title', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Blank Title Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      expect(() => updateLink(db, created.id, { title: '' })).toThrow(ValidationError)
      expect(getLink(db, created.id)?.title).toBe(created.title)
    })
  })
})

// ---------------------------------------------------------------------------
// Ordering (T-260828-55): newest first, deterministically.
//
// `added_at` is millisecond-precision and `addLink` writes it from
// `nowTimestamp()`, so two links added in one test tick genuinely collide.
// The two tests below pin the two halves of `ORDER BY added_at DESC, id DESC`
// separately: flipping the direction of either fails exactly one of them.
// ---------------------------------------------------------------------------

describe('listLinks ordering', () => {
  it('returns the most recently added link first', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Order Co' })
      const older = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/older' })
      // Backdate rather than sleep: two `addLink` calls in one tick share a
      // millisecond, which is the collision the tiebreaker test below covers.
      // Here the two timestamps must genuinely differ.
      db.prepare('UPDATE links SET added_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', older.id)
      const newer = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/newer' })

      expect(listLinks(db, { entityType: 'company', entityId: company.id }).map((link) => link.id)).toEqual([
        newer.id,
        older.id
      ])
    })
  })

  it('breaks a same-millisecond tie deterministically, on id descending', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Tie Co' })
      const a = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/a' })
      const b = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/b' })
      const c = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com/c' })

      // Force the collision rather than hoping for it: all three share one
      // `added_at`, so only the tiebreaker can decide their order.
      const sameInstant = '2026-01-01T00:00:00.000Z'
      for (const link of [a, b, c]) {
        db.prepare('UPDATE links SET added_at = ? WHERE id = ?').run(sameInstant, link.id)
      }

      const ids = listLinks(db, { entityType: 'company', entityId: company.id }).map((link) => link.id)
      expect(ids).toEqual([a.id, b.id, c.id].sort().reverse())
      // And it is stable: the same query twice gives the same order.
      expect(listLinks(db, { entityType: 'company', entityId: company.id }).map((link) => link.id)).toEqual(ids)
    })
  })
})
