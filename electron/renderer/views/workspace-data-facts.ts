import { parseTimestamp } from '../../shared/format'

/**
 * The Data view's pure parts (T-260828-40): number and cell formatting, the
 * table-bar scale, and the console's starter snippets.
 *
 * Plain data and functions, no JSX — split out of `WorkspaceData.tsx` for
 * the same reason `nav.ts` is split out of `routes.tsx`:
 * `react-refresh/only-export-components` disallows a file that exports both
 * components and non-components, and these are exactly the parts worth
 * testing on their own terms rather than through a render.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Bytes as the mockup writes them ("1.4 MB", "128.0 KB") — one decimal place above bytes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** Thousands separators on a row count — an unseparated `18432` reads as noise beside a `3`. */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US')
}

/** A timestamp as a short local date and time, or the given placeholder when there is none. */
export function formatWhen(timestamp: string | null, placeholder: string): string {
  if (timestamp == null) return placeholder
  return parseTimestamp(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * One SQLite cell as text. `null` is rendered as the word `null` in the faint
 * colour rather than as an empty cell — "this column has no value here" and
 * "this column is an empty string" are different facts, and a console that
 * blurred them would be lying about the data it exists to show. A BLOB shows
 * its length, since its bytes are not text and pasting them into the page
 * would corrupt the row visually.
 */
export function formatCell(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) return { text: 'null', isNull: true }
  if (value instanceof Uint8Array) return { text: `<blob ${value.byteLength} bytes>`, isNull: false }
  if (typeof value === 'bigint') return { text: value.toString(), isNull: false }
  return { text: String(value), isNull: false }
}

/**
 * A table's row-count bar, as a width relative to the largest table — the
 * *square root* of the ratio, not the ratio itself (this task's Acceptance:
 * readable at both extremes, one table with 20k rows next to one with 3).
 * Linearly, a 3-row table beside a 20,000-row one is 0.015% of the bar:
 * invisible, and indistinguishable from the empty table below it. The 6%
 * floor keeps any non-empty table visibly non-empty; an empty one gets no
 * fill at all, which is the one distinction that has to survive.
 */
export function barWidth(rowCount: number, max: number): string {
  if (rowCount <= 0 || max <= 0) return '0%'
  const ratio = Math.sqrt(rowCount / max)
  return `${Math.max(6, Math.round(ratio * 100))}%`
}

export interface Snippet {
  readonly name: string
  readonly statement: string
}

/**
 * The questions worth having one keystroke away on a page whose subject is
 * the file. Kept as a constant rather than seeded into the
 * `view.data.snippets` setting's default: a default the operator can delete
 * but never restore is worse than a built-in list that is always there, and
 * it keeps the stored value meaning exactly "what I saved".
 */
export const BUILT_IN_SNIPPETS: readonly Snippet[] = [
  {
    name: 'Companies by last touch',
    statement: 'SELECT name, kind, last_touch_at\nFROM companies\nORDER BY last_touch_at IS NULL, last_touch_at\nLIMIT 20'
  },
  {
    name: 'Open todos',
    statement: 'SELECT title, status, due_on\nFROM tasks\nWHERE done_at IS NULL\nORDER BY due_on IS NULL, due_on\nLIMIT 20'
  },
  {
    name: 'Revenue by month',
    statement:
      'SELECT period_month, SUM(amount_cents) AS cents\nFROM revenue_lines\nGROUP BY period_month\nORDER BY period_month DESC\nLIMIT 24'
  },
  {
    name: 'Hours by engagement',
    statement: 'SELECT engagement_id, SUM(hours) AS hours\nFROM time_entries\nGROUP BY engagement_id\nORDER BY hours DESC\nLIMIT 20'
  },
  { name: 'Schema', statement: "SELECT name, sql\nFROM sqlite_master\nWHERE type = 'table'\nORDER BY name" }
]

/** The statement clicking a table row loads — X-03's own acceptance line, verbatim. */
export function tablePreviewStatement(table: string): string {
  return `SELECT * FROM ${table} LIMIT 20`
}
