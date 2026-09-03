import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Toggle } from '../components/primitives/Toggle'
import { Button } from '../components/primitives/Button'
import { Card } from '../components/primitives/Card'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { Ring } from '../components/primitives/Ring'
import { DecayMeter } from '../components/primitives/DecayMeter'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager, type LayerManagerContextValue } from '../components/shell/layer-manager-context'
import { callCrm, ipcQueryFn, optimisticUpdate, unwrapMutationResult } from '../lib/ipc'
import { decayForCompany, type Decay, type DecayBand } from '../lib/decay'
import { identityColor, initials } from '../lib/identity'
import { invalidate, queryKeys } from '../lib/query-keys'
import type { Company, CompanyKind } from '../../shared/companies'
import type { CompanyImageThumbnails } from '../../shared/company-images'
import type { Engagement } from '../../shared/engagements'
import type { SettingEntry } from '../../shared/ipc-types'
import type { ViewPresentationMode } from '../../shared/settings'
import './Companies.css'

/**
 * §6.2/§6.13: the first view to get a real body — its shape (ViewHeader with
 * the presentation toggle, a query through the merged T-260828-26 channels,
 * an EmptyState when there's nothing, no direct `window.crm` call from a
 * component) is the pattern the other eight views copy. See the task file's
 * "Why".
 */

// ---------------------------------------------------------------------------
// Identity mark — `mark()`/`hue()`/`initials()` from the mockup, ported
// verbatim (this task's Risks: "taken from the mockup, not invented"). Not a
// shared primitive: T-260828-11's closed primitive list has no `.cmark`, and
// `components/icons.tsx`'s own header reserves per-view visuals like this one
// for the view that uses them.
// ---------------------------------------------------------------------------



/**
 * The mark, now image-aware (T-260901-15). `logo` is the **derivative**
 * `companyImages:thumbnails` returned for this company — a 96 × 96 PNG data
 * URL, never an original — or `null`/`undefined` for the ordinary case, which
 * is every company until someone uploads one.
 *
 * It takes the URL as a prop and issues no read of its own. ADR-015 §3 is
 * explicit about why: "a mark with its own `useQuery` is a per-card fetch
 * wearing a component's clothes", and it is what this view's channel-count
 * test exists to catch. Still a local function rather than a shared
 * component — T-260901-14 owns CompanyDetail's copy and this task's Touches
 * list is this file, its stylesheet and its test.
 *
 * With no logo the returned element is byte-identical to what it was before
 * this task: the same `cmark` class, the same single `<span>` of initials.
 */
function CompanyMark({ name, size, logo }: { name: string; size: number; logo?: string | null }) {
  const color = identityColor(name)
  const style: CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.37), color }
  return (
    // Decorative: the full name always sits right beside this mark (the
    // card's .nm, the table row's .nm), so its initials would otherwise
    // leak into the card/row's computed accessible name ahead of the name
    // itself — hidden rather than announced redundantly. The logo is
    // decorative for the same reason, and carries `alt=""` on top of the
    // wrapper's `aria-hidden` so it is never announced as an unnamed image.
    <span className={logo ? 'cmark has-image' : 'cmark'} style={style} aria-hidden="true">
      {logo ? <img className="cmark-img" src={logo} alt="" /> : <span>{initials(name)}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Kind display — companySchema's kind is the lowercase/snake wire enum
// (COMPANY_KINDS); the mockup's synthetic fixtures spell it Title Case. This
// is the one place the two are reconciled, matching `kindTag()`'s colour
// choices exactly (mockup:940).
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}

const KIND_VARIANT: Record<CompanyKind, TagVariant> = {
  client: 'verd',
  end_client: 'lapis',
  advisory: 'lapis',
  channel: 'lapis',
  prospect: 'gold'
}

function KindTag({ kind }: { kind: CompanyKind | null }) {
  if (kind == null) return <Tag>—</Tag>
  return <Tag variant={KIND_VARIANT[kind]}>{KIND_LABEL[kind]}</Tag>
}

// ---------------------------------------------------------------------------
// Decay — `lib/decay.ts`'s `decayForCompany`, the same function Today.tsx
// and CompanyDetail.tsx call (T-260901-27).
//
// This view carried its own copy until then, and the copies had diverged in
// both of the ways two implementations of one rule diverge:
//
//   - **Rounding.** This one rounded elapsed days, `decay.ts` floors. A
//     company touched 49 days and 14 hours ago read "50d" on this grid and
//     "49d" on Today and on its own detail page, at the same moment, on the
//     seeded database.
//   - **The missing cadence.** This one required the company's *own*
//     `cadenceDays` and gave up (`NaN`) without it. `decay.ts` falls back to
//     the kind's default from settings (P2-03), which is the decision — a
//     company on the sheet's "Not set" cadence chip showed a full red bar
//     here while Today listed it as perfectly current.
//
// `decayColor` also had a bug of its own that routing through the shared
// function removes rather than fixes: `!Number.isFinite(pct)` returned
// verdigris — a *green* ring beside the red bar `DecayMeter` draws for the
// same company, on exactly ADR-001 rule 5's case (never touched, no cadence
// resolvable). It now switches on `decay.band`, which is one answer for both
// primitives by construction.
// ---------------------------------------------------------------------------

const BAND_COLOR: Record<DecayBand, string> = {
  ok: 'var(--verdigris)',
  warn: 'var(--orange)',
  late: 'var(--red)'
}

// ---------------------------------------------------------------------------
// Row shape + sort — one row per top-level (non-end-client) company, with
// the two counts both presentations need already attached so neither card
// nor table re-derives them.
// ---------------------------------------------------------------------------

/** Which companies the grid draws. `all` includes end clients — companies
 * you deliver to but invoice through someone else — marked `via <partner>`;
 * `direct` is the billing-partner list on its own. */
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'direct', label: 'Direct only' }
] as const
type CompanyScope = (typeof SCOPE_OPTIONS)[number]['value']

