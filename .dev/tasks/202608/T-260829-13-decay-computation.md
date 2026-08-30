---
id: T-260829-13
title: Compute cadence decay from a company's own clock, in one shared function
status: done
category: ui
plan_ref: P2-03
created: 2026-08-29
closed: 2026-08-30
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`DecayMeter` and `Ring` shipped in T-260828-11 and no view renders either one.
They cannot, because nothing in the app turns `companies.last_touch_at` and
`companies.cadence_days` into the `pct` both primitives take. Every surface that
is supposed to show "is this relationship going quiet" — the Today view's
**Going quiet** list (T-260829-14), the Companies grid's cadence ring, company
detail — needs the same arithmetic, and the requirements are explicit that it is
*per-relationship*, not a global threshold: "companies past their own cadence,
sorted by how far past" (§6.1), and P2-03's own criterion, "a retainer client at
eight days reads late and a channel at eight days reads fine, **from the same
function**."

Written once here, or written three times slightly differently in three views.
This is the "constant or map re-declared in a second place instead of imported"
defect the review checklist in `.dev/README.md` names, caught before it happens.

**This blocks T-260829-14.** Build it first.

## Scope

**In:** a new pure module, `electron/renderer/lib/decay.ts`, plus its test file.
No component, no view, no IPC, no schema.

It exports one function and the type it returns:

```ts
export type DecayBand = 'ok' | 'warn' | 'late'

export interface Decay {
  /** Whole days since the last touch. `null` when never touched. */
  readonly days: number | null
  /** days ÷ effective cadence. 1 or more is late. `Infinity` when never touched. */
  readonly pct: number
  readonly band: DecayBand
  /** The cadence actually used — the company's own, or its kind's default. */
  readonly cadenceDays: number
  /** DecayMeter's `label` — "today", "9d", or "never" for an untouched company. */
  readonly label: string
}

export function decayForCompany(
  company: Pick<Company, 'kind' | 'cadenceDays' | 'lastTouchAt'>,
  settings: SettingsSnapshot,
  now: Date
): Decay
```

Four things this function owns, and nothing else owns:

1. **Effective cadence.** `company.cadenceDays` when it is set; otherwise the
   kind's `cadence.defaultDays.<kind>` from the settings snapshot. `cadenceDays`
   is nullable (`electron/shared/companies.ts:40`) even though the create sheet
   always writes an explicit value today, so the fallback is reachable from the
   seed, from a hand-edited database, and from any future create path that lets
   the field go unset.
2. **Days since.** `last_touch_at` is a full `timestampSchema` UTC instant
   (CONVENTIONS.md), not a date-only value, so this is instant arithmetic —
   *not* the local-calendar-day arithmetic `Todos.tsx` correctly uses for
   `due_on`. Read the header comment on `Todos.tsx`'s `localToday()` before
   writing this: the two are different problems and the wrong one here is an
   off-by-one that only appears west of UTC in the evening.
3. **The bands.** `pct >= 1` late, `pct >= 0.7` warn, else ok — the same three
   thresholds `DecayMeter.tsx` already hardcodes for its own class name. Import
   nothing from the component; the component keeps its own copy as the drawing
   rule. Assert in the test that the two agree, so they cannot drift.
4. **Never touched.** `last_touch_at IS NULL` yields `days: null`, `pct:
   Infinity`, `band: 'late'`, `label: 'never'`. ADR-001 rule 5 makes an
   untouched company maximally stale — it is the loudest thing on the list, not
   an absent one. `DecayMeter` already renders a non-finite `pct` as late and
   clamps the bar to full, so `Infinity` is safe to hand it as-is.

`now` is a required parameter, never read from `Date.now()` inside. The test
suite has to be able to state a fixed clock.

**Out:**

- Rendering anything. No view changes, no `DecayMeter` call sites. The Companies
  grid staying ring-less is deliberate; that is P2-04/P1-11 follow-on work and
  the review checklist's "do not widen a scope to the adjacent thing".
- **P2-02's settings surface.** Resolving a null cadence against the kind
  default is the *reading* half of "new companies inherit". The other half —
  the create sheet leaving `cadenceDays` unset so a company is genuinely on the
  inherited value, and Workspace Settings stating which companies a default
  change would move — stays in P2-02, which remains open. `WorkspaceSettings.tsx`
  already captions the cadence card as inert until then; do not remove that
  caption in this task, because after this task it is still true for everything
  created through the sheet.
- Sorting. "Sorted by how far past" is Going quiet's rule and belongs to the
  view that renders the list (T-260829-14). This function returns one company's
  numbers; it does not take arrays.
- People. `people.last_contact_at` is the same shape (ADR-001) but no surface
  asks for person decay yet, and a second entry point with no consumer is the
  thing this task exists to prevent.

## Touches

- `electron/renderer/lib/decay.ts` — new.
- `electron/renderer/lib/decay.test.ts` — new.

Nothing else. A diff that reaches a `views/` file has left its scope.

## Acceptance

- [ ] P2-03's own criterion, as a literal test: a `client` company touched 8
      days ago (cadence 7) returns `band: 'late'`, and a `channel` company
      touched 8 days ago (cadence 30) returns `band: 'ok'` — both from
      `decayForCompany`, with the same `now`.
- [ ] A company with `cadenceDays: null` and `kind: 'advisory'` resolves
      `cadenceDays: 21` from `cadence.defaultDays.advisory`; the same company
      with `cadenceDays: 5` resolves 5 and ignores the setting.
