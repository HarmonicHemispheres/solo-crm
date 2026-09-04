import { useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FAVICON_FALLBACK_ICONS } from '../../../shared/favicons'
import type { Link, LinkEntityType, LinkKind } from '../../../shared/links'
import { IpcCallError, ipcMutationFn, ipcQueryFn, unwrapMutationResult } from '../../lib/ipc'
import { invalidate, queryKeys } from '../../lib/query-keys'
import { Card } from '../primitives/Card'
import { Section } from '../primitives/Section'
import { EmptyState } from '../primitives/EmptyState'
import { IconButton } from '../primitives/IconButton'
import { hostOf, normaliseLinkInput } from './link-input'
import './LinksCard.css'

/**
 * §6.10's link rows (T-260828-50), ported from the mockup's `.lrow` markup
 * (planning/solo-crm-mockup.html line ~1596) rather than invented.
 *
 * Three commitments this file exists to keep, all three of them things that
 * are silently wrong rather than loudly broken if they slip:
 *
 * **1. The row's geometry never depends on whether a favicon arrived.**
 * `LinkFavicon` below always renders the same fixed-size box; only what sits
 * *inside* it changes. A company with twelve links draws once, at its final
 * dimensions, whether the icons are cached, absent or being fetched right
 * now (this task's Risks: "Layout shift as favicons resolve").
 *
 * **2. The renderer never fetches.** The only favicon call here is a *read*
 * of what main already has (`favicons:get`), which answers immediately and
 * definitely — a `data:` URL or a named absence, never something to wait on
 * (`electron/shared/favicons.ts`'s header). Whether a network request
 * happens, and when, is main's decision and is invisible from here.
 *
 * **3. Opening a link never navigates the renderer.** Each title is an
 * `<a target="_blank">`, which Chromium routes to
 * `setWindowOpenHandler` — `electron/main/security.ts`'s
 * `registerNavigationGuards` denies the window and hands the URL to
 * `shell.openExternal`. A same-tab `<a href>` would be caught by the
 * `will-navigate` half of the same guard, but "caught by the guard" and
 * "goes through the intended path" are different things, and only the second
 * one keeps working when the guard is the thing under test.
 */

/** The mockup's own `KIND_LABEL` table (line ~763). Keyed by `LinkKind`, so a kind added to `electron/shared/links.ts` without a label here fails `tsc`. */
const KIND_LABEL: Record<LinkKind, string> = {
  drive: 'Drive',
  notion: 'Notion',
  github: 'GitHub',
  figma: 'Figma',
  stripe: 'Stripe',
  pdf: 'PDF',
  slack: 'Slack',
  web: 'Link'
}

/**
 * The favicon box's size, in one place and applied as an *inline* style on
 * the box element rather than left to the stylesheet.
 *
 * Not a style preference: this is the layout-shift guarantee, written where
 * it can be asserted. `LinksCard.test.tsx` compares the box element between
 * a row whose icon is cached and a row whose icon is absent and requires the
 * two to be byte-identical, which a class name alone would satisfy while the
 * rule behind it did anything at all — the same failure mode T-260828-53
 * found in the focus-ring test it replaced.
 */
const FAVICON_BOX_PX = 20
const FAVICON_BOX_STYLE: CSSProperties = { width: FAVICON_BOX_PX, height: FAVICON_BOX_PX }

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9.5 7V5h5v2" />
      <path d="M6.5 7 7.5 20h9L17.5 7" />
    </svg>
  )
}

function ChainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M9.5 14.5 14.5 9.5M8 12H6a3 3 0 0 1 0-6h2M16 12h2a3 3 0 0 0 0-6h-2" />
    </svg>
  )
}

/**
 * The favicon slot. One `favicons:get` read per row, keyed by the link's own
 * URL and never refetched on its own (`staleTime: Infinity`): the answer is a
 * fact about main's cache at read time, and re-asking on every window focus
 * would be twelve extra IPC round trips for a page that has already drawn.
 *
 * The fallback is `FAVICON_FALLBACK_ICONS[kind]` — an SVG string compiled
 * into the bundle, so it is present with no network, no cache and no
 * filesystem read. It is injected as markup because that is the form the
 * shared module publishes it in; the strings are our own constants, keyed by
 * a closed union, and never carry anything a link's host supplied.
 */
