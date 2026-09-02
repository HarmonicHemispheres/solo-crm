import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import type { CrmApi } from '../../../shared/ipc-types'
import { FAVICON_FALLBACK_ICONS } from '../../../shared/favicons'
import type { Link } from '../../../shared/links'
import { LinksCard } from './LinksCard'
import { normaliseLinkInput } from './link-input'
import { keyDownWithUnmountBlur } from '../../lib/test-support/unmount-blur'

const TS = '2026-08-28T00:00:00.000Z'
const COMPANY_ID = 'co-rinvii'

function makeLink(overrides: Partial<Link> & { id: string; url: string; title: string }): Link {
  return {
    entityType: 'company',
    entityId: COMPANY_ID,
    kind: 'web',
    addedAt: TS,
    createdAt: TS,
    updatedAt: TS,
    ...overrides
  }
}

const notionLink = makeLink({ id: 'lk-notion', url: 'https://www.notion.so/rinvii-hub', title: 'Rinvii — engagement hub', kind: 'notion' })
const driveLink = makeLink({ id: 'lk-drive', url: 'https://drive.google.com/drive/folders/rinvii', title: '04 Rinvii / SOWs', kind: 'drive' })

interface CrmOptions {
  /** Seeded rows. Mutations below write back into this same map, so an invalidation reads what was actually stored. */
  links?: readonly Link[]
  /** URLs main has a cached icon for. Every other URL answers `none`, which is a definite answer and not a wait. */
  cachedFavicons?: Record<string, string>
  /** Replaces `links:delete` outright — for the refusal test. */
  deleteHandler?: CrmApi['links:delete']
}

function buildCrm(options: CrmOptions = {}) {
  const links = new Map((options.links ?? []).map((link) => [link.id, link] as const))
  const cached = options.cachedFavicons ?? {}
  let nextSeq = 0

  const add = vi.fn(async (payload: { entityType: 'company' | 'person' | 'engagement'; entityId: string; url: string; title?: string }) => {
    const id = `lk-new-${++nextSeq}`
    // Mirrors `addLink`'s own derivations (electron/main/db/repositories/links.ts):
    // the kind comes from the host and the title defaults from the URL. The
    // renderer sends neither, which is the thing under test here.
    const url = new URL(payload.url)
    const kind = url.hostname.endsWith('notion.so') ? ('notion' as const) : url.hostname.endsWith('drive.google.com') ? ('drive' as const) : ('web' as const)
    const created = makeLink({
      id,
      url: url.href,
      title: payload.title ?? `${url.host}${url.pathname}`.replace(/\/$/, ''),
      kind,
      entityId: payload.entityId
    })
    links.set(id, created)
    return { ok: true as const, data: { ok: true as const, data: created } }
  })

  const update = vi.fn(async (payload: { id: string; patch: { title: string } }) => {
    const current = links.get(payload.id)
    if (!current) return { ok: true as const, data: { ok: false as const, error: { code: 'not-found' as const, message: 'not found' } } }
    const updated: Link = { ...current, title: payload.patch.title, updatedAt: TS }
    links.set(payload.id, updated)
    return { ok: true as const, data: { ok: true as const, data: updated } }
  })

  const remove = vi.fn(async (payload: { id: string }) => {
    links.delete(payload.id)
    return { ok: true as const, data: { ok: true as const, data: { id: payload.id } } }
  })

  const favicon = vi.fn(async (payload: { url: string }) => {
    const dataUrl = cached[payload.url]
    if (dataUrl == null) {
      return { ok: true as const, data: { state: 'none' as const, reason: 'unavailable' as const, retryAfter: null } }
    }
    return {
      ok: true as const,
      data: { state: 'ready' as const, contentType: 'image/png' as const, dataUrl, fetchedAt: TS }
    }
  })

  const crm = stubCrm({
    'links:list': vi.fn(async (payload) => ({
      ok: true as const,
      data: Array.from(links.values()).filter((link) => link.entityType === payload.entityType && link.entityId === payload.entityId)
    })),
    'links:add': add,
    'links:update': update,
    'links:delete': options.deleteHandler ?? remove,
    'favicons:get': favicon
  })

  return { crm, add, update, remove, favicon }
}

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assigns.
  delete window.crm
})

function renderLinks(crm: CrmApi) {
  window.crm = crm
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <LinksCard entityType="company" entityId={COMPANY_ID} />
    </QueryClientProvider>
  )
}

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function faviconBoxFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('.lrow') as HTMLElement
  return row.querySelector('.favi') as HTMLElement
}

/**
 * The fallback set's own path data for one kind, pulled out of the shared
 * constant rather than transcribed. The markup cannot be compared verbatim:
 * jsdom re-serialises `<path …/>` as `<path …></path>`, so a string equality
 * against `FAVICON_FALLBACK_ICONS[kind]` would fail on formatting while
 * saying nothing about which icon was drawn. The `d` attributes are what
 * distinguish one kind's mark from another's, which is the actual claim.
 */
function pathDataOf(markup: string): string[] {
  return [...markup.matchAll(/ d="([^"]+)"/g)].map((match) => match[1])
}