/** "via Acme", or an honest fallback when the partner is not in the list —
 * never a blank, which would read as a company that bills directly. */
function viaLabel(billedVia: string | null): string {
  return billedVia === null ? 'via another company' : `via ${billedVia}`
}

interface CompanyRow {
  company: Company
  activeEngagements: number
  endClients: number
  /**
   * Whether this company is billed through another one — read from the id,
   * not from whether the name resolved. A partner missing from the list
   * would otherwise silently reclassify its end client as direct and hide it
   * from `Direct only`, which is the exact failure this whole row shape
   * exists to stop.
   */
  isEndClient: boolean
  /**
   * The billing partner's name, when the list holds it. Carried on the row
   * so a card and a table row both say "via Acme" from one lookup rather
   * than each resolving the id again.
   */
  billedVia: string | null
  /**
   * Computed once per row, in the same memo as the counts and for the same
   * reason: the card and the table row are two presentations of one company,
   * and a `decayForCompany` call in each would give them two `now`s and two
   * chances to drift. It also keeps the cadence *sort* below reading the
   * same number the meter draws.
   */
  decay: Decay
}

/**
 * One company's present slots, as `companyImages:thumbnails` keys them — the
 * value type of ADR-015's map, named once so a card, a row and a mark all
 * spell the same thing. `undefined` for a company with no images at all,
 * which is how the map answers: present slots only, absent companies simply
 * missing rather than carrying two `null`s.
 */
type CompanyImages = CompanyImageThumbnails[string] | undefined

/** An empty map, referentially stable, so a pending or failed thumbnails read does not re-render every card with a fresh `{}`. */
const NO_IMAGES: CompanyImageThumbnails = {}

type SortColumn = 'name' | 'kind' | 'engagements' | 'cadence' | 'lastTouch'
type SortDirection = 'asc' | 'desc'
interface SortState {
  column: SortColumn
  direction: SortDirection
}

function compareRows(a: CompanyRow, b: CompanyRow, column: SortColumn): number {
  switch (column) {
    case 'name':
      return a.company.name.localeCompare(b.company.name)
    case 'kind':
      return (a.company.kind ?? '').localeCompare(b.company.kind ?? '')
    case 'engagements':
      return a.activeEngagements - b.activeEngagements
    case 'cadence':
      // `decay.cadenceDays`, not `company.cadenceDays`: the column now shows
      // the effective cadence (the company's own, or its kind's default), so
      // sorting on the raw nullable column would order the table by a number
      // it is not displaying.
      return a.decay.cadenceDays - b.decay.cadenceDays
    case 'lastTouch': {
      // ADR-001 rule 5: a null last_touch_at is maximally stale, so it sorts
      // as the oldest possible value rather than being pushed to either end
      // by accident.
      const at = a.company.lastTouchAt ? Date.parse(a.company.lastTouchAt) : -Infinity
      const bt = b.company.lastTouchAt ? Date.parse(b.company.lastTouchAt) : -Infinity
      return at - bt
    }
  }
}

