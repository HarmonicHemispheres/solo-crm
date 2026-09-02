/**
 * The two pure functions behind every identity mark in the app — the colour
 * a name gets, and the letters that stand in for it when there is no logo.
 * Both are `planning/solo-crm-mockup.html`'s own page-level helpers
 * (`hue()`/`initials()`, lines ~928-934), ported once.
 *
 * They were ported five times. `Companies.tsx` and `People.tsx` and
 * `Today.tsx` called the pair `IDENTITY_PALETTE`/`identityColor`;
 * `CompanyDetail.tsx` and `PersonDetail.tsx` called the same five colours
 * and the same character-sum `MARK_PALETTE`/`hue`. Each file's header said
 * the same thing — no shared home exists yet, and the next view can promote
 * them — and five views later none had. By then the copies had already begun
 * to move apart: the two detail pages' `initials` wrote `word[0] ?? ''`
 * where the three list views wrote `word[0]`. Nothing rendered differently
 * (`[undefined].join('')` is `''`), which is exactly why it went unnoticed —
 * the drift arrives before the bug does.
 *
 * The mark *component* is still per view, and deliberately so: Companies
 * draws a 38px square that may hold a logo, Today draws a decorative 28px
 * one, CompanyDetail draws a 50px one with an accent and an image. They
 * share a look — `styles/identity-mark.css`, also loaded once — and these
 * two functions, which is all they ever actually shared.
 *
 * Pure: no React, no IPC, no clock. A colour and a set of initials must be
 * the same for one name everywhere it appears, which is a property of the
 * name and nothing else.
 */

/**
 * The mockup's five mark colours, in its order. Token references rather than
 * literals so a palette change in `tokens.css` reaches the marks
 * (`.claude/rules/ui-design.md`: use the tokens, not the values).
 */
const MARK_PALETTE = [
  'var(--verdigris)',
  'var(--lapis)',
  'var(--verdigris-dim)',
  'var(--slate)',
  'var(--lapis-deep)'
] as const

/**
 * A stable colour for a name — the mockup's own character-sum modulo the
 * palette length. Not a hash with any distribution guarantee, and it does
 * not need one: it only has to be *stable*, so the same company is the same
 * colour on the grid, on Today and on its own page.
 */
export function identityColor(name: string): string {
  let sum = 0
  for (const char of name) sum += char.charCodeAt(0)
  return MARK_PALETTE[sum % MARK_PALETTE.length]
}

/**
 * Up to two initials, upper-cased. Non-letters become separators first, so
 * "Ben Thompson — LEGO resale" reads "BT" rather than picking up the dash,
 * and "Sand & Sage" reads "SS" rather than "SA".
 *
 * A name with no Latin letters at all yields the empty string rather than
 * throwing or rendering "undefined" — `[undefined].join('')` is `''`, and
 * the mark falls back to a coloured square, which is the right answer for a
 * name whose script this transliteration has nothing to say about.
 */
export function initials(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}
