---
id: T-260901-18
title: Person detail fails to load for every seeded person with a company — affiliation `started` is NULL but the wire schema requires a date
status: done
category: data
created: 2026-09-01
closed: 2026-09-01
---

## Why

Found by the first `npm run snap` pass (T-260901-17): in the built app, every
`people:get` for a seeded person with a company fails response validation
with `affiliations[0].started: Expected a YYYY-MM-DD date string`, and the
person detail page never renders. The seed inserts `started = NULL` for every
affiliation (`electron/main/db/seed/index.ts`, the `insertAffiliation.run`
call) while `electron/shared/people.ts` declares `started: dateOnlySchema`,
non-nullable. Every jsdom test passes because the renderer stub returns a
valid shape; only the real app shows it.

## Story

As the operator, I open any person from the People view and see their
detail page with their affiliation, so that the seeded workspace is usable
end to end.

## Constraints

- Decide which side is right: is an affiliation with no known start date a
  valid record (schema and repository accept `null`), or must the seed supply
  one? Check what the `affiliations.started` column allows in the migration
  and what the create sheet sends. Record the choice in the Outcome.
- CONVENTIONS.md governs the date representation either way.
- Do not paper over it in the renderer.

## Acceptance

- [x] `people:get` for every seeded person passes response validation.
- [x] A test fails if the seed and the wire schema disagree again, without
      booting Electron.
- [x] Open the app, click any person card: the detail page renders, and
      `npm run snap -- --routes person` writes `person-*.png`.

## Related

`electron/main/db/seed/index.ts`, `electron/shared/people.ts`,
`electron/main/db/repositories/people.ts`, the `affiliations` DDL in
`electron/main/db/migrations/0001_init.sql`, `PersonDetail.tsx`.

---

## Outcome

**Changed:** `electron/main/db/seed/index.ts` — every seeded affiliation now
starts on its company's `since` date, shifted like every other fixture date;
`electron/main/db/seed/index.test.ts` — the wire-schema block reads every
person back through `getPerson` and parses `personWithAffiliationsSchema`,
asserting at least one affiliation was parsed.

**Departed from scope:** The schema side is right and the seed was wrong:
`createAffiliationInputSchema` requires `started`, `PersonSheet` always sends
today, and `movePerson` requires an `on` date, so a stint with no known start
is not a shape the app can produce — making the column nullable would have
widened the contract for the seed's convenience. The DDL's `started text`
stays nullable at the SQLite level; no migration.

**Not verified:** Nothing. `npm run snap -- --routes people,person` wrote
`person-1440.png` with the heading "Ben Thompson" and the affiliation row
"Jun 26 → present"; the previous run's `metrics.json` had recorded
"people:get: the response was not in the expected shape" on that route.

**Elapsed:** ~20 minutes.
