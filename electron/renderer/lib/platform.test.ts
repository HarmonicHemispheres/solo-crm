import { afterEach, describe, expect, it } from 'vitest'
import { formatShortcut, modifierGlyph } from './platform'

/**
 * `navigator.platform` is a plain getter on `Navigator.prototype` in jsdom
 * (configurable), so each test overrides it directly rather than through
 * `vi.stubGlobal('navigator', ...)` — replacing the whole `navigator`
 * object would drop every other property jsdom's `Navigator` provides that
 * this module doesn't touch but the rest of the suite might.
 */
function setPlatform(value: string | undefined) {
  Object.defineProperty(navigator, 'platform', { value, configurable: true })
}

const ORIGINAL_PLATFORM = navigator.platform

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM)
})

describe('modifierGlyph / formatShortcut', () => {
  it('reads ⌘ on a Mac platform string', () => {
    setPlatform('MacIntel')
    expect(modifierGlyph()).toBe('⌘')
    expect(formatShortcut('k')).toBe('⌘K')
  })

  it('reads Ctrl on the platform this app actually ships (Windows) — the shortcut card must not hardcode ⌘', () => {
    setPlatform('Win32')
    expect(modifierGlyph()).toBe('Ctrl')
    expect(formatShortcut('l')).toBe('Ctrl+L')
  })

  it('reads Ctrl on a Linux platform string too — only Mac gets the ⌘ glyph', () => {
    setPlatform('Linux x86_64')
    expect(modifierGlyph()).toBe('Ctrl')
  })

  it('falls back to Ctrl when navigator.platform is empty (jsdom default, no userAgentData)', () => {
    setPlatform('')
    expect(modifierGlyph()).toBe('Ctrl')
  })
})
