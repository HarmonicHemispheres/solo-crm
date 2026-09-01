import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Card } from '../components/primitives/Card'
import { Stat } from '../components/primitives/Stat'
import { Row } from '../components/primitives/Row'
import { Tag } from '../components/primitives/Tag'
import { Button } from '../components/primitives/Button'
import { IconButton } from '../components/primitives/IconButton'
import { EmptyState } from '../components/primitives/EmptyState'
import { Toast } from '../components/primitives/Toast'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { queryKeys } from '../lib/query-keys'
import {
  BUILT_IN_SNIPPETS,
  barWidth,
  formatBytes,
  formatCell,
  formatCount,
  formatWhen,
  tablePreviewStatement,
  type Snippet
} from './workspace-data-facts'
import type { DatabaseStatsResponse, QueryChannelResponse, SettingEntry } from '../../shared/ipc-types'
import './WorkspaceData.css'

/**
 * `/workspace/data` (T-260828-40, plan items X-01 and X-03) — the second of
 * the two blank pages, and the page that makes "your data is a file you own"
 * something a person can check rather than something the README claims: the
 * file's size, its path, its journal mode, its schema version, what is
 * actually in it, and a console to ask it anything.
 *
 * **Nothing on this page is cached.** `db:stats` is read with `staleTime: 0`
 * and `refetchOnMount: 'always'`, against the app-wide `staleTime: Infinity`
 * default (`lib/query-client.ts`) — deliberately, and it is the one place in
 * the app that overrides it. That default is correct everywhere else because
 * this app's own mutations are the only writer to its own cache; it is wrong
 * here because the numbers on this page describe a *file*, which a backup, a
 * checkpoint, or a different process can change without any mutation this
 * cache ever saw. X-01's first acceptance criterion is exactly that: revisit
 * the view and the size and counts have moved. A stale size figure is worse
 * than none — it is the number a person checks *because* they suspect
 * something changed.
 *
 * **The console is `db:query` (T-260828-39) and nothing else.** Three
 * properties of that channel shape this whole card:
 *
 * 1. Rows come back as *positional arrays* keyed by a separate `columns`
 *    array, never as objects — a four-table join names `id` four times and
 *    an object row would silently keep one of them. The results table below
 *    indexes rows by column position for that reason, and renders repeated
 *    names as the repeated headers they are.
 * 2. The statement timeout and the row cap are main-side constants,
 *    deliberately absent from the request schema and kept out of it by
 *    `.strict()`. This view therefore has no control that raises either, and
 *    must never gain one: it *reports* the cap main applied (`rowLimit`,
 *    `truncated`) rather than choosing it.
 * 3. A refusal arrives as **data** — `{ ok: false, error: { code, message } }`
 *    — never as a throw, and the message names the grounds ("this statement
 *    modifies the database…", "…was still returning rows after 5000ms").
 *    That message is rendered verbatim. Replacing it with a generic failure
 *    line is the exact thing §6.12 and T-260828-39 went to trouble to
 *    prevent (this task's Risks), so the refusal path here never
 *    reformats, truncates or substitutes.
 *
 * **What this page does not do.** No export, no `VACUUM`, no `ANALYZE`, no
 * `integrity_check` — those are writes and maintenance actions, they are
 * X-05, and the mockup's Export/Vacuum header buttons are deliberately not
 * ported. `lastBackupAt`/`lastIntegrityCheckAt` come across as `null` until
 * X-04 and X-05 exist, and the two stats say "never" plainly rather than
 * being hidden or filled with a plausible-looking figure. No chart either:
 * this page exists to keep analytics pressure off the rest of the UI
 * (§6.12), and a chart here defeats that.
 */

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * `queryKeys.db.all()` prefixed with this page's own scope, rather than a
 * factory added to `lib/query-keys.ts`: another task in this wave owns that
 * file. The tuple is the file's documented `[entity, scope]` shape either
 * way, and `invalidate.db` still covers it through the `['db']` prefix.
 */
const STATS_KEY = [...queryKeys.db.all(), 'stats'] as const

const SNIPPETS_KEY = 'view.data.snippets' as const

function useStats() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: ipcQueryFn('db:stats'),
    // See this file's header: the one deliberate override of the app-wide
    // `staleTime: Infinity`. These numbers describe a file, not this app's
    // own cache, and X-01 requires them to move without a restart.
    staleTime: 0,
    refetchOnMount: 'always'
  })
}

