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
 * One thing is deliberately NOT verbatim: the mockup tests
 * `url.toLowerCase().includes(substring)` against the **whole URL string**,
 * so `https://evil.test/?ref=notion.so` reads as a Notion link — the exact
 * failure T-260828-48's Risks calls out ("`notion.so` appearing anywhere in
 * a URL is not the same as being its host"). Every `type: 'host'` rule here
 * is matched against `new URL(url).hostname` only; `detectLinkKind` below is
 * this map's one caller and is the only place that distinction is applied.
 *
 * The `pdf` rule is `type: 'extension'`, matched against the URL's path —
 * the mockup's own `u.endsWith('.pdf')` is already whole-URL, not
 * host-based, so no substring-vs-host fix applies to it; it is transcribed
 * unchanged, including its position between the `stripe` and `slack` rules
 * (a URL that is both a Slack host and a `.pdf` path resolves `pdf`, exactly
 * as the mockup's sequential `if`/`else if` chain would).
 */
export const LINK_KIND_RULES = [
  { kind: 'drive', type: 'host', substrings: ['drive.google', 'docs.google'] },
  { kind: 'notion', type: 'host', substrings: ['notion.'] },
  { kind: 'github', type: 'host', substrings: ['github.'] },
  { kind: 'figma', type: 'host', substrings: ['figma.'] },
  { kind: 'stripe', type: 'host', substrings: ['stripe.'] },
  { kind: 'pdf', type: 'extension', suffix: '.pdf' },
  { kind: 'slack', type: 'host', substrings: ['slack.'] }
] as const satisfies ReadonlyArray<
  | { readonly kind: LinkKind; readonly type: 'host'; readonly substrings: readonly string[] }
  | { readonly kind: LinkKind; readonly type: 'extension'; readonly suffix: string }
>

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
      if (rule.substrings.some((substring) => host.includes(substring))) return rule.kind
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

const linkUrlSchema = z
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
  url: z.string(),
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