// ---------------------------------------------------------------------------
// The persisted card/list toggle — §6.13, backed by `view.companies.mode`
// (electron/shared/settings.ts), read/written only through settings:get /
// settings:set (the settings repository is merged; no second persistence).
// ---------------------------------------------------------------------------

function modeFromEntry(entry: SettingEntry | undefined): ViewPresentationMode {
  if (entry && entry.key === 'view.companies.mode') return entry.value
  return 'card'
}

const MODE_SETTING_KEY = 'view.companies.mode' as const

export function Companies() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openSheet } = useLayerManager()
  const [sort, setSort] = useState<SortState | null>(null)
  const [scope, setScope] = useState<CompanyScope>('all')

  // Read once per mount, not per render — the same reasoning Today.tsx and
  // CompanyDetail.tsx state for their own clocks: an inline `new Date()`
  // makes every render a fresh memo dependency, and lets two cards on one
  // screen disagree about what "now" is.
  const now = useMemo(() => new Date(), [])

  const companiesQuery = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  const engagementsQuery = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  // The snapshot `decayForCompany` needs for its kind-default cadence. The
  // same key Shell.tsx, Rail.tsx and Today.tsx already hold, so this issues
  // no second `settings:getAll`.
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.list(), queryFn: ipcQueryFn('settings:getAll') })
  const modeQuery = useQuery({
    queryKey: queryKeys.settings.detail(MODE_SETTING_KEY),
    queryFn: ipcQueryFn('settings:get', { key: MODE_SETTING_KEY })
  })
  /**
   * ADR-015's list read, and the only one this view makes for images: **one**
   * call carrying every company's stored 96 × 96 / 480 × 270 derivative, never
   * an original and never one call per card. Reading the originals here would
   * be 83.9 MB of base64 for a 60-company grid; this is about 1.5 MB, and the
   * difference is invisible on the seeded database, which has no images at
   * all. `Companies.test.tsx` counts the calls for exactly that reason.
   *
   * Deliberately **not** part of `isLoading` or `loadError` below. A missing
   * image is not a missing company: absence is already the rendered default
   * (the derived mark and the flat surface), so the grid paints on
   * `companies:list` and the wash arrives when it arrives. Gating on it would
   * hold every card behind a decoration, and failing on it would replace a
   * perfectly good list with an error panel because a thumbnail did not load.
   */
  const thumbnailsQuery = useQuery({
    queryKey: queryKeys.companyImages.thumbnails(),
    queryFn: ipcQueryFn('companyImages:thumbnails')
  })

  // The cache is written before the round trip so the toggle feels instant
  // (§6.13: the choice is "remembered per view" and survives a restart, which
  // is what settings:set is for). Through `optimisticUpdate` rather than a
  // bare `setQueryData` at the call site: that had no `onError`, so a failed
  // settings:set left the optimistic value on screen while main still held
  // the old one — the view claiming a preference the app had not stored
  // (T-260828-53 item 6). `optimisticUpdate` snapshots, rolls back on
  // failure, and reconciles through `invalidate.settings` either way.
  const setModeMutation = useMutation({
    mutationFn: (value: ViewPresentationMode) =>
      callCrm('settings:set', { key: MODE_SETTING_KEY, value }).then(unwrapMutationResult),
    ...optimisticUpdate<SettingEntry, ViewPresentationMode>(
      queryClient,
      queryKeys.settings.detail(MODE_SETTING_KEY),
      (_current, value) => ({ key: MODE_SETTING_KEY, value }),
      invalidate.settings
    )
  })

  const mode = modeFromEntry(modeQuery.data)

  function handleModeChange(next: ViewPresentationMode) {
    setModeMutation.mutate(next)
  }

  const rows = useMemo<CompanyRow[]>(() => {
    const companies: readonly Company[] = companiesQuery.data ?? []
    const engagements: readonly Engagement[] = engagementsQuery.data ?? []
    const settings = settingsQuery.data
    // `decayForCompany` needs the snapshot for its kind-default cadence, and
    // the view already blocks on `settingsQuery.isPending` below — so this
    // is the un-rendered window, not a state anything paints. Returning []
    // rather than falling back to some stand-in snapshot: a guessed default
    // would put a wrong band on screen for one frame, which is the exact
    // class of thing this task exists to stop. Today.tsx's `quiet` memo does
    // the same on the same query.
    if (!settings) return []

    const activeByBiller = new Map<string, number>()
    for (const engagement of engagements) {
      if (engagement.status !== 'active' || engagement.billingCompanyId == null) continue
      activeByBiller.set(engagement.billingCompanyId, (activeByBiller.get(engagement.billingCompanyId) ?? 0) + 1)
    }
    const endClientsByParent = new Map<string, number>()
    for (const company of companies) {
      if (company.billedViaCompanyId == null) continue
      endClientsByParent.set(company.billedViaCompanyId, (endClientsByParent.get(company.billedViaCompanyId) ?? 0) + 1)
    }
    // This list used to drop every company with a `billedViaCompanyId` — an
    // end client "belongs on that company's detail page, not as a peer row
    // here". The tidiness was real and the cost was worse: a company created
    // as billed-through-another vanished from the only place you browse
    // companies, reachable afterwards only by search or by already knowing
    // which parent to open. A record you cannot find is not a tidier list.
    //
    // So every company is a row, and `scope` below decides which are drawn.
    // An end client is marked `via <partner>` rather than presented as a
    // peer, which is what the original exclusion was really protecting.
    const namesById = new Map(companies.map((company) => [company.id, company.name] as const))
    return companies.map((company) => ({
      company,
      activeEngagements: activeByBiller.get(company.id) ?? 0,
      endClients: endClientsByParent.get(company.id) ?? 0,
      isEndClient: company.billedViaCompanyId != null,
      billedVia: company.billedViaCompanyId == null ? null : (namesById.get(company.billedViaCompanyId) ?? null),
      decay: decayForCompany(company, settings, now)
    }))
  }, [companiesQuery.data, engagementsQuery.data, settingsQuery.data, now])

  // Default `all`: the failure this replaces was a company nobody could
  // find, so the state that shows everything is the one a fresh launch lands
  // on. `direct` is there for the operator who wants the billing-partner
  // list on its own.
  const scopedRows = useMemo(
    () => (scope === 'direct' ? rows.filter((row) => !row.isEndClient) : rows),
    [rows, scope]
  )

  const sortedRows = useMemo(() => {
    if (!sort) return scopedRows
    const sign = sort.direction === 'asc' ? 1 : -1
    return [...scopedRows].sort((a, b) => sign * compareRows(a, b, sort.column))
  }, [scopedRows, sort])

  function handleSort(column: SortColumn) {
    setSort((previous) => {
      if (previous?.column === column) {
        return { column, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: 'asc' }
    })
  }

  const isLoading =
    companiesQuery.isPending || engagementsQuery.isPending || modeQuery.isPending || settingsQuery.isPending
  const loadError = companiesQuery.error ?? engagementsQuery.error ?? modeQuery.error ?? settingsQuery.error
  const images = thumbnailsQuery.data ?? NO_IMAGES

  const header = (
    <ViewHeader
      icon={<CompaniesGlyph />}
      accent="var(--lapis)"
      title="Companies"
      description="End clients are companies you deliver to but do not invoice. They carry their own contacts, budget and touchpoints while revenue rolls up to the billing partner — they are listed here too, marked with the partner they bill through. Switch to Direct only for the billing partners on their own."
      actions={
        <>
          <Toggle aria-label="Which companies to list" options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
          <Toggle
            aria-label="Companies view presentation"
            options={PRESENTATION_OPTIONS}
            value={mode}
            onChange={handleModeChange}
          />
          <Button variant="ghost" onClick={(event) => openSheet('company', event.currentTarget)}>
            <PlusIcon />
            New company
          </Button>
        </>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading companies…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        {header}
        <EmptyState>{loadError.message}</EmptyState>
      </div>
    )
  }

  // Every company is an end client, and the scope is hiding all of them.
  // "No companies yet" would be a lie, and the fix is one click away, so say
  // which one rather than offering to create a company that already exists.
  if (sortedRows.length === 0 && rows.length > 0) {
    return (
      <div>
        {header}
        <EmptyState>
          Every company here bills through a partner. Switch to <strong>All</strong> to see them.
        </EmptyState>
      </div>
    )
  }

  if (sortedRows.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          action={
            // "Add company", not the header button's "New company" text: the
            // ViewHeader's own create action (matching the mockup's/NewMenu's
            // wording) is rendered above this on every branch, so the two
            // buttons need distinct accessible names rather than two
            // identically-labelled "New company" buttons on the same page.
            <Button variant="primary" onClick={(event) => openSheet('company', event.currentTarget)}>
              <PlusIcon />
              Add company
            </Button>
          }
        >
          No companies yet. Add the first one to start tracking cadence.
        </EmptyState>
      </div>
    )
  }

  return (
    <div>
      {header}
      {mode === 'list' ? (
        <CompaniesTable
          rows={sortedRows}
          images={images}
          sort={sort}
          onSort={handleSort}
          onOpen={(id) => navigate(`/company/${id}`)}
        />
      ) : (
        <CompaniesGrid
          rows={sortedRows}
          images={images}
          onOpen={(id) => navigate(`/company/${id}`)}
          onCreate={openSheet}
        />
      )}
    </div>
  )
}

