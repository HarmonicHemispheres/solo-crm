import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate, type To } from 'react-router'
import { EmptyState } from '../primitives/EmptyState'
import { SearchIcon } from './icons'
import { useLayerManager } from './layer-manager-context'
import { CREATE_COMMANDS, runCreateCommand } from './create-commands'
import { useCompaniesList, useEngagementsList, usePeopleList } from '../sheets/queries'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import { targetForSearchResult } from '../../nav'
import type { SearchKind, SearchResult } from '../../../shared/search'
import './CommandPalette.css'

/**
 * ⌘K — search everything, leading with the create commands (P1-10,
 * requirements §6.9). Mounted by `LayerManager` as the `palette` layer's
 * content; ⌘K/Ctrl+K is bound once in `hooks/useGlobalShortcuts.ts`, which
 * this task does not touch.
 *
 * **Esc is not handled here.** `LayerManager` owns dismissal for every layer
 * outright (T-260828-12's review settled it, and this task's Risks name
 * taking Esc locally as the repeat of that finding). A local Escape listener
 * would close this palette *and* whatever it was stacked over on one press.
 * The `esc close` hint in the footer describes what the layer manager does,
 * not something this file implements.
 *
 * **Where the one-frame budget actually lives** (§8, X-07). Three separate
 * things keep a keystroke's cost off the render path:
 *
 * 1. The *query* is debounced (`DEBOUNCE_MS`), so a burst of keystrokes
 *    issues one `search:query`, not one per character.
 * 2. Every keystroke still re-renders immediately — from the create commands
 *    (a five-element in-memory filter) and from whatever results are already
 *    cached, never blocking on the round trip. `keepPreviousData` is what
 *    keeps the previous answer on screen while the next one is in flight, so
 *    the list never flashes empty mid-word.
 * 3. Ranking is `useMemo`'d over at most `RESULT_LIMIT` rows, and the
 *    displayed list is capped at `MAX_ITEMS` — the per-keystroke work does
 *    not grow with the size of the database. `CommandPalette.latency.test.tsx`
 *    measures exactly that, at 10x volume; the database half of the budget is
 *    `electron/main/db/repositories/search.latency.test.ts` (T-260828-51).
 */

/** Long enough to swallow a fluent typist's inter-key gap, short enough that a pause feels immediate. */
const DEBOUNCE_MS = 90

/** Rows `search:query` is asked for. The palette shows fewer (`MAX_ITEMS`); the extra headroom is what lets create commands rank in without pushing every record out. */
const RESULT_LIMIT = 25

/** Rows drawn at once — the mockup's own `palItems.slice(0,12)`. */
const MAX_ITEMS = 12

/** Recent records shown for an empty query, so ⌘K on a blank input is never a blank panel (acceptance). */
const RECENT_LIMIT = 5

/**
 * At or below this many characters a query is "short" and the create
 * commands rank above record matches (this task's scope: "leads with create
 * commands ... ranked above record matches when the query is short"). Past
 * it the user is plainly naming something that exists, and records lead
 * instead — the matching create commands stay in the list, below them.
 */
const SHORT_QUERY_LENGTH = 2

/**
 * A deliberate departure from the app-wide `staleTime: Infinity`
 * (`lib/query-client.ts`): that default is correct where this app's own
 * mutations are the only writer *and* every one of them names what it
 * invalidates. Search is neither — the index is maintained by SQLite
 * triggers (ADR-008), so a create in one layer changes what a query typed a
 * minute later should match, with nothing in the renderer able to see that it
 * did. Thirty seconds keeps the within-a-word cache hits that hold the frame
 * budget while making the palette re-ask on a later visit.
 */
const SEARCH_STALE_MS = 30_000

/** The mockup's own `ki` column values, per indexed kind. */
const KIND_LABEL: Record<SearchKind, string> = {
  company: 'COMPANY',
  person: 'PERSON',
  engagement: 'ENGMT',
  task: 'TODO',
  activity: 'NOTE'
}

