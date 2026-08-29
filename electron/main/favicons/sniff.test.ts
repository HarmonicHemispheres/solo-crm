import { describe, expect, it } from 'vitest'
import { FAVICON_CONTENT_TYPES } from '../../shared/favicons'
import { sniffImageContentType } from './sniff'

/** A signature followed by filler, long enough to clear the 12-byte minimum. */
function withSignature(...signature: number[]): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set(signature, 0)
  return bytes
}

const CASES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ['image/x-icon', withSignature(0x00, 0x00, 0x01, 0x00)],
  ['image/png', withSignature(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
  ['image/gif', withSignature(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
  ['image/jpeg', withSignature(0xff, 0xd8, 0xff, 0xe0)],
  ['image/bmp', withSignature(0x42, 0x4d)]
]

describe('sniffImageContentType: the format is read from the bytes, never from a header', () => {
  for (const [expected, bytes] of CASES) {
    it(`identifies ${expected} from its magic number`, () => {
      expect(sniffImageContentType(bytes)).toBe(expected)
    })
  }

  it('identifies image/webp only when the RIFF container names WEBP', () => {
    const webp = withSignature(0x52, 0x49, 0x46, 0x46)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffImageContentType(webp)).toBe('image/webp')

    // Same RIFF header, a WAVE payload — a RIFF prefix alone must not pass.
    const wave = withSignature(0x52, 0x49, 0x46, 0x46)
    wave.set([0x57, 0x41, 0x56, 0x45], 8)
    expect(sniffImageContentType(wave)).toBeNull()
  })

  it('every type it can return is on the wire contract`s allowlist', () => {
    for (const [expected] of CASES) {
      expect(FAVICON_CONTENT_TYPES).toContain(expected)
    }
  })

  it('refuses SVG — a scriptable document format is deliberately not on the allowlist', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')
    expect(sniffImageContentType(svg)).toBeNull()
    expect(FAVICON_CONTENT_TYPES as readonly string[]).not.toContain('image/svg+xml')
  })

  it('refuses HTML served where an icon was asked for', () => {
    const html = new TextEncoder().encode('<!doctype html><html><head><title>Not an icon</title></head></html>')
    expect(sniffImageContentType(html)).toBeNull()
  })

  it('refuses a body too short to carry any signature, including two zero bytes that would prefix an ICO', () => {
    expect(sniffImageContentType(new Uint8Array([0x00, 0x00]))).toBeNull()
    expect(sniffImageContentType(new Uint8Array(0))).toBeNull()
  })
})
