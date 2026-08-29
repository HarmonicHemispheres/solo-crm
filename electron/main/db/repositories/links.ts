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
 *
 * Newest first, tie-broken on `id` (T-260828-55). `added_at` is
 * millisecond-precision and `addLink` writes it from `nowTimestamp()`, so
 * two links added in the same tick — the ordinary case when a UI adds
 * several at once, and the invariable case in a test — share a value and
 * `ORDER BY added_at DESC` alone leaves their relative order to SQLite.
 * `id` is this table's primary key, so it is the only column guaranteed to
 * break every tie; the resulting order among same-millisecond links is
 * arbitrary (uuids sort by nothing meaningful) but it is *stable*, which is
 * what a list rendered twice needs. Every sibling repository that orders on
 * a non-unique column carries a tiebreaker for the same reason; theirs is
 * `created_at`, which cannot serve here because `addLink` writes it from
 * the same instant as `added_at`.
 */
export function listLinks(db: Database.Database, input: unknown): readonly Link[] {
  const parsed = parseInput(listLinksInputSchema, input)
  const rows = db
    .prepare('SELECT * FROM links WHERE entity_type = ? AND entity_id = ? ORDER BY added_at DESC, id DESC')
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
 *
 * **`entityId` is deliberately not checked for existence** (T-260828-55's
 * Scope asks for this decision to be stated rather than left implicit). A
 * typo'd id therefore creates a link no view can reach. That is accepted,
 * for two reasons. Checking would mean branching on `entityType` to pick a
 * table — `companies`, `people` or `engagements` — which is precisely the
 * per-type branching the polymorphic design exists to avoid, and it would
 * be a half-guarantee anyway: nothing stops the entity being deleted a
 * second later, because no foreign key can span three tables and
 * `deleteCompany`/`deletePerson`/`deleteEngagement` do not consult this
 * table. A links row pointing at a dead id is already a state this schema
 * permits, so a create-time check would buy a narrower window, not an
 * invariant. The real fix is the cascade-vs-refuse policy T-260828-41 owns;
 * when that lands it can add the create-side check in the same place it
 * adds the delete-side one, with one answer instead of two.
 */
export function addLink(db: Database.Database, input: unknown): Link {
  const parsed = parseInput(createLinkInputSchema, input)

  // `createLinkInputSchema`'s `linkUrlSchema` already ran the WHATWG parser
  // and the scheme allowlist inside `safeParse` above, so `tryParseLinkUrl`
  // cannot fail here — this `URL` object is only re-materialised (parsing a
  // string twice is cheaper and simpler than threading a `URL` instance
  // through a zod schema) for `detectLinkKind`, the default-title helper and
  // the stored value.
  const url = tryParseLinkUrl(parsed.url) as URL
  // T-260828-55: store what was *validated*, not what was passed. The parser
  // strips control characters (an embedded tab or NUL), lowercases the host,
  // normalises the port and percent-encoding and gives a bare origin its
  // trailing slash — so `parsed.url` and `url.href` can differ, and it was
  // `url.href` the scheme allowlist and `detectLinkKind` actually saw. Every
  // consumer downstream (the favicon fetch, the links UI, any
  // `shell.openExternal`) reads the stored column, so the stored column is
  // the one that must carry the guarantee. The user-facing text is unaffected:
  // `title` still holds what they typed, or a default derived from the same
  // parsed URL.
  const storedUrl = url.href
  const kind = detectLinkKind(url)
  const title = parsed.title ?? defaultTitleFromUrl(url)

  const id = randomUUID()
  const timestamp = nowTimestamp()

  db.prepare(
    `INSERT INTO links (id, entity_type, entity_id, url, title, kind, added_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, parsed.entityType, parsed.entityId, storedUrl, title, kind, timestamp, timestamp, timestamp)

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