function expectFallbackIcon(box: HTMLElement, markup: string) {
  const paths = pathDataOf(markup)
  expect(paths.length).toBeGreaterThan(0)
  for (const d of paths) expect(box.innerHTML).toContain(d)
}

describe('adding a link', () => {
  it('pastes a URL straight into a row — no dialog, no kind picker, no title field', async () => {
    const { crm, add } = buildCrm()
    renderLinks(crm)
    await screen.findByText('No links yet.')

    const field = screen.getByLabelText('Paste a Drive, Notion, PDF or any URL')
    fireEvent.paste(field, { clipboardData: { getData: () => 'https://www.notion.so/rinvii-hub' } })

    await screen.findByText('www.notion.so/rinvii-hub')

    // The whole gesture was one paste: nothing was opened to confirm it, and
    // the renderer supplied neither a kind nor a title — both are the
    // repository's derivations from the URL.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0]).toEqual({ entityType: 'company', entityId: COMPANY_ID, url: 'https://www.notion.so/rinvii-hub' })

    // …and the row draws the kind the *host* implies, which is the reason the
    // renderer does not get to name it.
    const box = faviconBoxFor('www.notion.so/rinvii-hub')
    expectFallbackIcon(box, FAVICON_FALLBACK_ICONS.notion)
  })

  it('a typed URL with no scheme is added over https on Enter', async () => {
    const { crm, add } = buildCrm()
    renderLinks(crm)
    await screen.findByText('No links yet.')

    const field = screen.getByLabelText('Paste a Drive, Notion, PDF or any URL')
    fireEvent.change(field, { target: { value: 'drive.google.com/drive/folders/rinvii' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add.mock.calls[0][0].url).toBe('https://drive.google.com/drive/folders/rinvii')
  })

  it('refuses a paste that is not a URL, visibly, and keeps what was pasted on screen', async () => {
    const { crm, add } = buildCrm()
    renderLinks(crm)
    await screen.findByText('No links yet.')

    const field = screen.getByLabelText('Paste a Drive, Notion, PDF or any URL') as HTMLInputElement
    fireEvent.paste(field, { clipboardData: { getData: () => 'remember to call Dana' } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBeTruthy()
    expect(add).not.toHaveBeenCalled()
    // Not silently swallowed: the refused text is still in the field, next to
    // the reason, rather than cleared as though it had been accepted.
    expect(field.value).toBe('remember to call Dana')
  })

  it('names the scheme when refusing one the boundary does not allow', () => {
    const result = normaliseLinkInput('javascript:alert(1)')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('javascript:')
  })
})

describe('favicons', () => {
  it('renders a cached icon as an image and a missing one as the kind fallback', async () => {
    const { crm } = buildCrm({ links: [notionLink, driveLink], cachedFavicons: { [notionLink.url]: PNG } })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    await waitFor(() => expect(faviconBoxFor(notionLink.title).dataset.favicon).toBe('cached'))
    const cachedBox = faviconBoxFor(notionLink.title)
    expect((cachedBox.querySelector('img') as HTMLImageElement).src).toBe(PNG)

    const fallbackBox = faviconBoxFor(driveLink.title)
    expect(fallbackBox.dataset.favicon).toBe('fallback')
    expect(fallbackBox.querySelector('img')).toBeNull()
    expectFallbackIcon(fallbackBox, FAVICON_FALLBACK_ICONS.drive)
  })

  it('the row reserves the same box either way — the geometry does not depend on whether an icon arrived', async () => {
    const { crm } = buildCrm({ links: [notionLink, driveLink], cachedFavicons: { [notionLink.url]: PNG } })
    renderLinks(crm)
    await screen.findByText(notionLink.title)
    await waitFor(() => expect(faviconBoxFor(notionLink.title).dataset.favicon).toBe('cached'))

    const cachedBox = faviconBoxFor(notionLink.title)
    const fallbackBox = faviconBoxFor(driveLink.title)

    // The size is an inline style rather than a class, so this compares the
    // *resolved* box and not two elements that merely share a selector — a
    // class-name assertion would pass while the rule behind it did nothing.
    expect(cachedBox.getAttribute('style')).toBe('width: 20px; height: 20px;')
    expect(fallbackBox.getAttribute('style')).toBe(cachedBox.getAttribute('style'))
    // And the two branches really are different content, so the equality
    // above is a claim about reserved space rather than about identical DOM.
    expect(cachedBox.innerHTML).not.toBe(fallbackBox.innerHTML)
  })

  it('with nothing cached and no network, every row still draws — one read each, and every read is answered', async () => {
    const { crm, favicon } = buildCrm({ links: [notionLink, driveLink] })
    renderLinks(crm)
    await screen.findByText(notionLink.title)
    await screen.findByText(driveLink.title)

    await waitFor(() => expect(favicon).toHaveBeenCalledTimes(2))
    expectFallbackIcon(faviconBoxFor(notionLink.title), FAVICON_FALLBACK_ICONS.notion)
    expectFallbackIcon(faviconBoxFor(driveLink.title), FAVICON_FALLBACK_ICONS.drive)
    // Every favicon call answered `none` — nothing here waited on a fetch,
    // and nothing rendered a placeholder that would later be replaced.
    expect(screen.queryByText(/loading/i)).toBeNull()
  })
})

describe('renaming a link inline', () => {
  it('saves on Enter', async () => {
    const { crm, update } = buildCrm({ links: [notionLink] })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    fireEvent.click(screen.getByRole('button', { name: `Rename "${notionLink.title}"` }))
    const input = screen.getByLabelText(`Title for ${notionLink.title}`)
    fireEvent.change(input, { target: { value: 'Engagement hub' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await screen.findByText('Engagement hub')
    expect(update).toHaveBeenCalledWith({ id: notionLink.id, patch: { title: 'Engagement hub' } })
  })

  it('saves on blur', async () => {
    const { crm, update } = buildCrm({ links: [notionLink] })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    fireEvent.click(screen.getByRole('button', { name: `Rename "${notionLink.title}"` }))
    const input = screen.getByLabelText(`Title for ${notionLink.title}`)
    fireEvent.change(input, { target: { value: 'Hub' } })
    fireEvent.blur(input)

    await screen.findByText('Hub')
    expect(update).toHaveBeenCalledWith({ id: notionLink.id, patch: { title: 'Hub' } })
  })

  it('reverts on Escape without saving — including the blur that unmounting the field carries with it', async () => {
    const { crm, update } = buildCrm({ links: [notionLink] })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    fireEvent.click(screen.getByRole('button', { name: `Rename "${notionLink.title}"` }))
    const input = screen.getByLabelText(`Title for ${notionLink.title}`)
    fireEvent.change(input, { target: { value: 'Something else entirely' } })
    // T-260901-25: a trailing `fireEvent.blur` landed on a detached node and
    // proved nothing; this replays the blur while the input is still mounted.
    await keyDownWithUnmountBlur(input, 'Escape')

    expect(screen.getByText(notionLink.title)).toBeTruthy()
    expect(screen.queryByText('Something else entirely')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('removing a link', () => {
  it('removes it', async () => {
    const { crm, remove } = buildCrm({ links: [notionLink, driveLink] })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    fireEvent.click(screen.getByRole('button', { name: `Remove "${notionLink.title}"` }))
    await waitFor(() => expect(screen.queryByText(notionLink.title)).toBeNull())
    expect(remove).toHaveBeenCalledWith({ id: notionLink.id })
    expect(screen.getByText(driveLink.title)).toBeTruthy()
  })

  it('shows a refusal built from the structured blocker, not from the sentence', async () => {
    // The prose message and the structured reason are deliberately different
    // words. Anything the card renders that matches the blocker cannot have
    // been parsed out of the message, which is exactly the acceptance
    // criterion ("the reason comes from the structured error").
    const deleteHandler = vi.fn(async () => ({
      ok: true as const,
      data: {
        ok: false as const,
        error: {
          code: 'refused' as const,
          message: 'Cannot remove this link right now.',
          blocker: { reason: 'engagement-reference', count: 3 }
        }
      }
    }))
    const { crm } = buildCrm({ links: [notionLink], deleteHandler })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    fireEvent.click(screen.getByRole('button', { name: `Remove "${notionLink.title}"` }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('engagement reference')
    expect(alert.textContent).toContain('3 records')
    // The row is still there — a refused delete refuses.
    expect(screen.getByText(notionLink.title)).toBeTruthy()
  })
})

describe('opening a link', () => {
  it('hands the URL to the window-open path instead of navigating the renderer', async () => {
    const { crm } = buildCrm({ links: [notionLink] })
    renderLinks(crm)
    const anchor = (await screen.findByText(notionLink.title)) as HTMLAnchorElement

    // `target="_blank"` is what routes this through Chromium's window-open
    // path, which `registerNavigationGuards` (electron/main/security.ts)
    // denies before handing the URL to `shell.openExternal`. A same-tab
    // anchor would be caught by the `will-navigate` half of the same guard,
    // but this is the path the guard was built for.
    expect(anchor.tagName).toBe('A')
    expect(anchor.getAttribute('href')).toBe(notionLink.url)
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toContain('noopener')
  })
})

describe('keyboard reachability (X-06)', () => {
  it('every action is a real focusable control, not a div with a click handler', async () => {
    const { crm } = buildCrm({ links: [notionLink] })
    renderLinks(crm)
    await screen.findByText(notionLink.title)

    const row = screen.getByText(notionLink.title).closest('.lrow') as HTMLElement
    expect(within(row).getByRole('link', { name: notionLink.title })).toBeTruthy()
    expect(within(row).getByRole('button', { name: `Rename "${notionLink.title}"` })).toBeTruthy()
    expect(within(row).getByRole('button', { name: `Remove "${notionLink.title}"` })).toBeTruthy()

    const field = screen.getByLabelText('Paste a Drive, Notion, PDF or any URL')
    field.focus()
    expect(document.activeElement).toBe(field)
  })
})
