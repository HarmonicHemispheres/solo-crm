import { useMemo, useState, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ViewHeader } from '../components/primitives/ViewHeader'
import { Toggle } from '../components/primitives/Toggle'
import { Button } from '../components/primitives/Button'
import { Card } from '../components/primitives/Card'
import { Chip } from '../components/primitives/Chip'
import { Tag } from '../components/primitives/Tag'
import { IconButton } from '../components/primitives/IconButton'
import { QuickAdd } from '../components/primitives/QuickAdd'
import { EmptyState } from '../components/primitives/EmptyState'
import { PlusIcon } from '../components/icons'
import { useLayerManager } from '../components/shell/layer-manager-context'
import { callCrm, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { invalidate, queryKeys } from '../lib/query-keys'
import { BILLING_MODEL_LABEL, formatRate } from './offerings-display'
import { parseQuickAddOffering } from './offerings-quick-add'
import type {
  CreateOfferingInput,
  OfferingCategory,
  OfferingListItem,
  OfferingType,
  UpdateOfferingCategoryInput
} from '../../shared/offerings'
import './Offerings.css'

/**
 * `/offerings` (P3-07) — §6.5's catalogue, over T-260901-07's ten channels.
 * A **management surface, not an analytics surface**, which is the line this
 * view is most likely to be pushed across later: a count of engagements sold
 * at each rate, revenue per offering, a "most popular" marker are all things
 * §6.5 is refusing, not things it forgot. Nothing here sums, projects or
 * branches on `billingModel` to produce a figure; the only money on screen is
 * one stored `rateCents` per row, rendered by `offerings-display.ts` — which
 * ADR-003 permits explicitly and its own header restates.
 *
 * **No price is written after creation, anywhere in this view.** §6.5 makes
 * changing a price a distinct action that closes the current version and
 * appends the next with an effective date so signed engagements keep the rate
 * they were sold at; P3-02 builds that versioning and P3-08 builds the sheet.
 * Until both land, `OfferingSheet` writes the first version on create and
 * shows the current one read-only on edit, beside a disabled "Change price"
 * control. This view shows a rate and never offers to edit one.
 *
 * **Archive, never delete.** There is no delete control for an offering here,
 * and there is no channel behind one either (`electron/shared/ipc-types.ts`
 * says why). Archived rows are hidden until the Archived filter reveals them,
 * and they carry no actions at all — `archiveOffering` has no inverse in the
 * repository, so a Restore button would be a control with nothing behind it.
 *
 * The card/list toggle §6.13 gives Companies and People is deliberately
 * **not** here, and neither is a `view.offerings.mode` settings key. The
 * mockup's offerings view has no such toggle: it is one presentation —
 * category blocks of rows — because a category *is* the grouping, and a card
 * grid would have to drop it. A toggle with only one thing to toggle to is
 * the drift this task's Scope warns about, in the other direction.
 */

// ---------------------------------------------------------------------------
// Filters. All three are applied in the renderer against one unfiltered
// `offerings:list` read rather than through `ListOfferingsFilter` on the
// channel, which the wire supports. The view groups by category and reports
// each category's count, so it needs the whole catalogue in hand however the
// filters are set; a filtered channel read would be an extra round trip for a
// subset of rows the renderer is already holding, and would make the counts
// beside each category name mean something different from the rows under it.
// ---------------------------------------------------------------------------

/**
 * The mockup's own accent for this view is `#8B7FD8`, a violet `tokens.css`
 * does not carry. `People.tsx` resolved that same literal to `--lapis-deep`
 * when it was ported; this follows it rather than adding a palette entry for
 * one icon. (`ViewHeader` requires a token reference, not a literal.)
 */
const ACCENT = 'var(--lapis-deep)'

type TypeFilter = 'all' | OfferingType

const TYPE_FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All' },
  { value: 'service' as const, label: 'Services' },
  { value: 'product' as const, label: 'Products' }
]