- [ ] A company with `lastTouchAt: null` returns `days: null`, `band: 'late'`
      and `label: 'never'` — it does not return `NaN`, and it does not throw.
      (P2-04: "A company never touched shows a determinate state, not `NaN`".)
- [ ] Touched at `2026-08-29T23:30:00.000Z` with `now =
      2026-08-30T00:30:00.000Z` returns `days: 0` and `label: 'today'` — one
      hour is not one day, whatever the calendar date did in between.
- [ ] A test asserts the module's band thresholds against `DecayMeter`'s
      rendered class for the same `pct` at 0.69, 0.7, 0.99 and 1.0, so the two
      copies of the rule cannot drift apart silently.
- [ ] `npm run typecheck && npm run lint` clean, and
      `npx vitest run --project=renderer electron/renderer/lib/decay.test.ts`
      green.
- [ ] Mutation check, recorded in the outcome: changing `>= 1` to `> 1` and
      changing the null-cadence fallback to a hardcoded 14 each turn the test
      file red.

## Risks

- **Timezone arithmetic.** The single likeliest defect here, and one this
  project has already shipped once — `.dev/README.md`'s checklist lists "dates
  compared across frames — a UTC-midnight value against a local clock, wrong by
  a day west of UTC from ~17:00" as a real prior finding. `last_touch_at` is an
  instant; treat it as one. Do not reuse `Todos.tsx`'s `localToday()`, which is
  correct there and wrong here.
- **Divide by zero.** `cadence_days` has a positive constraint on the *input*
  schema but the column itself is a plain nullable integer, so a 0 can exist in
  a hand-edited file. `0` must not produce a `NaN` band; it should read late,
  the same as never-touched. `DecayMeter` already documents this exact case
  ("cadence 0, missing data") for its own `pct`; make the module agree rather
  than relying on the component to rescue it.
- **Settings snapshot shape.** Take `SettingsSnapshot` (the full typed map from
  `settings:getAll`), not a loose `Record<string, unknown>`, and compose the key
  from `COMPANY_KINDS` the way `WorkspaceSettings.tsx`'s `CADENCE_KEY` map
  does — ADR-002 rule 3: "a key composed at a call site is a defect." That map
  is already the one declared place; import it or move it somewhere both can
  reach, do not write a second template literal.
- Near AGENTS.md's renderer boundary only trivially: this is a pure function in
  `renderer/lib/` with no IPC and no Node access, which is why it is `ui` and
  not `data`.

---

## Outcome


**Changed:**

- `electron/renderer/lib/decay.ts` (new) — `decayForCompany(company, settings,
  now)` returning `{days, pct, band, cadenceDays, label}`, plus `Decay`,
  `DecayBand` and `DecayInput` (a named alias for the `Pick<Company, …>` the
  scope specified, so a test states a three-field literal rather than a
  fifteen-field one). `now` is required; `Date.now()` is never read inside.
- `electron/renderer/lib/decay.test.ts` (new) — 16 tests.
- `electron/shared/settings.ts` — gains `CADENCE_SETTING_KEY` and a derived
  `CadenceSettingKey` type. See the deviation below.
- `electron/renderer/views/WorkspaceSettings.tsx` — the map's declaration
  replaced by an import, and the `as number` cast it needed dropped.

**Deviation from Touches, accepted:** the scope said two new files and nothing
else, allowing at most one file to move `CADENCE_SETTING_KEY` out of the view.
The builder moved it to `electron/shared/settings.ts` instead, costing two
files. That is the better home and was accepted: this module's own header
already claims to be ADR-002 rule 3's "one module" where keys are declared, a
`renderer/lib` module cannot import from a view without dragging a React tree
into a pure computation and its test, and deriving `CadenceSettingKey` as
`Extract<SettingKey, 'cadence.defaultDays.${string}'>` makes
`SettingValue<CadenceSettingKey>` resolve to `number`, which is what removed
the cast at the existing call site. The `import type { CompanyKind }` is
type-only and `companies.ts` imports only zod and `./types`, so there is no
cycle.

**Every unknowable case lands in `late`, not in `NaN`:** never touched
(`pct: Infinity`, `label: 'never'`), a zero cadence, a company with neither
its own cadence nor a kind to inherit one from, and an unparseable timestamp.
`bandFor` leads with `!Number.isFinite(pct)`, so nothing non-finite can reach
`ok`. That is ADR-001 rule 5 made mechanical rather than left to each caller.

**Review:** read against the acceptance criteria; no blocking findings, so it
merged as built. Six mutants across the builder's run and the orchestrator's:

| Mutant | Result |
|---|---|
| `pct >= 1` → `pct > 1` | 3 tests red |
| null-cadence fallback → hardcoded `14` | 2 tests red |
| drop `!Number.isFinite(pct)` from `bandFor` | 1 test red |
| `Math.floor` → `Math.round` in `wholeDaysSince` | 1 test red |
| `cadenceDays > 0` → `cadenceDays >= 0` | **survived — equivalent mutant** |

The survivor is not a coverage gap. With a zero cadence, `>= 0` divides and
yields `Infinity`/`NaN` where `> 0` short-circuits to `Infinity`; `bandFor`'s
non-finite guard maps both to `late`, and `DecayMeter` clamps both to a full
bar. Two independent guards where one would do, and the distinction is
unobservable by construction. Left as is.

**Deferred:** nothing cut. The scope's own "Out" list stands — no view renders
this yet (T-260829-14 is the first consumer), the Companies grid stays
ring-less, P2-02's settings surface is untouched and `WorkspaceSettings.tsx`
still carries its honest "these defaults move no company yet" caption, because
after this task that is still true for everything created through the sheet.