/**
 * `VIEWTOG` (planning/solo-crm-mockup.html:1465) — two icon buttons, not the
 * words "Card"/"List". `.claude/rules/ui-design.md`: icon buttons by default,
 * text labels reserved for a view's primary action. The label each button
 * still needs lives on the `<svg role="img" aria-label>` itself, which is
 * what gives the button its accessible name ("Card view" / "List view",
 * the mockup's own wording) without `Toggle` — a shared primitive this task
 * does not own — needing a per-option label prop.
 */
const PRESENTATION_OPTIONS = [
  { value: 'card' as const, label: <CardViewGlyph /> },
  { value: 'list' as const, label: <ListViewGlyph /> }
]

function CardViewGlyph() {
  return (
    <svg className="vtog-icon" viewBox="0 0 24 24" role="img" aria-label="Card view">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="8" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
    </svg>
  )
}

function ListViewGlyph() {
  return (
    <svg className="vtog-icon" viewBox="0 0 24 24" role="img" aria-label="List view">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function CompaniesGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 21V6l7-3v18M11 21h9V10l-9-3" />
    </svg>
  )
}

function CompaniesGrid({
  rows,
  images,
  onOpen,
  onCreate
}: {
  rows: readonly CompanyRow[]
  /** The whole map from the view's single `companyImages:thumbnails` read; each card indexes it by the id it already holds. */
  images: CompanyImageThumbnails
  onOpen: (id: string) => void
  /** `openSheet` itself, typed off the context value so this card's create
   * call cannot drift from the signature every other create button in the
   * view uses — the drift T-260829-08 closed. */
  onCreate: LayerManagerContextValue['openSheet']
}) {
  return (
    <div className="grid autofill">
      {rows.map((row) => (
        <CompanyCard key={row.company.id} row={row} images={images[row.company.id]} onOpen={onOpen} />
      ))}
      {/* "Add company" — see the EmptyState action's comment on why this
          reads differently from the ViewHeader's own "New company" button
          sitting above it in the same view. */}
      <button
        type="button"
        className="ccard ccard-new"
        onClick={(event) => onCreate('company', event.currentTarget)}
      >
        <PlusIcon width={22} height={22} />
        <span className="meta">Add company</span>
      </button>
    </div>
  )
}