/** `active` is nullable on the wire; only an explicit `false` means archived. A null is a row no one archived. */
function isArchived(offering: OfferingListItem): boolean {
  return offering.active === false
}

// ---------------------------------------------------------------------------
// Grouping — one block per category, in the repository's own order, plus a
// trailing block for offerings that belong to no category. That block is not
// a category: it has no name to rename and no row to delete, so it renders
// without the category actions rather than with disabled ones.
// ---------------------------------------------------------------------------

const UNCATEGORISED = '__uncategorised__'

interface CategoryBlock {
  readonly key: string
  readonly label: string
  /** The stored swatch, or `null` for the uncategorised block and for a category with no colour set. */
  readonly color: string | null
  /** `null` for the uncategorised block — what quick-add writes as `categoryId`, and what rename/delete are unavailable for. */
  readonly categoryId: string | null
  readonly offerings: readonly OfferingListItem[]
}

function buildBlocks(categories: readonly OfferingCategory[], offerings: readonly OfferingListItem[]): readonly CategoryBlock[] {
  const byCategory = new Map<string, OfferingListItem[]>()
  for (const offering of offerings) {
    const key = offering.categoryId ?? UNCATEGORISED
    const list = byCategory.get(key) ?? []
    list.push(offering)
    byCategory.set(key, list)
  }

  const blocks: CategoryBlock[] = categories.map((category) => ({
    key: category.id,
    label: category.name ?? category.id,
    color: category.color,
    categoryId: category.id,
    offerings: byCategory.get(category.id) ?? []
  }))

  const orphans = byCategory.get(UNCATEGORISED) ?? []
  if (orphans.length > 0) {
    blocks.push({ key: UNCATEGORISED, label: 'Uncategorised', color: null, categoryId: null, offerings: orphans })
  }
  return blocks
}

/**
 * Is *this* block the one being renamed? Both sides are nullable, and `null
 * === null` is the bug this function exists to not have: with a bare
 * comparison the uncategorised block — whose `categoryId` is `null` by
 * definition — rendered a rename input over its heading from first paint,
 * for a thing that is not a category and has no name to write back.
 */
function isRenaming(renamingId: string | null, block: CategoryBlock): boolean {
  return block.categoryId != null && renamingId === block.categoryId
}

// ---------------------------------------------------------------------------
// Icons — a view's own glyphs stay with the view (components/icons.tsx's
// header reserves that file for glyphs a *primitive* renders itself), which
// is the same rule Engagements.tsx's PencilIcon already follows. All four
// below are the mockup's own `.srow`/`.cathead` action paths.
// ---------------------------------------------------------------------------

function OfferingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l2.4 5.3 5.6.6-4.2 3.9 1.2 5.6L12 15.6 6.9 18.4l1.2-5.6L4 8.9l5.6-.6z" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19l1-4 10-10 3 3L8 18z" />
    </svg>
  )
}

function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 5H6a2 2 0 00-2 2v10" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11h14V8M10 12h4" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />
    </svg>
  )
}

// ---------------------------------------------------------------------------

/**
 * Where a failed mutation's message is shown. A category refusal has to land
 * beside the category it names (this task's Acceptance: the reason is shown
 * *and* the category is still listed), so it is addressed by id; everything
 * else has no row of its own to sit next to and goes above the list.
 */
type Notice = { readonly at: string; readonly message: string }

const VIEW_NOTICE = '__view__'

const EMPTY_OFFERINGS: readonly OfferingListItem[] = []
const EMPTY_CATEGORIES: readonly OfferingCategory[] = []

