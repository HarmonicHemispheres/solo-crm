import { BRANDING_CONTENT_TYPES } from '../../../shared/branding'

/**
 * Walks a value an image channel answered with and returns every string in it
 * that looks like a filesystem path.
 *
 * This exists because of one acceptance criterion in T-260829-05: no response
 * from any of the three branding channels may contain a filesystem path,
 * "asserted in a test over the returned object, not by inspection". Reading
 * the diff and concluding the path is not returned proves nothing about the
 * branch nobody looked at, or about the field somebody adds next month — so
 * the check walks the whole object, every branch, every depth. T-260901-12's
 * four `companyImages:*` channels carry the same criterion and run the same
 * walker — extended, not re-implemented — over every success and every
 * refusal message.
 *
 * Exactly two kinds of string carry a `/` legitimately, and both are closed
 * sets rather than judgement calls:
 *
 * - a `data:image/…;base64,…` URL, whose base64 alphabet includes `/`. It is
 *   matched against a strict pattern rather than a `startsWith`, so a `data:`
 *   prefix cannot be used to smuggle a path past this check.
 * - a content type, compared by exact membership of `BRANDING_CONTENT_TYPES`
 *   — of which `COMPANY_IMAGE_CONTENT_TYPES` is a declared subset, so a
 *   company image's content type is covered by the same membership test.
 *
 * Every other `/` or `\` is reported, with the path through the object at
 * which it was found.
 *
 * Test-support only. Nothing outside a `*.test.ts` file imports it.
 */
const DATA_IMAGE_URL = /^data:image\/[a-z.+-]+;base64,[A-Za-z0-9+/=]*$/

export function pathLikeStrings(value: unknown, trail: string[] = []): string[] {
  if (typeof value === 'string') {
    if (DATA_IMAGE_URL.test(value)) return []
    if ((BRANDING_CONTENT_TYPES as readonly string[]).includes(value)) return []
    return value.includes('/') || value.includes('\\') ? [`${trail.join('.') || '<root>'}: ${value}`] : []
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => pathLikeStrings(item, [...trail, String(index)]))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => pathLikeStrings(item, [...trail, key]))
  }
  return []
}