function CompanyCard({
  row,
  images,
  onOpen
}: {
  row: CompanyRow
  images: CompanyImages
  onOpen: (id: string) => void
}) {
  const { company, activeEngagements, endClients, isEndClient, billedVia, decay } = row
  const banner = images?.banner?.dataUrl ?? null
  return (
    // `.has-banner` is what carries every rule the wash needs — the stacking
    // context, the layer's own positioning, and the metadata line's step up
    // to `--mute` for contrast against it. A company with no banner gets the
    // bare `ccard` class and no extra child, so its card is byte-identical to
    // what this view rendered before T-260901-15: no placeholder, no empty
    // band, no changed computed background.
    <button
      type="button"
      className={banner ? 'ccard has-banner' : 'ccard'}
      onClick={() => onOpen(company.id)}
    >
      {banner && (
        // A sibling layer, not a background on the button itself: `.ccard`
        // already paints `var(--surface)`, and the wash has to sit *between*
        // that and the card's content so the gradient can fade it out before
        // the text. `z-index: -1` in the card's own stacking context is what
        // puts it there (Companies.css). It is `aria-hidden` and
        // `pointer-events: none`, so it neither renames the button nor
        // intercepts the click — the card is still one button with one
        // accessible name.
        <span
          className="ccard-wash"
          aria-hidden="true"
          style={{ backgroundImage: `url("${banner}")` }}
        />
      )}
      <div className="top">
        <CompanyMark name={company.name} size={38} logo={images?.logo?.dataUrl} />
        <div className="grow">
          <div className="nm trunc">{company.name}</div>
          {/* The partner replaces the website rather than adding a third
              line: for an end client, who invoices it is the fact that
              explains why it is not a peer of the row above. */}
          <div className="meta trunc">{isEndClient ? viaLabel(billedVia) : (company.website ?? '—')}</div>
        </div>
        <Ring pct={decay.pct} size={30} color={BAND_COLOR[decay.band]} />
      </div>
      <div className="tags">
        <KindTag kind={company.kind} />
        {activeEngagements > 0 && <Tag variant="verd">{activeEngagements} active</Tag>}
        {endClients > 0 && (
          <Tag variant="lapis">
            {endClients} end client{endClients > 1 ? 's' : ''}
          </Tag>
        )}
      </div>
      <div className="foot">
        <DecayMeter pct={decay.pct} label={decay.label} description={decay.description} />
        {/* `decay.cadenceDays` — the cadence actually used, so a company
            with none of its own reads its kind's inherited default here
            rather than "no cadence set" beside a bar measured against that
            very default. 0 is the one case nothing resolved (no cadence, no
            kind), and it still says so. */}
        <span className="n">{decay.cadenceDays > 0 ? `every ${decay.cadenceDays}d` : 'no cadence set'}</span>
      </div>
    </button>
  )
}

