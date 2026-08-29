/**
 * `useGlobalShortcuts.ts` binds every combo against `event.metaKey ||
 * event.ctrlKey` — Cmd on macOS, Ctrl everywhere else — but
 * `package.json`'s `build.win` block builds only a Windows NSIS target, so
 * the one platform this app actually ships on has no Cmd key at all. The
 * Workspace Settings shortcut reference (T-260828-38) hardcoded the ⌘ glyph
 * regardless, which told the operator on the shipping platform to press a
 * key their keyboard does not have (review finding). This derives the
 * glyph actually in play instead.
 *
 * `navigator.userAgentData.platform` is the modern, spec-preferred read
 * (Electron's renderer is Chromium, so it's present); `navigator.platform`
 * is the fallback for the jsdom test environment, which does not implement
 * `userAgentData`. Anything that isn't recognizably a Mac reads as Ctrl —
 * matching the hook's own `metaKey || ctrlKey` bias toward the non-Mac case,
 * and correct for the only platform actually built.
 */
function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaDataPlatform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform
  const platform = uaDataPlatform ?? navigator.platform ?? ''
  return /mac/i.test(platform)
}

/** The modifier-key glyph for the current platform: `⌘` on macOS, `Ctrl` everywhere else (Windows, the only shipping target, included). */
export function modifierGlyph(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl'
}

/**
 * A bound key rendered as its platform combo — `⌘K` on macOS (the mockup's
 * own no-separator style), `Ctrl+K` elsewhere, since a bare `CtrlK` reads as
 * one unbroken word without the `+` a Windows user expects.
 */
export function formatShortcut(key: string): string {
  const glyph = modifierGlyph()
  const upper = key.toUpperCase()
  return glyph === '⌘' ? `${glyph}${upper}` : `${glyph}+${upper}`
}
