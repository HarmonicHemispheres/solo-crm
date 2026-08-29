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
import { LINK_KIND_RULES, LINK_KINDS, type LinkKind } from '../../../shared/links'

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
      for (const substring of rule.substrings) {
        it(`a host containing "${substring}" resolves kind "${rule.kind}"`, () => {
          withDatabase((db) => {
            const company = createCompany(db, { name: 'Host Test Co' })
            const url = `https://${substring}example.com/some/path`
            const created = addLink(db, { entityType: 'company', entityId: company.id, url })
            expect(created.kind).toBe(rule.kind)
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
      expect(created.url).toBe('http://example.com')
    })
  })

  it('accepts https:', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'HTTPS Co' })
      const created = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.com' })
      expect(created.url).toBe('https://example.com')
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