function useSavedSnippets() {
  return useQuery({
    queryKey: queryKeys.settings.detail(SNIPPETS_KEY),
    queryFn: ipcQueryFn('settings:get', { key: SNIPPETS_KEY }),
    staleTime: 0
  })
}

// ---------------------------------------------------------------------------
// The facts panel
// ---------------------------------------------------------------------------

function FactsRow({ stats }: { stats: DatabaseStatsResponse }) {
  const rowTotal = stats.tables.reduce((total, table) => total + table.rowCount, 0)

  return (
    <div className="data-stats">
      <Stat
        label="Database size"
        value={formatBytes(stats.fileBytes)}
        tone="hero"
        meta={`WAL ${formatBytes(stats.walBytes)} · page size ${formatCount(stats.pageSize)} · ${formatCount(stats.pageCount)} pages`}
      />
      <Stat label="Rows" value={formatCount(rowTotal)} meta={`across ${stats.tables.length} tables`} />
      <Stat
        label="Last backup"
        value={stats.lastBackupAt == null ? 'never' : formatWhen(stats.lastBackupAt, 'never')}
        meta={stats.lastBackupAt == null ? 'the nightly export has not run yet' : 'nightly JSON export'}
      />
      <Stat
        label="Integrity"
        value={stats.lastIntegrityCheckOk == null ? 'unchecked' : stats.lastIntegrityCheckOk ? 'ok' : 'failed'}
        tone={stats.lastIntegrityCheckOk === true ? 'good' : stats.lastIntegrityCheckOk === false ? 'bad' : 'default'}
        meta={
          stats.lastIntegrityCheckAt == null
            ? 'no check has been run on this file'
            : formatWhen(stats.lastIntegrityCheckAt, 'never')
        }
      />
    </div>
  )
}

