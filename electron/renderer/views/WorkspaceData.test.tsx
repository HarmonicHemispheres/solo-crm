import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceData } from './WorkspaceData'
import { barWidth, formatBytes, tablePreviewStatement } from './workspace-data-facts'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import type { CrmApi, DatabaseStatsResponse, SettingEntry } from '../../shared/ipc-types'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

const STATS: DatabaseStatsResponse = {
  path: 'C:\\Users\\op\\AppData\\Roaming\\SoloCRM\\solocrm.db',
  fileBytes: 1_468_006,
  walBytes: 131_072,
  pageSize: 4096,
  pageCount: 358,
  journalMode: 'wal',
  schemaVersion: 4,
  lastMigrationAt: '2026-08-12T09:00:00.000Z',
  lastBackupAt: null,
  lastIntegrityCheckAt: null,
  lastIntegrityCheckOk: null,
  tables: [
    { name: 'activity', rowCount: 20_000 },
    { name: 'companies', rowCount: 42 },
    { name: 'tags', rowCount: 3 },
    { name: 'favicons', rowCount: 0 }
  ],
  readAt: '2026-08-28T12:00:00.000Z'
}

function renderData(overrides: Partial<CrmApi> = {}, stats: DatabaseStatsResponse = STATS) {
  window.crm = stubCrm({
    'db:stats': vi.fn(async () => ({ ok: true as const, data: stats })),
    ...overrides
  })
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <WorkspaceData />
    </QueryClientProvider>
  )
}

/** The successful `db:query` shape: positional rows keyed by a separate `columns` array (T-260828-39). */
function queryOk(
  columns: string[],
  rows: unknown[][],
  extra: Partial<{ truncated: boolean; rowLimit: number; durationMs: number }> = {}
) {
  return {
    ok: true as const,
    data: {
      ok: true as const,
      data: {
        columns,
        rows,
        rowCount: rows.length,
        truncated: extra.truncated ?? false,
        rowLimit: extra.rowLimit ?? 1000,
        durationMs: extra.durationMs ?? 1.25
      }
    }
  }
}

