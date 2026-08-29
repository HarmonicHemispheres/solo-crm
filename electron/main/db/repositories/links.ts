import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../../shared/format'
import {
  type CreateLinkInput,
  createLinkInputSchema,
  detectLinkKind,
  type Link,
  LINK_ENTITY_TYPES,
  LINK_KIND_RULES,
  LINK_KINDS,
  type LinkEntityType,
  type LinkKind,
  type ListLinksInput,
  listLinksInputSchema,
  tryParseLinkUrl,
  type UpdateLinkInput,
  updateLinkInputSchema
} from '../../../shared/links'
import { NotFoundError } from './errors'
import { parseInput } from './input'

/**
 * The `links` repository (T-260828-48) — the first **polymorphic** table in
 * this codebase, `entity_type`/`entity_id` with no foreign key, and the
 * first repository built after T-260828-20's fix pass, so it follows that
 * pattern (the shared `parseInput` from `./input`, `.strict()` schemas,
 * `NotFoundError` from `./errors`) without re-deriving it. `Link`,
 * `LINK_ENTITY_TYPES`, `LINK_KINDS`, `detectLinkKind`/`LINK_KIND_RULES` and
 * the create/update/list zod schemas live in `electron/shared/links.ts`
 * (ADR-007) — that module's header explains the host-based kind-detection
 * fix and why this repository takes no position on what happens to a link
 * when its entity is deleted (T-260828-41 owns that).
 *
 * Deliberately raw `db.prepare(...).run(...)`, matching every sibling
 * repository — not built on `drizzle-orm`'s query builder.
 *
 * No `FIELD_SPECS`/constraint-translation machinery here the way
 * `companies.ts` has: migration 0001 gives `links` no `CHECK`, `UNIQUE` or
 * `FOREIGN KEY` beyond `id`'s primary key and the two `NOT NULL` timestamp
 * columns this repository always sets itself, so there is no SQLite
 * constraint a normal call here can trip. That machinery is not reused
 * because there is nothing for it to translate, not because it was
 * overlooked.
 */
export { LINK_ENTITY_TYPES, LINK_KIND_RULES, LINK_KINDS, createLinkInputSchema, updateLinkInputSchema }
export type { CreateLinkInput, Link, LinkEntityType, LinkKind, ListLinksInput, UpdateLinkInput }

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface LinkRow {
  readonly id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly url: string
  readonly title: string
  readonly kind: string
  readonly added_at: string
  readonly created_at: string
  readonly updated_at: string
}

function mapRow(row: LinkRow): Link {
  return {
    id: row.id,
    entityType: row.entity_type as LinkEntityType,
    entityId: row.entity_id,
    url: row.url,
    title: row.title,
    kind: row.kind as LinkKind,
    addedAt: row.added_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getLinkRow(db: Database.Database, id: string): LinkRow | undefined {
  return db.prepare('SELECT * FROM links WHERE id = ?').get(id) as LinkRow | undefined
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getLink(db: Database.Database, id: string): Link | null {
  const row = getLinkRow(db, id)
  return row ? mapRow(row) : null
}

// ---------------------------------------------------------------------------
// Default title — informed by `planning/solo-crm-mockup.html`'s `addLink`
// (line ~772: strip the scheme, drop a trailing slash), used only when the
// caller omits `title`. This helper is NOT part of the "verbatim" contract
// T-260828-48's Scope names — that applies to `linkKind`/`LINK_KIND_RULES`
// only — so it is free to omit the mockup's 44-character truncation, which
// exists there purely for a fixed-width UI chip this task's Scope explicitly
// puts out of scope (renderer code is T-260828-50).
// ---------------------------------------------------------------------------

function defaultTitleFromUrl(url: URL): string {
  const stripped = `${url.host}${url.pathname}${url.search}`.replace(/\/$/, '')
  return stripped.length > 0 ? stripped : url.href
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every link attached to one entity — `entity_type` + `entity_id`, this
 * table's whole reason for existing as polymorphic rather than three
 * separate `company_links`/`person_links`/`engagement_links` tables.
 * Filtering on both columns together, never `entity_id` alone, is what
 * keeps one entity's links from ever including another's even if two
 * entities of different types happened to share an id value.
 */
export function listLinks(db: Database.Database, input: unknown): readonly Link[] {
  const parsed = parseInput(listLinksInputSchema, input)
  const rows = db
    .prepare('SELECT * FROM links WHERE entity_type = ? AND entity_id = ? ORDER BY added_at DESC')
    .all(parsed.entityType, parsed.entityId) as LinkRow[]
  return rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Adding a link never touches the entity it attaches to — no
 * `UPDATE companies/people/engagements ...` runs here, and there is no
 * column on any of those tables for this repository to write even if it
 * wanted to (T-260828-48's Acceptance: "Adding a link does not mutate the
 * entity it attaches to").
 */
export function addLink(db: Database.Database, input: unknown): Link {
  const parsed = parseInput(createLinkInputSchema, input)

  // `createLinkInputSchema`'s `linkUrlSchema` already ran the WHATWG parser
  // and the scheme allowlist inside `safeParse` above, so `tryParseLinkUrl`
  // cannot fail here — this `URL` object is only re-materialised (parsing a
  // string twice is cheaper and simpler than threading a `URL` instance
  // through a zod schema) for `detectLinkKind` and the default-title helper.
  const url = tryParseLinkUrl(parsed.url) as URL
  const kind = detectLinkKind(url)
  const title = parsed.title ?? defaultTitleFromUrl(url)

  const id = randomUUID()
  const timestamp = nowTimestamp()

  db.prepare(
    `INSERT INTO links (id, entity_type, entity_id, url, title, kind, added_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, parsed.entityType, parsed.entityId, parsed.url, title, kind, timestamp, timestamp, timestamp)

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection).
  return getLink(db, id) as Link
}

/** Title only (T-260828-48's Scope) — `entityType`/`entityId`/`url`/`kind` are set once at create and never patched here. */
export function updateLink(db: Database.Database, id: string, patch: unknown): Link {
  const parsed = parseInput(updateLinkInputSchema, patch)

  if (!getLinkRow(db, id)) {
    throw new NotFoundError('Link', id)
  }

  const timestamp = nowTimestamp()
  db.prepare('UPDATE links SET title = ?, updated_at = ? WHERE id = ?').run(parsed.title, timestamp, id)

  return getLink(db, id) as Link
}

/**
 * No referential guard here, unlike every non-polymorphic repository's
 * `deleteX` — `links.id` is this table's own primary key and nothing else
 * in migration 0001 points a foreign key at it, so there is nothing for
 * `refuseIfReferenced` to check on delete of a link itself.
 *
 * What this function deliberately does NOT do: check whether
 * `entityId` still names a live row before deleting, or touch other
 * `links` rows when some other repository deletes an entity. Both are the
 * open question T-260828-41 owns ("what happens to a link when its entity
 * disappears") — this repository states no answer, quietly or otherwise.
 */
export function deleteLink(db: Database.Database, id: string): void {
  if (!getLinkRow(db, id)) {
    throw new NotFoundError('Link', id)
  }
  db.prepare('DELETE FROM links WHERE id = ?').run(id)
}