/** What Enter does with this row, in the hint column — the one thing a kind label alone doesn't say. */
const KIND_HINT: Record<SearchKind, string> = {
  company: 'company page',
  person: 'person page',
  engagement: 'engagements',
  task: 'todos',
  activity: 'activity'
}

const CREATE_KIND_LABEL = 'CREATE'

/** Shown in place of a missing name/title/body, rather than an empty row nothing can be read off. */
const UNTITLED = 'Untitled'

/** An activity body is a paragraph, not a name — the mockup cuts it at 52 characters for the same reason. */
const NOTE_PREVIEW_CHARS = 52

/**
 * Best-effort scroll to a just-navigated-to anchor. The target view mounts
 * and then fills in from a query, so the element does not exist on the frame
 * the navigation happens — this waits for it across a bounded number of
 * frames and gives up rather than looping forever if the row genuinely isn't
 * there (a stale search hit for a row since deleted).
 *
 * Both `requestAnimationFrame` and `scrollIntoView` are guarded: jsdom
 * implements no layout and no `scrollIntoView`, and a missing method must not
 * turn a navigation into a thrown error (the same guard `QuickLog` documents
 * for its own list).
 */
function scrollToAnchor(hash: string, framesRemaining = 30): void {
  if (typeof requestAnimationFrame !== 'function') return
  requestAnimationFrame(() => {
    const target = document.getElementById(hash.replace(/^#/, ''))
    if (target) {
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
      return
    }
    if (framesRemaining > 0) scrollToAnchor(hash, framesRemaining - 1)
  })
}

/** One rendered row: the mockup's `{ki, tx, hint, run}`. */
interface PaletteItem {
  readonly key: string
  readonly kindLabel: string
  readonly title: string
  readonly hint?: string
  readonly run: () => void
}

function resultTitle(result: SearchResult): string {
  const text = result.text?.trim()
  if (!text) return UNTITLED
  if (result.kind !== 'activity' || text.length <= NOTE_PREVIEW_CHARS) return text
  return `${text.slice(0, NOTE_PREVIEW_CHARS)}…`
}

/**
 * One record row — a search hit or a recent record, which are the same thing
 * once the kind and id are known. Module-level rather than a closure inside
 * the component so both `useMemo`s below can list it as a plain dependency.
 */
function makeRecordItem(
  result: SearchResult,
  navigate: (to: To) => void,
  onClose: () => void
): PaletteItem {
  return {
    key: `${result.kind}:${result.id}`,
    kindLabel: KIND_LABEL[result.kind],
    title: resultTitle(result),
    hint: KIND_HINT[result.kind],
    run: () => {
      const target = targetForSearchResult(result.kind, result.id)
      onClose()
      navigate(target)
      if (typeof target === 'object' && target.hash) scrollToAnchor(target.hash)
    }
  }
}

// ---------------------------------------------------------------------------

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every ⌘K starts on a blank query and a
  // selection at the top without an effect resetting either — the same
  // reasoning `LayerManager` documents for the four create sheets.
  if (!open) return null
  return <CommandPaletteBody onClose={onClose} />
}

function CommandPaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { openLayer, openSheet } = useLayerManager()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The debounce (see the component header, point 1). The state write happens
  // in the timer callback, never during the effect itself: the keystroke's
  // own render is already committed by then, so this schedules the *query*,
  // not a second render of the keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const trimmedQuery = debouncedQuery.trim()
  const searchQuery = useQuery({
    queryKey: queryKeys.search.query(trimmedQuery, RESULT_LIMIT),
    queryFn: ipcQueryFn('search:query', { query: trimmedQuery, limit: RESULT_LIMIT }),
    enabled: trimmedQuery.length > 0,
    // Keeps the last answer rendered while the next one is in flight, so the
    // list never flashes empty between keystrokes (header, point 2).
    placeholderData: keepPreviousData,
    staleTime: SEARCH_STALE_MS
  })

  // Cached by every view that already reads them (`sheets/queries.ts`), so
  // the empty-query state is drawn from data the app almost always has in
  // hand rather than three fresh round trips.
  const companies = useCompaniesList()
  const people = usePeopleList()
  const engagements = useEngagementsList()

  const toRecordItem = useCallback((result: SearchResult) => makeRecordItem(result, navigate, onClose), [navigate, onClose])

  const recents = useMemo<readonly PaletteItem[]>(() => {
    const rows = [
      ...companies.map((row) => ({ kind: 'company' as const, id: row.id, name: row.name, updatedAt: row.updatedAt })),
      ...people.map((row) => ({ kind: 'person' as const, id: row.id, name: row.name, updatedAt: row.updatedAt })),
      ...engagements.map((row) => ({ kind: 'engagement' as const, id: row.id, name: row.name, updatedAt: row.updatedAt }))
    ]
    // Most recently touched first — `updated_at` is on every entity table by
    // construction (AGENTS.md), so "recent" needs no extra read to compute.
    rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    return rows.slice(0, RECENT_LIMIT).map((row) => toRecordItem({ kind: row.kind, id: row.id, text: row.name }))
  }, [companies, people, engagements, toRecordItem])

  const items = useMemo<readonly PaletteItem[]>(() => {
    const needle = query.trim().toLowerCase()
    const creates = CREATE_COMMANDS.filter((command) => !needle || command.paletteLabel.toLowerCase().includes(needle)).map(
      (command) => ({
        key: `create:${command.id}`,
        kindLabel: CREATE_KIND_LABEL,
        title: command.paletteLabel,
        hint: command.hint,
        run: () => {
          // Close first: `closeLayer` returns focus to whatever opened the
          // palette, and the sheet then captures that same element as its own
          // focus-return target rather than the input that is unmounting.
          onClose()
          runCreateCommand(command, { openLayer, openSheet })
        }
      })
    )

    // Records come from the debounced query, create commands from the live
    // one, which is deliberate: the create block responds to the keystroke
    // that was just typed while the record block catches up a frame or two
    // later (header, point 2).
    const records = needle ? (searchQuery.data ?? []).map(toRecordItem) : recents

    const ordered = needle.length > SHORT_QUERY_LENGTH ? [...records, ...creates] : [...creates, ...records]
    return ordered.slice(0, MAX_ITEMS)
  }, [query, searchQuery.data, recents, toRecordItem, openLayer, openSheet, onClose])

  // Clamped rather than reset from an effect: the list shrinks as the query
  // narrows, and a stale index past its end would leave Enter selecting
  // nothing (the same clamp `QuickLog`'s who-list uses).
  const activeIndex = Math.min(highlight, Math.max(items.length - 1, 0))

  // Arrow keys move a highlight inside a scrolling list; without this it
  // leaves the viewport and the keyboard drives a selection nobody can see.
  // Guarded for jsdom, which implements neither layout nor `scrollIntoView`.
  useEffect(() => {
    const row = listRef.current?.querySelectorAll('.pal-i').item(activeIndex)
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items])

  const optionDomId = (index: number) => `${listId}-${index}`

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Esc is deliberately absent — LayerManager owns it (component header).
    if (items.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((activeIndex + 1) % items.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((activeIndex - 1 + items.length) % items.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      items[activeIndex]?.run()
    }
  }

  return (
    <div
      className="scrim open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pal" role="dialog" aria-label="Search" aria-modal="true">
        <div className="pal-in">
          <SearchIcon width={16} height={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search or create…"
            autoComplete="off"
            aria-label="Search or create"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items.length > 0 ? optionDomId(activeIndex) : undefined}
          />
        </div>
        <div className="pal-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
          {items.length === 0 ? (
            <EmptyState>No match.</EmptyState>
          ) : (
            items.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="option"
                id={optionDomId(index)}
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'pal-i sel' : 'pal-i'}
                onMouseEnter={() => setHighlight(index)}
                onClick={item.run}
              >
                <span className="ki">{item.kindLabel}</span>
                <span className="tx">{item.title}</span>
                <span className="hint">{item.hint ?? ''}</span>
              </button>
            ))
          )}
        </div>
        <div className="pal-foot">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
