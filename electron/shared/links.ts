import { z } from 'zod'
import { timestampSchema } from './types'

/**
 * `links`' wire contract (ADR-007): the domain type, the kind-detection map
 * and the create/update zod schemas, as PURE zod with no Node imports — the
 * same discipline `electron/shared/companies.ts` and every sibling module
 * follow, and for the identical reason (see that file's header comment):
 * this module is typechecked under both `tsconfig.node.json` (main +
 * preload) and `tsconfig.web.json` (renderer), so it may only use the ES2022
 * lib both share and may only import other `electron/shared/**` modules.
 *
 * SQL, `randomUUID`, row mapping (snake_case -> camelCase) and host-based
 * kind detection's call site stay in
 * `electron/main/db/repositories/links.ts`, which imports the types, the
 * kind-detection map and the schemas below rather than redeclaring any of
 * them (T-260828-48's Risks: "a seventh copy of the shared repository
 * machinery").
 *
 * `links` (T-260828-48) is the first **polymorphic** repository:
 * `entity_type`/`entity_id` with no foreign key, because a link attaches to
 * a company, a person or an engagement and no single-table FK can express
 * that (see this task's Why). `LINK_ENTITY_TYPES` below is deliberately a
 * closed union rather than a free string — the polymorphism is in which
 * table a row *points at*, not in what values `entity_type` may hold.
 *
 * This repository takes no position on what happens to a link when the
 * entity it points at is deleted — deliberately. T-260828-41 is open
 * against exactly that question (cascade vs. refuse, for all three
 * polymorphic tables at once) and owns the answer; `links.ts` implementing
 * one by accident would make this task's silence the de facto decision.
 * Today, `deleteCompany`/`deletePerson`/`deleteEngagement` do not check this
 * table at all, so a link can already point at an id that no longer
 * exists — a known, tracked gap, not a new one introduced here.
 */

/** A link attaches to one of these three entity kinds — no others exist yet. */
export const LINK_ENTITY_TYPES = ['company', 'person', 'engagement'] as const
export type LinkEntityType = (typeof LINK_ENTITY_TYPES)[number]

/** `schema.ts`'s comment on `links.kind`: "drive | notion | github | figma | stripe | pdf | slack | web". */
export const LINK_KINDS = ['drive', 'notion', 'github', 'figma', 'stripe', 'pdf', 'slack', 'web'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/**
 * Host-based kind detection, ported from `planning/solo-crm-mockup.html`'s
 * `linkKind(url)` (line ~744) — the mockup is the authoritative source for
 * which hosts map to which kind (T-260828-48's Scope), so every substring,
 * every kind and the order between rules below is transcribed from that
 * function verbatim, not re-derived.
 *
 * Two things are deliberately NOT verbatim.
 *
 * First, the mockup tests `url.toLowerCase().includes(substring)` against
 * the **whole URL string**, so `https://evil.test/?ref=notion.so` reads as a
 * Notion link — the exact failure T-260828-48's Risks calls out
 * ("`notion.so` appearing anywhere in a URL is not the same as being its
 * host"). Every `type: 'host'` rule here is matched against
 * `new URL(url).hostname` only.
 *
 * Second (T-260828-55), matching a rule as a *substring* of the host is
 * still wrong in the other direction: `mynotion.com` and `notion.evil.com`
 * both contain `notion.` and both resolved as Notion. So a host rule is now
 * a **registrable domain** — the labels immediately before the final label —
 * and `hostMatchesDomain` below matches it on label boundaries: the host
 * must be exactly `<domain>.<tld>` or `<anything>.<domain>.<tld>`. That is
 * why the entries below carry no trailing dot: `notion` matches `notion.so`
 * and `www.notion.so`, and refuses `mynotion.com`, `notion.evil.com` and
 * `notion.so.evil.com` alike.
 *
 * The single-trailing-label rule means a multi-label public suffix
 * (`example.co.uk`) is not understood; recognising those needs the Public
 * Suffix List, which is a network-fetched dataset this app deliberately does
 * not carry. None of the seven vendors below serve their product from one,
 * so the cost is a `web` kind on a host no rule was written for — the same
 * outcome as no rule at all, and never a false positive.
 *
 * The `pdf` rule is `type: 'extension'`, matched against the URL's path —
 * the mockup's own `u.endsWith('.pdf')` is already whole-URL, not
 * host-based, so no substring-vs-host fix applies to it; it is transcribed
 * unchanged, including its position between the `stripe` and `slack` rules
 * (a URL that is both a Slack host and a `.pdf` path resolves `pdf`, exactly
 * as the mockup's sequential `if`/`else if` chain would).
 */
export const LINK_KIND_RULES = [
  { kind: 'drive', type: 'host', domains: ['drive.google', 'docs.google'] },
  { kind: 'notion', type: 'host', domains: ['notion'] },
  { kind: 'github', type: 'host', domains: ['github'] },
  { kind: 'figma', type: 'host', domains: ['figma'] },
  { kind: 'stripe', type: 'host', domains: ['stripe'] },
  { kind: 'pdf', type: 'extension', suffix: '.pdf' },
  { kind: 'slack', type: 'host', domains: ['slack'] }
] as const satisfies ReadonlyArray<
  | { readonly kind: LinkKind; readonly type: 'host'; readonly domains: readonly string[] }
  | { readonly kind: LinkKind; readonly type: 'extension'; readonly suffix: string }
>

/**
 * True when `host` is `<domain>.<tld>` or `<subdomains>.<domain>.<tld>` —
 * a label-boundary match, never a substring one.
 *
 * `host` is expected already lowercased (`URL#hostname` is, for every
 * non-IP host the parser accepts); `domain` is a rule entry from
 * `LINK_KIND_RULES`, written without its final label.
 *
 * The final label is dropped before comparing so that a rule matches only in
 * the registrable-domain position: `notion.evil.com` becomes `notion.evil`,
 * which neither equals `notion` nor ends with `.notion`, and so does not
 * match — whereas `www.notion.so` becomes `www.notion`, which does.
 */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const labels = host.split('.')
  if (labels.length < 2) return false
  const withoutTld = labels.slice(0, -1).join('.')
  return withoutTld === domain || withoutTld.endsWith(`.${domain}`)
}