function LocationCard({ stats }: { stats: DatabaseStatsResponse }) {
  const [copied, setCopied] = useState<string | null>(null)

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(stats.path)
      setCopied('Path copied')
    } catch {
      // A clipboard that refuses (no permission, no secure context) is told
      // about rather than silently swallowed — the path is on screen and
      // selectable either way, which is what the message says.
      setCopied('Could not reach the clipboard — the path above can be selected and copied by hand')
    }
  }

  return (
    <Card>
      {/*
        The tag is the whole "show, don't tell" of this card: on a portable
        copy the path alone gives it away to nobody — `D:\SoloCRM\solocrm.db`
        reads exactly like an ordinary moved data root — and the difference
        is the one an operator has to know, because it is what determines
        whether the data travels with the stick or stays on this machine.
        `portable` is main's verdict, carried on `db:stats` (ADR-013
        Decision 2); nothing here infers it from the path.
      */}
      <Card.Header title="Location" actions={stats.portable ? <Tag variant="verd">portable</Tag> : null} />
      <div className="field">
        <span className="k">Path</span>
        <span className="v mono data-path">{stats.path}</span>
        <IconButton aria-label="Copy database path" title="Copy database path" onClick={copyPath}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 5H6a2 2 0 00-2 2v10" />
          </svg>
        </IconButton>
      </div>
      <div className="field">
        <span className="k">Journal</span>
        <span className="v mono">{stats.journalMode.toUpperCase()}</span>
      </div>
      <div className="field">
        <span className="k">Schema</span>
        <span className="v mono">
          v{stats.schemaVersion}
          {stats.lastMigrationAt != null && ` · migrated ${formatWhen(stats.lastMigrationAt, '')}`}
        </span>
      </div>
      <div className="field">
        <span className="k">Read</span>
        <span className="v mono">{formatWhen(stats.readAt, '')}</span>
      </div>
      <p className="data-note meta">
        {stats.portable
          ? 'This is a portable copy: the database sits beside the Solo CRM.exe you launched and travels with it, so nothing is kept in this machine’s own user-data folder and the folder cannot be moved from inside the app — move the .exe instead. '
          : 'The database lives in this app’s own user-data folder. '}
        A path inside Google Drive, Dropbox or iCloud is refused outright rather than opened: file-sync daemons and
        SQLite corrupt each other, and a synced database is the one way this app can lose data it had.
      </p>
      <Toast message={copied} onDismiss={() => setCopied(null)} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function TablesCard({ stats, onPick }: { stats: DatabaseStatsResponse; onPick: (table: string) => void }) {
  const max = stats.tables.reduce((largest, table) => Math.max(largest, table.rowCount), 0)

  return (
    <Card>
      <Card.Header title="Tables" count={stats.tables.length} />
      {stats.tables.length === 0 ? (
        <EmptyState>No tables — this database has no schema applied.</EmptyState>
      ) : (
        stats.tables.map((table) => (
          <Row
            key={table.name}
            onClick={() => onPick(table.name)}
            title={<span className="mono data-table-name">{table.name}</span>}
            trailing={
              <>
                <span className="mono data-table-count">{formatCount(table.rowCount)}</span>
                {/*
                  The bar is relative to the largest table, and its width is
                  the *square root* of that ratio rather than the ratio
                  itself (this task's Acceptance: readable at both extremes —
                  20k rows beside 3). Linearly, a 3-row table next to a
                  20,000-row one is 0.015% of the bar: invisible, and
                  indistinguishable from the empty table below it. The floor
                  keeps any non-empty table visibly non-empty; an empty one
                  gets no fill at all, which is the one distinction that has
                  to survive.
                */}
                <span className="tblbar" aria-hidden="true">
                  <i style={{ width: barWidth(table.rowCount, max) }} />
                </span>
              </>
            }
          />
        ))
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The console
// ---------------------------------------------------------------------------

function ResultTable({ result }: { result: Extract<QueryChannelResponse, { ok: true }>['data'] }) {
  if (result.columns.length === 0) {
    return <EmptyState>The statement returned no columns.</EmptyState>
  }

  return (
    <div className="sqlout">
      <table className="sqltbl">
        <thead>
          <tr>
            {/*
              Keyed by position, not by name: `columns` can legitimately
              repeat a name (a four-table join names `id` four times), which
              is why `db:query` hands back positional rows in the first
              place.
            */}
            {result.columns.map((column, index) => (
              <th key={index} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <tr>
              <td colSpan={result.columns.length} className="data-no-rows">
                No rows.
              </td>
            </tr>
          ) : (
            result.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {result.columns.map((_column, cellIndex) => {
                  const cell = formatCell(row[cellIndex])
                  return (
                    <td key={cellIndex} className={cell.isNull ? 'mono data-cell data-cell-null' : 'mono data-cell'}>
                      {cell.text}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

interface ConsoleCardProps {
  statement: string
  onStatementChange: (next: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

function ConsoleCard({ statement, onStatementChange, textareaRef }: ConsoleCardProps) {
  const queryClient = useQueryClient()
  const savedSnippetsQuery = useSavedSnippets()
  const [result, setResult] = useState<QueryChannelResponse | null>(null)
  const [snippetName, setSnippetName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const statementId = useId()
  const snippetNameId = useId()

  const saved: readonly Snippet[] = (savedSnippetsQuery.data?.value as Snippet[] | undefined) ?? []

  const run = useMutation({
    // Not `unwrapMutationResult`: a `db:query` refusal is not a repository
    // refusal, and it is not an error either — it is this channel's other
    // legitimate answer. It is kept as data and rendered with its own
    // message (see this file's header, point 3).
    mutationFn: (text: string) => callCrm('db:query', { statement: text }),
    onSuccess: (response) => setResult(response)
  })

  const saveSnippet = useMutation({
    mutationFn: (entry: SettingEntry) => callCrm('settings:set', entry).then(unwrapMutationResult),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.detail(SNIPPETS_KEY) })
  })

  function writeSnippets(next: readonly Snippet[]) {
    saveSnippet.mutate({ key: SNIPPETS_KEY, value: [...next] } as SettingEntry)
  }

  function handleSave() {
    const name = snippetName.trim()
    if (name === '' || statement.trim() === '') {
      setSaveError('A snippet needs a name and a statement.')
      return
    }
    setSaveError(null)
    setSnippetName('')
    writeSnippets([...saved.filter((snippet) => snippet.name !== name), { name, statement }])
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘↵ / Ctrl+↵ — the mockup's own binding, and the reason the console is
    // runnable without ever leaving the textarea (this task's Acceptance:
    // keyboard operable).
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      run.mutate(statement)
    }
  }

  const refusal = result != null && !result.ok ? result.error : null
  const success = result != null && result.ok ? result.data : null

  return (
    <Card>
      <Card.Header
        title="Query console"
        actions={
          <>
            <Tag>read-only</Tag>
            <Button variant="primary" onClick={() => run.mutate(statement)} disabled={run.isPending}>
              {run.isPending ? 'Running…' : 'Run'}
            </Button>
          </>
        }
      />

      <div className="data-snippets">
        <div className="chiprow">
          {[...BUILT_IN_SNIPPETS, ...saved].map((snippet) => (
            <button
              key={snippet.name}
              type="button"
              className="chip"
              onClick={() => {
                onStatementChange(snippet.statement)
                textareaRef.current?.focus()
              }}
            >
              {snippet.name}
            </button>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="chiprow data-saved-actions">
            {saved.map((snippet) => (
              <button
                key={snippet.name}
                type="button"
                className="chip"
                onClick={() => writeSnippets(saved.filter((other) => other.name !== snippet.name))}
              >
                Forget “{snippet.name}”
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="data-console-body">
        <label className="data-label" htmlFor={statementId}>
          Statement
        </label>
        <textarea
          id={statementId}
          ref={textareaRef}
          className="sqlbox"
          spellCheck={false}
          value={statement}
          onChange={(event) => onStatementChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <p className="meta">Reads only. ⌘↵ (Ctrl+↵) runs the statement.</p>

        <div className="data-save-row">
          <label className="data-label" htmlFor={snippetNameId}>
            Save as
          </label>
          <input
            id={snippetNameId}
            className="inp"
            value={snippetName}
            onChange={(event) => setSnippetName(event.target.value)}
            placeholder="Name this statement"
          />
          <Button onClick={handleSave}>Save snippet</Button>
        </div>
        {saveError != null && <p className="meta data-save-error">{saveError}</p>}
      </div>

      {/*
        A refusal shows the message main wrote, unaltered — it names which of
        `readonly-connection.ts`'s three mechanisms refused the statement and
        why. Nothing here substitutes a friendlier sentence for it.
      */}
      {refusal != null && (
        <div className="sqlerr" role="alert">
          {refusal.message}
        </div>
      )}

      {run.isError && (
        <div className="sqlerr" role="alert">
          {run.error.message}
        </div>
      )}

      {success != null && (
        <>
          <div className="sqlmeta">
            {formatCount(success.rowCount)} {success.rowCount === 1 ? 'row' : 'rows'} · {success.durationMs.toFixed(1)} ms
            {success.truncated && ` · truncated at ${formatCount(success.rowLimit)} rows`}
          </div>
          <ResultTable result={success} />
        </>
      )}

      {result == null && !run.isPending && (
        <p className="meta data-console-hint">Results appear here. Writes are refused — this console is for reading.</p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function DatabaseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  )
}

export function WorkspaceData() {
  const statsQuery = useStats()
  const [statement, setStatement] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const header = (
    <ViewHeader
      icon={<DatabaseGlyph />}
      accent="var(--verdigris)"
      title="Data"
      description="Every figure here is read from the database file when this page loads — nothing is cached from startup. Refresh re-reads it."
      actions={
        <Button onClick={() => void statsQuery.refetch()} disabled={statsQuery.isFetching}>
          {statsQuery.isFetching ? 'Reading…' : 'Refresh'}
        </Button>
      }
    />
  )

  if (statsQuery.isPending) {
    return (
      <div>
        {header}
        <p className="meta">Reading the database file…</p>
      </div>
    )
  }

  if (statsQuery.error) {
    return (
      <div>
        {header}
        <EmptyState>{statsQuery.error.message}</EmptyState>
      </div>
    )
  }

  const stats = statsQuery.data

  return (
    <div>
      {header}
      <FactsRow stats={stats} />
      <LocationCard stats={stats} />
      <div className="data-grid">
        <TablesCard
          stats={stats}
          onPick={(table) => {
            setStatement(tablePreviewStatement(table))
            textareaRef.current?.focus()
          }}
        />
        <ConsoleCard statement={statement} onStatementChange={setStatement} textareaRef={textareaRef} />
      </div>
    </div>
  )
}
