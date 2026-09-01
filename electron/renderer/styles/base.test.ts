import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const basePath = join(import.meta.dirname, './base.css')
const base = readFileSync(basePath, 'utf8')

/**
 * Puts base.css into the test document so the assertions below read what the
 * cascade actually produces rather than what the file says. jsdom applies
 * author stylesheets in `getComputedStyle`, so this is the real resolved
 * value for every property these tests touch.
 */
function loadBaseStylesheet(): void {
  const style = document.createElement('style')
  style.dataset.testSheet = 'base'
  style.textContent = base
  document.head.append(style)
}

/** Mounts a fragment of header markup and hands back the `<h1>` inside it. */
function renderHeading(markup: string): HTMLHeadingElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  document.body.append(host)
  const heading = host.querySelector('h1')
  if (heading === null) throw new Error(`no <h1> in ${markup}`)
  return heading
}

/** The header markup CompanyDetail and PersonDetail render, minus the content. */
const DETAIL_HEADER = '<div class="dbanner"></div><div class="dhead"><div><h1>Northwind</h1></div></div>'

afterEach(() => {
  document.querySelectorAll('[data-test-sheet="base"]').forEach((sheet) => sheet.remove())
  document.body.replaceChildren()
})

describe('base.css', () => {
  it('handles prefers-reduced-motion once, centrally: kills animation/transition everywhere', () => {
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(base).toMatch(/animation: none !important/)
    expect(base).toMatch(/transition: none !important/)
  })

  it('pins the decay meter fill to its final width instead of its 0% start state', () => {
    const reducedMotionBlock = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reducedMotionBlock).toMatch(/\.decay \.fill\s*{\s*width: var\(--w\) !important/)
  })

  it('sets a visible, token-driven focus ring globally rather than per component', () => {
    expect(base).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--verdigris\)/)
  })
})

describe('base.css: the global h1 rule', () => {
  it("gives a detail header's bare <h1> the mockup's heading type", () => {
    loadBaseStylesheet()
    const computed = getComputedStyle(renderHeading(DETAIL_HEADER))

    // planning/solo-crm-mockup.html line 35, verbatim. The margin is the half
    // that fixes the reported bug: `.dbanner`'s `margin-bottom: -40px` only
    // lifts `.dhead` into the banner if the heading adds no margin of its own.
    expect(computed.fontSize).toBe('27px')
    expect(computed.marginTop).toBe('0px')
    expect(computed.fontWeight).toBe('700')
    expect(computed.letterSpacing).toBe('-0.9px')
    expect(computed.lineHeight).toBe('1.1')
  })

  it('is the only thing supplying that type — without it the heading is the user agent default', () => {
    // Guards the test above against passing vacuously: the same markup with no
    // author stylesheet is the 32px the two detail routes were actually
    // getting, which is what made the company name overshoot its banner.
    expect(getComputedStyle(renderHeading(DETAIL_HEADER)).fontSize).toBe('32px')
  })

  it('reaches the view header too, in place of the scoped .vhead h1 rule it replaced', () => {
    // ViewHeader.css stated these same values under `.vhead h1` until this
    // rule existed; every ViewHeader-titled view must look identical after
    // that scoped copy was deleted rather than pick up a heading default.
    loadBaseStylesheet()
    const computed = getComputedStyle(renderHeading('<div class="vhead"><h1>Companies</h1></div>'))

    expect(computed.fontSize).toBe('27px')
    expect(computed.marginTop).toBe('0px')
  })
})
