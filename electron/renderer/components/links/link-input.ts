import { ALLOWED_LINK_URL_SCHEMES, linkUrlSchema, tryParseLinkUrl } from '../../../shared/links'

/**
 * What the paste field does to a string before it becomes a `links:add`
 * payload — kept out of the component so it can be exercised directly, since
 * "pasting something that is not a URL is refused visibly, not silently
 * ignored" (T-260828-50's Acceptance) is a statement about this decision and
 * not about a rendered `<input>`.
 *
 * Two jobs, in this order.
 *
 * **Prefixing.** The mockup's own `addLink` does `raw.startsWith('http') ? raw
 * : 'https://' + raw`, so pasting `notion.so/roadmap` works. That check is
 * kept in spirit and not in letter: `startsWith('http')` also passes
 * `httpfoo:` and misses nothing useful, so what decides here is whether the
 * string *parses* as an `http:`/`https:` URL, which is the property the
 * caller actually cares about.
 *
 * **Refusing, out loud.** `linkUrlSchema` (`electron/shared/links.ts`) is the
 * same schema the repository and the IPC contract validate against — the
 * boundary rule this task inherits is that a `javascript:` or `file:` URL is
 * refused *at* the boundary, so this reuses that schema rather than writing a
 * second, laxer opinion in front of it. Everything it rejects comes back as a
 * sentence for the field to render; nothing is dropped on the floor.
 */
export type LinkInputResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }

/**
 * A scheme with a dot in it is almost certainly a host that the WHATWG parser
 * read as a scheme — `example.com:8080/status` parses with protocol
 * `example.com:`, because the URL grammar allows `.` in a scheme. Those get
 * the `https://` prefix like any other bare host. A dotless disallowed scheme
 * (`javascript:`, `file:`, `mailto:`) is a real scheme and is named in the
 * refusal, since telling the user *which* scheme was rejected is the
 * difference between a refusal and a shrug.
 */
function looksLikeAHostNotAScheme(protocol: string): boolean {
  return protocol.includes('.')
}

export function normaliseLinkInput(raw: string): LinkInputResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, message: 'Paste a URL to add a link.' }

  const parsed = tryParseLinkUrl(trimmed)
  let candidate = trimmed
  if (parsed == null || looksLikeAHostNotAScheme(parsed.protocol)) {
    candidate = `https://${trimmed}`
  } else if (!(ALLOWED_LINK_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return { ok: false, message: `${parsed.protocol}// links can't be added — paste an http or https URL.` }
  }

  const validated = linkUrlSchema.safeParse(candidate)
  if (!validated.success) {
    return { ok: false, message: `That doesn't look like a URL — paste an http or https address.` }
  }
  return { ok: true, url: validated.data }
}

/**
 * The host, for the row's second line. Falls back to the whole string rather
 * than to an empty span: every URL that reaches a row came through
 * `linkUrlSchema` and parses, so this branch is unreachable in practice, and
 * showing the raw value beats showing nothing if it ever is reached.
 */
export function hostOf(url: string): string {
  return tryParseLinkUrl(url)?.host ?? url
}