describe('WorkspaceData — the file facts (X-01)', () => {
  it('shows size, WAL, page size, path, journal mode and schema version from db:stats', async () => {
    renderData()

    expect(await screen.findByText('1.4 MB')).toBeTruthy()
    expect(screen.getByText(/WAL 128\.0 KB/)).toBeTruthy()
    expect(screen.getByText(/page size 4,096/)).toBeTruthy()
    expect(screen.getByText(STATS.path)).toBeTruthy()
    expect(screen.getByText('WAL')).toBeTruthy()
    expect(screen.getByText(/^v4/)).toBeTruthy()
    // 20,000 + 42 + 3 + 0
    expect(screen.getByText('20,045')).toBeTruthy()
    expect(screen.getByText('across 4 tables')).toBeTruthy()
  })

  it('re-reads the file on demand rather than serving the first answer forever', async () => {
    const stats = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, data: STATS })
      .mockResolvedValue({ ok: true as const, data: { ...STATS, fileBytes: 2_097_152 } })
    renderData({ 'db:stats': stats as unknown as CrmApi['db:stats'] })

    expect(await screen.findByText('1.4 MB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    // X-01's first acceptance criterion. The app-wide default is
    // `staleTime: Infinity`; if this view did not override it, the figure
    // below would still read 1.4 MB.
    expect(await screen.findByText('2.0 MB')).toBeTruthy()
  })

  it('says plainly that a backup and an integrity check have never run, rather than inventing figures', async () => {
    renderData()
    expect(await screen.findByText('never')).toBeTruthy()
    expect(screen.getByText('unchecked')).toBeTruthy()
  })

  it('states that a sync-folder location is refused (AGENTS.md, T-260828-06)', async () => {
    renderData()
    expect(await screen.findByText(/Google Drive, Dropbox or iCloud is\s+refused/)).toBeTruthy()
  })

  it('copies the database path to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderData()

    fireEvent.click(await screen.findByRole('button', { name: 'Copy database path' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(STATS.path))
    expect(await screen.findByText('Path copied')).toBeTruthy()
  })

  it('offers no export, vacuum or integrity-check action — those are writes, and X-05 owns them', async () => {
    renderData()
    await screen.findByText('1.4 MB')
    for (const label of [/export/i, /vacuum/i, /analyze/i, /integrity check/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
  })
})

describe('WorkspaceData — the table list (X-03)', () => {
  it('renders one row per table with its live count', async () => {
    renderData()
    expect(await screen.findByText('activity')).toBeTruthy()
    expect(screen.getByText('20,000')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('clicking a table loads SELECT * FROM <table> LIMIT 20 into the console', async () => {
    renderData()
    fireEvent.click(await screen.findByText('companies'))

    const box = screen.getByLabelText('Statement') as HTMLTextAreaElement
    expect(box.value).toBe('SELECT * FROM companies LIMIT 20')
  })

  it('and running it returns rows', async () => {
    const query = vi.fn(async () => queryOk(['id', 'name'], [['c1', 'Acme']]))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    fireEvent.click(await screen.findByText('companies'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText('Acme')).toBeTruthy()
    // Deep equality, so this also pins that the request carries the
    // statement and *nothing else*: the timeout and the row cap are
    // main-side constants kept out of the request schema by `.strict()`, and
    // this console must never be able to raise its own ceiling
    // (T-260828-39). A payload that grew a `rowLimit` would fail here.
    expect(query).toHaveBeenCalledWith({ statement: tablePreviewStatement('companies') })
  })

  it('keeps a 3-row table visible next to a 20,000-row one', () => {
    // The Acceptance line. Linearly, 3/20000 is 0.015% of the bar — invisible,
    // and indistinguishable from the empty table below it.
    expect(barWidth(20_000, 20_000)).toBe('100%')
    expect(Number.parseInt(barWidth(3, 20_000), 10)).toBeGreaterThanOrEqual(6)
    // An empty table is the one distinction that has to survive: no fill.
    expect(barWidth(0, 20_000)).toBe('0%')
  })
})

describe('WorkspaceData — the console (X-03)', () => {
  it('runs from the keyboard alone, with no mouse', async () => {
    const query = vi.fn(async () => queryOk(['n'], [[1]]))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    const box = (await screen.findByLabelText('Statement')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'SELECT 1 AS n' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(query).toHaveBeenCalledWith({ statement: 'SELECT 1 AS n' }))
  })

  it('shows the row count and execution time for every successful run', async () => {
    const query = vi.fn(async () => queryOk(['id'], [['a'], ['b']], { durationMs: 3.5 }))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    fireEvent.click(await screen.findByText('companies'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText(/2 rows · 3\.5 ms/)).toBeTruthy()
  })

  it('says when main truncated the result, rather than showing a short answer as a complete one', async () => {
    const query = vi.fn(async () => queryOk(['id'], [['a']], { truncated: true, rowLimit: 1000 }))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    fireEvent.click(await screen.findByText('companies'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText(/truncated at 1,000 rows/)).toBeTruthy()
  })

  it('keeps every column of a join that repeats a name, because rows are positional', async () => {
    // The reason `db:query` hands back positional arrays: a four-table join
    // names `id` four times, and an object row would silently keep one.
    const query = vi.fn(async () => queryOk(['id', 'id'], [['c1', 'p1']]))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    fireEvent.click(await screen.findByText('companies'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await screen.findByText('c1')
    expect(screen.getAllByRole('columnheader', { name: 'id' })).toHaveLength(2)
    expect(screen.getByText('p1')).toBeTruthy()
  })

  it('renders NULL as null rather than as an empty cell', async () => {
    const query = vi.fn(async () => queryOk(['note'], [[null]]))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    fireEvent.click(await screen.findByText('companies'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(await screen.findByText('null')).toBeTruthy()
  })

  it('shows a refusal\'s own reason, not a generic failure message', async () => {
    const refusal =
      'Refused: this statement modifies the database. The query console runs on a read-only connection and accepts only statements that read data.'
    const query = vi.fn(async () => ({
      ok: true as const,
      data: { ok: false as const, error: { code: 'writes-data' as const, message: refusal } }
    }))
    renderData({ 'db:query': query as unknown as CrmApi['db:query'] })

    const box = (await screen.findByLabelText('Statement')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'DELETE FROM companies' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    // Verbatim — §6.12 and T-260828-39 went to trouble to produce this
    // sentence, and swallowing it behind "something went wrong" is the
    // failure this assertion exists to catch.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(refusal)
  })
})

describe('WorkspaceData — saved snippets', () => {
  it('saves a snippet through the settings repository and it survives a remount', async () => {
    let stored: { name: string; statement: string }[] = []
    const set = vi.fn(async (entry: SettingEntry) => {
      stored = entry.value as { name: string; statement: string }[]
      return { ok: true as const, data: { ok: true as const, data: entry } }
    })
    const get = vi.fn(async () => ({
      ok: true as const,
      data: { key: 'view.data.snippets' as const, value: stored }
    }))

    const { rerender } = renderData({
      'settings:get': get as unknown as CrmApi['settings:get'],
      'settings:set': set as unknown as CrmApi['settings:set']
    })

    const box = (await screen.findByLabelText('Statement')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'SELECT count(*) FROM tasks' } })
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'Task count' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }))

    await waitFor(() =>
      expect(set).toHaveBeenCalledWith({
        key: 'view.data.snippets',
        value: [{ name: 'Task count', statement: 'SELECT count(*) FROM tasks' }]
      })
    )

    // A fresh client and a fresh mount is what a restart looks like from
    // this view's side — the snippet comes back from the settings row, not
    // from component state.
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceData />
      </QueryClientProvider>
    )
    expect(await screen.findByRole('button', { name: 'Task count' })).toBeTruthy()
  })

  it('offers the built-in starter snippets and loads one into the console', async () => {
    renderData()
    const chip = await screen.findByRole('button', { name: 'Open todos' })
    fireEvent.click(chip)

    const box = screen.getByLabelText('Statement') as HTMLTextAreaElement
    expect(box.value).toContain('FROM tasks')
  })
})

describe('formatBytes', () => {
  it('matches the mockup\'s own units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(131_072)).toBe('128.0 KB')
    expect(formatBytes(1_468_006)).toBe('1.4 MB')
  })
})

describe('WorkspaceData — failure', () => {
  it('surfaces a db:stats failure instead of an endless spinner', async () => {
    renderData({
      'db:stats': vi.fn(async () => ({
        ok: false as const,
        error: { code: 'handler-error' as const, message: 'db:stats: something went wrong handling this request' }
      })) as unknown as CrmApi['db:stats']
    })

    const empty = await screen.findByText(/something went wrong/)
    expect(within(empty).queryByRole('button')).toBeNull()
  })
})