function LinkFavicon({ url, kind }: { url: string; kind: LinkKind }) {
  const faviconQuery = useQuery({
    queryKey: queryKeys.favicons.forUrl(url),
    queryFn: ipcQueryFn('favicons:get', { url }),
    staleTime: Number.POSITIVE_INFINITY
  })
  const result = faviconQuery.data
  const cached = result != null && result.state === 'ready' ? result : null

  return (
    <span className="favi" style={FAVICON_BOX_STYLE} data-favicon={cached != null ? 'cached' : 'fallback'} aria-hidden="true">
      {cached != null ? (
        <img className="favi-img" src={cached.dataUrl} alt="" width={FAVICON_BOX_PX} height={FAVICON_BOX_PX} />
      ) : (
        <span className="favi-img" dangerouslySetInnerHTML={{ __html: FAVICON_FALLBACK_ICONS[kind] }} />
      )}
    </span>
  )
}

function LinkRow({
  link,
  onRename,
  onRemove
}: {
  link: Link
  onRename: (id: string, title: string) => void
  onRemove: (link: Link) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(link.title)
  /**
   * Escape unmounts the input, and an unmount can carry a blur with it. Both
   * paths would otherwise reach `commit`, so Escape sets this first and the
   * blur handler reads it: "reverts to the previous title **without saving**"
   * (this task's Acceptance) is a claim about what crosses IPC, not about
   * what the field shows afterwards.
   */
  const cancelled = useRef(false)

  const startEditing = () => {
    setDraft(link.title)
    cancelled.current = false
    setEditing(true)
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setEditing(false)
      return
    }
    setEditing(false)
    const next = draft.trim()
    // An empty title is refused by `updateLinkInputSchema` anyway; not
    // sending it keeps a stray Enter on a cleared field from surfacing as a
    // validation toast for something the user plainly meant as "never mind".
    if (next === '' || next === link.title) return
    onRename(link.id, next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelled.current = true
      setDraft(link.title)
      setEditing(false)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
  }

  return (
    <div className="lrow">
      <LinkFavicon url={link.url} kind={link.kind} />
      <span className="lrow-body">
        {editing ? (
          <input
            className="lrow-title-input"
            value={draft}
            autoFocus
            aria-label={`Title for ${link.title}`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <a className="lrow-title" href={link.url} target="_blank" rel="noopener noreferrer">
            {link.title}
          </a>
        )}
        <span className="meta lrow-meta">
          {KIND_LABEL[link.kind]} · {hostOf(link.url)}
        </span>
      </span>
      {!editing && (
        <IconButton aria-label={`Rename "${link.title}"`} onClick={startEditing}>
          <PencilIcon />
        </IconButton>
      )}
      <IconButton aria-label={`Remove "${link.title}"`} onClick={() => onRemove(link)}>
        <TrashIcon />
      </IconButton>
      <span className="arrow" aria-hidden="true">
        ↗
      </span>
    </div>
  )
}

/**
 * The paste field. `onSubmit` answers whether the value was accepted, and
 * only an accepted value clears the field — a refused paste stays on screen
 * next to the reason it was refused, rather than vanishing and leaving the
 * user to guess what happened.
 *
 * `onPaste` handles the gesture this whole feature is built around: one
 * paste, no Enter, no dialog. Enter is kept alongside it for a typed URL
 * (this task's Scope names both).
 */
function LinkPasteField({ placeholder, error, onSubmit }: { placeholder: string; error: string | null; onSubmit: (raw: string) => boolean }) {
  const [value, setValue] = useState('')

  const submit = (raw: string) => {
    if (onSubmit(raw)) setValue('')
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text')
    if (pasted.trim() === '') return
    event.preventDefault()
    setValue(pasted)
    submit(pasted)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submit(value)
  }

  return (
    <div className="linkadd">
      <div className="linkadd-field">
        <ChainIcon />
        <input
          className="linkadd-input"
          placeholder={placeholder}
          value={value}
          aria-label={placeholder}
          aria-invalid={error != null}
          onChange={(event) => setValue(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
        />
      </div>
      {error != null && (
        <p className="linkadd-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A refusal's reason, read off the structured `blocker` the envelope carries
 * (`ipc-types.ts`'s `repositoryErrorBlockerSchema`) rather than out of the
 * prose sentence — the acceptance criterion is explicit that the reason must
 * not come from parsing a message string, and `runMutation` puts the fields
 * on the wire precisely so nobody has to.
 *
 * A refusal with no blocker, and every non-refusal failure, falls back to the
 * repository's own written message: that sentence is *displayed*, never
 * *parsed*, which is a different thing.
 */
function failureMessage(error: unknown): ReactNode | null {
  if (error == null) return null
  if (error instanceof IpcCallError && error.code === 'refused' && error.blocker != null) {
    const { reason, count } = error.blocker
    const readable = reason.replace(/-/g, ' ')
    return count != null ? `Refused — ${readable} (${count} ${count === 1 ? 'record' : 'records'}).` : `Refused — ${readable}.`
  }
  return error instanceof Error ? error.message : null
}

export interface LinksCardProps {
  entityType: LinkEntityType
  entityId: string
}

export function LinksCard({ entityType, entityId }: LinksCardProps) {
  const queryClient = useQueryClient()
  const [inputError, setInputError] = useState<string | null>(null)

  const linksQuery = useQuery({
    queryKey: queryKeys.links.forEntity(entityType, entityId),
    queryFn: ipcQueryFn('links:list', { entityType, entityId }),
    enabled: entityId !== ''
  })

  // `title` is deliberately not sent: `addLink` defaults it from the URL
  // (T-260828-48), and a second copy of that rule here is a second copy that
  // can disagree with the stored row. `kind` is not sent for the same reason
  // and cannot be — it is not in the channel's request schema at all.
  const addLink = useMutation({
    mutationFn: (url: string) => ipcMutationFn('links:add')({ entityType, entityId, url }).then(unwrapMutationResult),
    onSuccess: () => invalidate.links(queryClient)
  })
  const renameLink = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      ipcMutationFn('links:update')({ id, patch: { title } }).then(unwrapMutationResult),
    onSuccess: () => invalidate.links(queryClient)
  })
  const removeLink = useMutation({
    mutationFn: (id: string) => ipcMutationFn('links:delete')({ id }).then(unwrapMutationResult),
    onSuccess: () => invalidate.links(queryClient)
  })

  const links = linksQuery.data ?? []
  const mutationError =
    failureMessage(addLink.error) ?? failureMessage(renameLink.error) ?? failureMessage(removeLink.error) ?? failureMessage(linksQuery.error)

  const submitUrl = (raw: string): boolean => {
    const result = normaliseLinkInput(raw)
    if (!result.ok) {
      setInputError(result.message)
      return false
    }
    setInputError(null)
    addLink.mutate(result.url)
    return true
  }

  // A Section, not a Card.Header: this card only ever sits in a detail
  // page's column, where every heading is lifted out above its card
  // (Section.tsx).
  return (
    <Section title="Links" count={links.length}>
      <Card>
        {links.length === 0 ? (
          <EmptyState>No links yet.</EmptyState>
        ) : (
          links.map((link) => (
            <LinkRow key={link.id} link={link} onRename={(id, title) => renameLink.mutate({ id, title })} onRemove={(target) => removeLink.mutate(target.id)} />
          ))
        )}
        <LinkPasteField placeholder="Paste a Drive, Notion, PDF or any URL" error={inputError} onSubmit={submitUrl} />
        {mutationError != null && (
          <p className="linkadd-error linkadd-error-row" role="alert">
            {mutationError}
          </p>
        )}
      </Card>
    </Section>
  )
}