interface SortableColumn {
  column: SortColumn
  label: string
  align?: 'right'
}

const TABLE_COLUMNS: readonly SortableColumn[] = [
  { column: 'name', label: 'Company' },
  { column: 'kind', label: 'Kind' },
  { column: 'engagements', label: 'Engagements' },
  { column: 'cadence', label: 'Cadence', align: 'right' },
  { column: 'lastTouch', label: 'Last touch', align: 'right' }
]

function ariaSortFor(sort: SortState | null, column: SortColumn): 'ascending' | 'descending' | 'none' {
  if (sort?.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function CompaniesTable({
  rows,
  images,
  sort,
  onSort,
  onOpen
}: {
  rows: readonly CompanyRow[]
  /** The same map the grid reads, from the same single call — the table presentation is the second reader ADR-015 names, not a second read. */
  images: CompanyImageThumbnails
  sort: SortState | null
  onSort: (column: SortColumn) => void
  onOpen: (id: string) => void
}) {
  return (
    <Card>
      <table className="tbl">
        <thead>
          <tr>
            {TABLE_COLUMNS.map(({ column, label, align }) => (
              <th
                key={column}
                aria-sort={ariaSortFor(sort, column)}
                className={align === 'right' ? 'align-right' : undefined}
              >
                <button type="button" className="sort-btn" onClick={() => onSort(column)}>
                  {label}
                  {sort?.column === column && (
                    <span className="sort-arrow" aria-hidden="true">
                      {sort.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CompanyTableRow key={row.company.id} row={row} images={images[row.company.id]} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function CompanyTableRow({
  row,
  images,
  onOpen
}: {
  row: CompanyRow
  images: CompanyImages
  onOpen: (id: string) => void
}) {
  const { company, activeEngagements, endClients, isEndClient, billedVia, decay } = row
  const activate = () => onOpen(company.id)
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate()
  }

  return (
    // tabIndex + a key handler make the row keyboard-reachable and
    // activatable (this task's Acceptance) without overriding its native
    // `row` role the way `role="button"` would — that would strip the
    // row/cell structure screen readers use to read the table.
    <tr tabIndex={0} aria-label={`Open ${company.name}`} onClick={activate} onKeyDown={handleKeyDown}>
      <td>
        <div className="id-cell">
          {/* The logo, and only the logo: a table row is not a canvas, so the
              banner is deliberately absent here (this task's Scope). */}
          <CompanyMark name={company.name} size={26} logo={images?.logo?.dataUrl} />
          <div className="grow">
            <div className="trunc nm">{company.name}</div>
            <div className="meta trunc">
              {isEndClient
                ? viaLabel(billedVia)
                : endClients > 0
                  ? `${endClients} end client${endClients > 1 ? 's' : ''}`
                  : (company.website ?? '—')}
            </div>
          </div>
        </div>
      </td>
      <td>
        <KindTag kind={company.kind} />
      </td>
      <td className="mono eng">{activeEngagements} active</td>
      <td className="num">{decay.cadenceDays > 0 ? `${decay.cadenceDays}d` : '—'}</td>
      <td className="last-touch">
        <DecayMeter pct={decay.pct} label={decay.label} description={decay.description} />
      </td>
    </tr>
  )
}
