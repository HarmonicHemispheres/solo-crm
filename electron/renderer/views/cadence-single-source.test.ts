import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One cadence computation, enforced (T-260901-27).
 *
 * Three views used to answer "how late is this company?" three ways.
 * `Today.tsx` called `lib/decay.ts`; `Companies.tsx` rounded elapsed days
 * and required the company's own `cadenceDays`; `CompanyDetail.tsx` floored
 * and did the same. On the seeded database that shipped a company reading
 * **50d** on the grid and **49d** on Today and its own detail page at the
 * same moment, and it put a company with the sheet's "Not set" cadence chip
 * in a full red bar on two pages while the third called it current.
 *
 * Rewiring the two views is the fix. This is what stops a fourth copy: the
 * seam is easy to re-open, because the arithmetic is three lines and writing
 * it inline is always locally simpler than threading the settings snapshot
 * into a view that does not otherwise need it.
 *
 * **Why a source scan and not a rendering test.** A rendering test proves
 * the three views agree *on the fixture it was given*. These views disagreed
 * for fifteen months on values no fixture happened to hit — the round/floor
 * split only shows when the elapsed time has a fractional day over .5, and
 * the kind-default split only shows for a null `cadenceDays`, which no test
 * fixture had. The property that actually matters is structural ("the
 * arithmetic exists once"), so it is asserted structurally. `decay.test.ts`
 * covers the behaviour itself, at a fixed clock, once.
 *
 * Reading source off disk from a renderer-adjacent test is this project's
 * established shape for a check jsdom cannot make — see
 * `Companies.css.test.ts`'s header for the three carve-outs it needs
 * (tsconfig.web exclude, tsconfig.node include, eslint renderer ignores),
 * which this file joins.
 */

const VIEWS_DIR = import.meta.dirname

/** Every view module — not its tests, and not the stylesheets beside it. */
function viewSources(): { name: string; source: string }[] {
  return readdirSync(VIEWS_DIR)
    .filter((name) => (name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.test.'))
    .map((name) => ({
      name,
      // Comments stripped before matching — LESSONS.md line 3, and these
      // files are unusually comment-heavy: `Companies.tsx` and
      // `CompanyDetail.tsx` both now carry paragraphs *about* the day
      // arithmetic they no longer do, which a naive scan reads as the
      // arithmetic itself.
      source: readFileSync(join(VIEWS_DIR, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
    }))
}

describe('a company’s cadence state is computed in exactly one place', () => {
  it('no view divides by cadenceDays', () => {
    // The shape of every one of the three old copies: `days / cadenceDays`.
    // `decay.ts` is the only module allowed to write it, and it is not in
    // this directory.
    const offenders = viewSources()
      .filter(({ source }) => /\/\s*(?:\w+\.)?cadenceDays/.test(source))
      .map(({ name }) => name)

    expect(
      offenders,
      `${offenders.join(', ')} divides by cadenceDays — call decayForCompany (lib/decay.ts) instead`
    ).toEqual([])
  })

  it('no view does elapsed-day arithmetic on lastTouchAt', () => {
    // The other half: a view that derives its own "days since last touch",
    // whether or not it goes on to divide. Matches a `lastTouchAt` within a
    // few lines of a division by a day-length constant — the two ways this
    // has actually been written (`DAY_MS` and the inline `86_400_000`).
    const offenders = viewSources()
      .filter(({ source }) => {
        if (!source.includes('lastTouchAt')) return false
        return /(?:DAY_MS|86_?400_?000)/.test(source) && /Math\.(?:floor|round)\s*\(\s*\(/.test(source)
      })
      .map(({ name }) => name)

    expect(
      offenders,
      `${offenders.join(', ')} appears to age lastTouchAt by hand — call decayForCompany (lib/decay.ts) instead`
    ).toEqual([])
  })

  it('the three views that show cadence all import decayForCompany', () => {
    // The positive half, and the reason the two scans above cannot pass by
    // a view simply dropping the feature: these three show a cadence state,
    // so each must be reading the shared one.
    for (const name of ['Today.tsx', 'Companies.tsx', 'CompanyDetail.tsx']) {
      const { source } = viewSources().find((view) => view.name === name)!
      expect(source, `${name} must import decayForCompany from lib/decay`).toMatch(
        /import\s*\{[^}]*\bdecayForCompany\b[^}]*\}\s*from\s*'\.\.\/lib\/decay'/
      )
    }
  })
})
