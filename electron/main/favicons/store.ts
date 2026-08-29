import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../shared/format'
import type { Timestamp } from '../../shared/types'

/**
 * The `favicons` table's whole read/write surface (T-260828-49). Three
 * columns, from migration 0001:
 *
 * ```sql
 * CREATE TABLE `favicons` (
 *   `host` text PRIMARY KEY NOT NULL,
 *   `bytes` blob,
 *   `fetched_at` text
 * );
 * ```
 *
 * Keyed by host under ADR-002's natural-identity exemption, which is why it
 * has no UUID and no `created_at`/`updated_at` — the exemption is a stated
 * class, not an oversight, and `schema.test.ts` asserts the absence
 * table-by-table. Nothing wrote this table before this task.
 *
 * ## A failure is a row, not a missing row
 *
 * The three columns carry four states between them, and the encoding is the
 * one design decision in this file:
 *
 * | row | `bytes` | `fetched_at` | means |
 * |---|---|---|---|
 * | absent | — | — | never tried |
 * | present | non-null | set | cached icon, fetched then |
 * | present | NULL | set | **tried and failed**, at that instant |
 *
 * That third row is what stops a dead host being re-fetched on every render
 * (this task's Acceptance). `fetched_at` is the timestamp the retry window in
 * `service.ts` is measured from, so a failure is recorded *with* its time
 * rather than as a bare flag — "never retry" and "retry every render" are both
 * wrong, and only a timestamp supports the third answer.
 *
 * No `content_type` column is added, and no migration ships with this task.
 * The stored type is recovered by sniffing the bytes' magic numbers on read
 * (`sniff.ts`), which is not a workaround for the missing column but the
 * behaviour that file's header argues for on its own merits: the only
 * alternative source is the arbitrary host's own `Content-Type` header, which
 * is a claim rather than a fact, and storing that claim would mean trusting it
 * later. Sniffing on read costs a handful of byte comparisons and cannot go
 * stale.
 */

export interface CachedFavicon {
  readonly host: string
  /** `null` for a recorded failure — see the table in this file's header. */
  readonly bytes: Uint8Array | null
  readonly fetchedAt: Timestamp
}

interface FaviconRow {
  readonly host: string
  readonly bytes: Uint8Array | null
  readonly fetched_at: string | null
}

/**
 * `null` when this host has never been tried. A row whose `fetched_at` is
 * NULL is treated as never-tried too: it cannot have come from this module
 * (both writers below always set it), it carries no instant to measure a
 * retry window from, and the alternative — inventing "now" for it — would
 * suppress a fetch that has never actually happened.
 */
export function readCachedFavicon(db: Database.Database, host: string): CachedFavicon | null {
  const row = db.prepare('SELECT host, bytes, fetched_at FROM favicons WHERE host = ?').get(host) as FaviconRow | undefined
  if (!row || row.fetched_at === null) return null
  return { host: row.host, bytes: row.bytes ?? null, fetchedAt: row.fetched_at as Timestamp }
}

/** Store the bytes exactly as they arrived — no resizing, no re-encoding (this task's Scope). An upsert, so a retry that finally succeeds replaces the recorded failure. */
export function recordFaviconSuccess(db: Database.Database, host: string, bytes: Uint8Array): Timestamp {
  const fetchedAt = nowTimestamp()
  db.prepare(
    'INSERT INTO favicons (host, bytes, fetched_at) VALUES (?, ?, ?) ON CONFLICT(host) DO UPDATE SET bytes = excluded.bytes, fetched_at = excluded.fetched_at'
  ).run(host, Buffer.from(bytes), fetchedAt)
  return fetchedAt
}

/** Record that this host was tried and produced no usable icon, at this instant. `bytes` is set back to NULL so a host that used to have an icon and now serves rubbish does not keep serving the stale one indefinitely. */
export function recordFaviconFailure(db: Database.Database, host: string): Timestamp {
  const fetchedAt = nowTimestamp()
  db.prepare(
    'INSERT INTO favicons (host, bytes, fetched_at) VALUES (?, NULL, ?) ON CONFLICT(host) DO UPDATE SET bytes = NULL, fetched_at = excluded.fetched_at'
  ).run(host, fetchedAt)
  return fetchedAt
}