export function Offerings() {
  const queryClient = useQueryClient()
  const { openSheet, editSheet } = useLayerManager()

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const offeringsQuery = useQuery({ queryKey: queryKeys.offerings.list(), queryFn: ipcQueryFn('offerings:list') })
  const categoriesQuery = useQuery({
    queryKey: queryKeys.offerings.categories(),
    queryFn: ipcQueryFn('offerings:listCategories')
  })

  // One shape for every write on this page: reconcile the whole `offerings`
  // prefix (query-keys.ts's `invalidate.offerings` covers the list, every
  // filtered list, each detail and the category list — any of the seven
  // mutations can change what another scope reads) plus search, clear
  // whatever notice was standing, and place a failure's own message where it
  // belongs.
  //
  // Search alongside the entity for the reason `useSheetMutation` states:
  // offerings are one of the five indexed kinds, the palette caches a result
  // set, and quick-add is exactly the create path someone watches happen and
  // then immediately searches for. The index itself is trigger-maintained —
  // it is the renderer's cached copy of a search that would otherwise be
  // stale.
  function offeringsMutation<TVariables, TData>(
    mutationFn: (variables: TVariables) => Promise<TData>,
    noticeAt: (variables: TVariables) => string
  ) {
    return {
      mutationFn,
      onMutate: () => setNotice(null),
      onSuccess: () => Promise.all([invalidate.offerings(queryClient), invalidate.search(queryClient)]),
      onError: (error: unknown, variables: TVariables) =>
        setNotice({
          at: noticeAt(variables),
          message: error instanceof Error ? error.message : 'That did not work.'
        })
    }
  }

  const createCategoryMutation = useMutation(
    offeringsMutation(
      (name: string) => callCrm('offerings:createCategory', { name }).then(unwrapMutationResult),
      () => VIEW_NOTICE
    )
  )

  const renameCategoryMutation = useMutation(
    offeringsMutation(
      ({ id, patch }: { id: string; patch: UpdateOfferingCategoryInput }) =>
        callCrm('offerings:updateCategory', { id, patch }).then(unwrapMutationResult),
      ({ id }) => id
    )
  )

  // The one refusal an operator actually meets (registry.ts says so): a
  // category that still holds offerings. `deleteOfferingCategory` refuses
  // inside the same transaction as the DELETE and its message names the count
  // and an example, so the category is untouched and the sentence explaining
  // why reaches `onError` verbatim — rendered under that category's own head.
  const deleteCategoryMutation = useMutation(
    offeringsMutation(
      (id: string) => callCrm('offerings:deleteCategory', { id }).then(unwrapMutationResult),
      (id) => id
    )
  )

  const createOfferingMutation = useMutation(
    offeringsMutation(
      (input: CreateOfferingInput) => callCrm('offerings:create', input).then(unwrapMutationResult),
      () => VIEW_NOTICE
    )
  )

  const archiveMutation = useMutation(
    offeringsMutation(
      (id: string) => callCrm('offerings:archive', { id }).then(unwrapMutationResult),
      () => VIEW_NOTICE
    )
  )

  const duplicateMutation = useMutation(
    offeringsMutation(
      (id: string) => callCrm('offerings:duplicate', { id }).then(unwrapMutationResult),
      () => VIEW_NOTICE
    )
  )

  const offerings: readonly OfferingListItem[] = offeringsQuery.data ?? EMPTY_OFFERINGS
  const categories: readonly OfferingCategory[] = categoriesQuery.data ?? EMPTY_CATEGORIES

  const matching = useMemo(
    () =>
      offerings.filter((offering) => {
        if (typeFilter !== 'all' && offering.type !== typeFilter) return false
        if (categoryFilter !== null && offering.categoryId !== categoryFilter) return false
        return true
      }),
    [offerings, typeFilter, categoryFilter]
  )

  const live = useMemo(() => matching.filter((offering) => !isArchived(offering)), [matching])
  const archived = useMemo(() => matching.filter(isArchived), [matching])

  const blocks = useMemo(() => {
    const shown = categoryFilter === null ? categories : categories.filter((category) => category.id === categoryFilter)
    return buildBlocks(shown, live)
  }, [categories, live, categoryFilter])

  const isLoading = offeringsQuery.isPending || categoriesQuery.isPending
  const loadError = offeringsQuery.error ?? categoriesQuery.error

  function handleQuickAdd(raw: string, categoryId: string | null) {
    const parsed = parseQuickAddOffering(raw)
    if (!parsed.ok) {
      setNotice({ at: VIEW_NOTICE, message: parsed.message })
      return
    }
    createOfferingMutation.mutate({
      ...parsed.value,
      categoryId,
      // Quick-add says nothing about service vs. product, so the type comes
      // from what is on screen: whichever the filter names, or `service` when
      // it names neither. Inferring it from the category's name — the
      // mockup's own guess — would put a "product" in Products because of a
      // word rather than because anybody said so.
      type: typeFilter === 'all' ? 'service' : typeFilter
    })
  }

  const header = (
    <ViewHeader
      icon={<OfferingsGlyph />}
      accent={ACCENT}
      title="Offerings"
      description="The price list you sell from. A rate is set when an offering is created and versioned after that, so engagements keep the rate they were signed at — and nothing here is ever deleted, only archived."
      actions={
        <>
          <Toggle aria-label="Offering type" options={TYPE_FILTER_OPTIONS} value={typeFilter} onChange={setTypeFilter} />
          <Button variant="ghost" onClick={(event) => openSheet('offering', event.currentTarget)}>
            <PlusIcon />
            New offering
          </Button>
        </>
      }
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="meta">Loading offerings…</p>
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

  return (
    <div>
      {header}

      <div className="offr-filters">
        <div className="offr-cats" role="group" aria-label="Filter by category">
          <Chip selected={categoryFilter === null} onClick={() => setCategoryFilter(null)}>
            All categories
          </Chip>
          {categories.map((category) => {
            const label = category.name ?? category.id
            return (
              <Chip
                key={category.id}
                // The chip's visible text is the category's own name, which
                // can collide with something else on the page that is not a
                // category at all — the seed's "Products" category sits
                // beside the type filter's "Products" button, and two
                // controls with one accessible name is a control a screen
                // reader user cannot tell apart. The label extends the
                // visible text rather than replacing it, so WCAG 2.5.3's
                // label-in-name still holds and voice control still works
                // on the word that is actually written on it.
                aria-label={`${label} category`}
                selected={categoryFilter === category.id}
                onClick={() => setCategoryFilter(category.id)}
              >
                <CategoryDot color={category.color} />
                {label}
              </Chip>
            )
          })}
        </div>
        <Chip className="offr-archived-chip" selected={showArchived} onClick={() => setShowArchived((on) => !on)}>
          Archived
          <span className="offr-count">{archived.length}</span>
        </Chip>
      </div>

      {notice?.at === VIEW_NOTICE && (
        <div className="offr-notice" role="alert">
          {notice.message}
        </div>
      )}

      {blocks.length === 0 && archived.length === 0 ? (
        <EmptyState
          action={
            <Button variant="primary" onClick={(event) => openSheet('offering', event.currentTarget)}>
              <PlusIcon />
              Add offering
            </Button>
          }
        >
          Nothing in the catalogue yet. Add the first thing you sell.
        </EmptyState>
      ) : (
        blocks.map((block) => (
          <CategoryBlockView
            key={block.key}
            block={block}
            renaming={isRenaming(renamingId, block)}
            notice={block.categoryId != null && notice?.at === block.categoryId ? notice.message : undefined}
            onRenameStart={() => setRenamingId(block.categoryId)}
            onRenameCancel={() => setRenamingId(null)}
            onRenameCommit={(name) => {
              setRenamingId(null)
              if (block.categoryId != null) renameCategoryMutation.mutate({ id: block.categoryId, patch: { name } })
            }}
            onDelete={() => {
              if (block.categoryId != null) deleteCategoryMutation.mutate(block.categoryId)
            }}
            onQuickAdd={(raw) => handleQuickAdd(raw, block.categoryId)}
            onEdit={(id, trigger) => editSheet('offering', id, trigger)}
            onDuplicate={(id) => duplicateMutation.mutate(id)}
            onArchive={(id) => archiveMutation.mutate(id)}
          />
        ))
      )}

      {/* Creating a category is one field, so it is a QuickAdd rather than a
          fifth sheet kind — the same primitive every category block already
          ends with, and §6.5's own "create/rename/delete categories" is the
          whole of what a category has. */}
      <Card>
        <Card.Header title="Categories" count={categories.length} />
        <QuickAdd placeholder="New category — name it" onAdd={(name) => createCategoryMutation.mutate(name)} />
      </Card>

      {showArchived && (
        <div className="offr-archived">
          <div className="cathead">
            <h2 className="catname">Archived</h2>
            <span className="meta">{archived.length}</span>
          </div>
          <Card>
            {archived.length === 0 ? (
              <EmptyState>Nothing archived under this filter.</EmptyState>
            ) : (
              archived.map((offering) => <OfferingRow key={offering.id} offering={offering} />)
            )}
          </Card>
          <p className="meta offr-foot">Archived offerings stay attached to every engagement already sold at their rate.</p>
        </div>
      )}
    </div>
  )
}

/** The category's stored swatch as a dot. Decorative — the name is right beside it — and absent entirely when no colour is set, rather than drawn in some invented default. */
function CategoryDot({ color }: { color: string | null }) {
  if (color == null) return null
  // Operator data, not a design token: the value comes from the
  // `offering_categories.color` column, which is why it is a runtime style
  // rather than a class (see stub-crm.ts's note on the same column).
  const style: CSSProperties = { background: color }
  return <span className="catdot" style={style} aria-hidden="true" />
}

function CategoryBlockView({
  block,
  renaming,
  notice,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
  onDelete,
  onQuickAdd,
  onEdit,
  onDuplicate,
  onArchive
}: {
  block: CategoryBlock
  renaming: boolean
  notice: string | undefined
  onRenameStart: () => void
  onRenameCancel: () => void
  onRenameCommit: (name: string) => void
  onDelete: () => void
  onQuickAdd: (raw: string) => void
  onEdit: (id: string, trigger: HTMLElement | null) => void
  onDuplicate: (id: string) => void
  onArchive: (id: string) => void
}) {
  const isCategory = block.categoryId != null
  return (
    <div className="catblock">
      <div className="cathead">
        <CategoryDot color={block.color} />
        {renaming ? (
          <CategoryRenameInput label={block.label} onCommit={onRenameCommit} onCancel={onRenameCancel} />
        ) : (
          /* A real heading, not a styled span: each block *is* a section of
             the page, and it is what makes a category addressable by name —
             the filter chip above carries the same words, so without a role
             to tell them apart there is no way to say "the Audits block"
             rather than "one of the two things reading Audits". */
          <h2 className="catname">{block.label}</h2>
        )}
        <span className="meta">{block.offerings.length}</span>
        {isCategory && !renaming && (
          <span className="catacts">
            <IconButton aria-label={`Rename "${block.label}"`} onClick={onRenameStart}>
              <PencilIcon />
            </IconButton>
            <IconButton aria-label={`Delete "${block.label}"`} onClick={onDelete}>
              <TrashIcon />
            </IconButton>
          </span>
        )}
      </div>
      {notice && (
        <div className="offr-notice" role="alert">
          {notice}
        </div>
      )}
      <Card>
        {block.offerings.length === 0 ? (
          <EmptyState>Nothing in this category yet.</EmptyState>
        ) : (
          block.offerings.map((offering) => (
            <OfferingRow
              key={offering.id}
              offering={offering}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onArchive={onArchive}
            />
          ))
        )}
        <QuickAdd placeholder={`Add to ${block.label} — name, then price`} onAdd={onQuickAdd} />
      </Card>
    </div>
  )
}

/**
 * Rename in place. Mounted only while renaming, so its `useState` initialiser
 * seeds from the current name on every open without an effect resetting it —
 * the same "fresh mount, never a reset effect" rule `LayerManager` states for
 * the sheets.
 *
 * Escape cancels. It does not collide with the layer stack's own Escape
 * handler: that one closes the topmost *layer*, and no layer is open while a
 * rename is in progress — a sheet opening would unmount nothing here, but a
 * rename is not reachable from inside one.
 */
function CategoryRenameInput({
  label,
  onCommit,
  onCancel
}: {
  label: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(label)
  // T-260901-25: Enter and Escape both unmount this input, and the blur
  // that unmounting fires used to reach `commit` — Escape after typing
  // renamed the category, and Enter renamed it twice. First outcome wins.
  const settled = useRef(false)

  const commit = () => {
    if (settled.current) return
    settled.current = true
    const trimmed = value.trim()
    // An empty or unchanged name is a cancel, not a write: `name` is
    // `.min(1)` on the wire, so an empty one would be a ValidationError with
    // nothing useful to say about a rename the user had already abandoned.
    if (!trimmed || trimmed === label) onCancel()
    else onCommit(trimmed)
  }

  const cancel = () => {
    if (settled.current) return
    settled.current = true
    onCancel()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  return (
    <input
      className="catname-inp"
      autoFocus
      aria-label={`Rename "${label}"`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
    />
  )
}

/**
 * `.srow` from the mockup. Its actions are omitted entirely when the row is
 * archived (the `on*` props are absent): the repository has no un-archive and
 * no delete, so every control a live row carries would either be a lie or a
 * second archive of something already archived.
 *
 * The mockup's fourth action — "Change price" — is not here in either state.
 * See this file's header: that action needs P3-02's versioning behind it, and
 * `OfferingSheet`'s edit mode is where the disabled control and its caption
 * live, once rather than on every row.
 */
function OfferingRow({
  offering,
  onEdit,
  onDuplicate,
  onArchive
}: {
  offering: OfferingListItem
  onEdit?: (id: string, trigger: HTMLElement | null) => void
  onDuplicate?: (id: string) => void
  onArchive?: (id: string) => void
}) {
  const current = offering.currentVersion
  const archived = isArchived(offering)
  return (
    <div className="srow">
      <span className="grow offr-id">
        <span className="snm">
          {offering.name}
          {offering.type === 'product' && <Tag variant="lapis">product</Tag>}
          {offering.billingModel != null && <Tag>{BILLING_MODEL_LABEL[offering.billingModel]}</Tag>}
          {archived && <Tag variant="orange">archived</Tag>}
        </span>
        <span className="sblurb">{offering.blurb ?? '—'}</span>
      </span>
      <span className="sprice">
        {/* A rate that is genuinely absent reads as absent. `createOffering`
            cannot produce this, but a database seeded or imported by
            something else can (electron/shared/offerings.ts on
            `currentVersion: null`), and a `$0.00` would be a price claim. */}
        {current?.rateCents == null ? '—' : formatRate(offering.unit, current.rateCents)}
        <span className="meta offr-ver">
          {current?.version == null ? 'no version' : `v${current.version}`}
          {current?.effectiveFrom != null && ` · since ${current.effectiveFrom.slice(0, 7)}`}
        </span>
      </span>
      {onEdit && onDuplicate && onArchive && (
        <span className="sacts">
          <IconButton aria-label={`Edit "${offering.name}"`} onClick={(event) => onEdit(offering.id, event.currentTarget)}>
            <PencilIcon />
          </IconButton>
          <IconButton aria-label={`Duplicate "${offering.name}"`} onClick={() => onDuplicate(offering.id)}>
            <DuplicateIcon />
          </IconButton>
          <IconButton aria-label={`Archive "${offering.name}"`} onClick={() => onArchive(offering.id)}>
            <ArchiveIcon />
          </IconButton>
        </span>
      )}
    </div>
  )
}