/**
 * Resolves a parsed URL to its `LinkKind`, walking `LINK_KIND_RULES` in
 * order and returning `'web'` when nothing matches — an unrecognised host
 * stores `web` rather than failing (T-260828-48's Scope and Acceptance).
 */
export function detectLinkKind(url: URL): LinkKind {
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()
  for (const rule of LINK_KIND_RULES) {
    if (rule.type === 'host') {
      if (rule.domains.some((domain) => hostMatchesDomain(host, domain))) return rule.kind
    } else if (path.endsWith(rule.suffix)) {
      return rule.kind
    }
  }
  return 'web'
}

/**
 * URL validation at the boundary: `http:`/`https:` only. T-260828-26's
 * security review flagged `companies.website` as carrying no scheme
 * constraint and named its two sinks (a view's `href`, the favicon fetch);
 * this table is the same shape — a user-supplied URL, eventually rendered
 * as a link and eventually fetched for a favicon (T-260828-49) — and this
 * task's Scope says it "should not repeat it". A `javascript:` or `file:`
 * URL is refused here, at the boundary, not deferred to whichever view or
 * fetch call is the actual sink.
 */
export const ALLOWED_LINK_URL_SCHEMES = ['http:', 'https:'] as const

/** `null` for a string the WHATWG URL parser rejects outright — not itself an error; `linkUrlSchema` below turns that into a `ValidationError` with a stated reason. */
export function tryParseLinkUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Exported so `linkSchema` below can reuse it: before T-260828-55 the read
 * side declared `url: z.string()`, so the scheme allowlist was a write-side
 * guarantee only and any row that reached the table by some other route —
 * a migration, a future import, a hand-edited database — crossed the IPC
 * boundary unchecked into the sinks (`href`, `shell.openExternal`, the
 * favicon fetch of T-260828-49) this schema exists to protect.
 */
export const linkUrlSchema = z
  .string()
  .min(1, 'url is required')
  .superRefine((value, ctx) => {
    const parsed = tryParseLinkUrl(value)
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'url must be a valid absolute URL' })
      return
    }
    if (!(ALLOWED_LINK_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) {
      ctx.addIssue({
        code: 'custom',
        message: `url scheme "${parsed.protocol}" is not allowed — only http: and https: are accepted`
      })
    }
  })

/** A `links` row, camelCased, as read back from the database — `links:list`'s and every mutation channel's response shape (ADR-007 rule 5). */
export const linkSchema = z.object({
  id: z.string(),
  entityType: z.enum(LINK_ENTITY_TYPES),
  entityId: z.string(),
  url: linkUrlSchema,
  title: z.string(),
  kind: z.enum(LINK_KINDS),
  addedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type Link = z.infer<typeof linkSchema>

/**
 * `listLinks`' filter — one entity, named by type and id. `.strict()` so a
 * stray key (a typo'd filter field crossing the IPC boundary someday) is a
 * `ValidationError`, not a silently-ignored no-op.
 */
export const listLinksInputSchema = z
  .object({
    entityType: z.enum(LINK_ENTITY_TYPES),
    entityId: z.string().min(1)
  })
  .strict()
export type ListLinksInput = z.infer<typeof listLinksInputSchema>

/**
 * `addLink`'s input. `kind` is deliberately absent — it is derived from
 * `url` by `detectLinkKind`, never caller-supplied (this repository's Scope:
 * "Kind detection from the host"). `title` is optional: when omitted the
 * repository defaults it from `url`, and it stays editable afterward via
 * `updateLinkInputSchema`.
 */
export const createLinkInputSchema = z
  .object({
    entityType: z.enum(LINK_ENTITY_TYPES),
    entityId: z.string().min(1, 'entityId is required'),
    url: linkUrlSchema,
    title: z.string().min(1).optional()
  })
  .strict()
export type CreateLinkInput = z.infer<typeof createLinkInputSchema>

/** `updateLink`'s input — title only (T-260828-48's Scope). Every other column, including which entity the link attaches to, is set once at create and never patched. */
export const updateLinkInputSchema = z
  .object({
    title: z.string().min(1, 'title is required')
  })
  .strict()
export type UpdateLinkInput = z.infer<typeof updateLinkInputSchema>
