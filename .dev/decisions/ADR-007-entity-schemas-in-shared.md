---
id: ADR-007
title: Entity wire schemas live in electron/shared/, not in the main-process repository
status: accepted
date: 2026-08-28
---

## Context

T-260828-20 built `electron/main/db/repositories/companies.ts` and put
`Company`, `COMPANY_KINDS` and the create/update zod schemas there, alongside
the SQL. That module also imports `randomUUID` from `node:crypto` and
`better-sqlite3`'s `Database` type — Node-only, main-process-only.

`electron/shared/ipc-types.ts` is typechecked under both `tsconfig.node.json`
(main + preload) and `tsconfig.web.json` (renderer), and both are
`composite: true` projects. That file's own header comment records what this
means in practice: a type-only import reaching outside a composite project's
`include` list fails `tsc` with TS6307 ("Projects must list all files or use
an 'include' pattern"), even though the import would be fully erased at build
time. `electron/main/db/repositories/**` sits outside `tsconfig.web.json`'s
`include`, so `electron/shared/**` can never import from it — the dependency
can only point the other way.

T-260828-26 (the IPC channel registry) needs `Company` and the create/update
schemas to declare `CHANNEL_CONTRACTS` entries the same way `db:schemaVersion`
already does in `ipc-types.ts`: request schema, response schema, both zod.
With the schemas living in `companies.ts`, T-260828-26 has two ways forward,
both bad. Import from the main-process module directly — impossible, per the
paragraph above, the moment a renderer-side consumer (a form's client-side
validation, eventually) needs the same schema. Or redefine the fourteen
fields a second time in `ipc-types.ts` — legal, but then a repository change
(a new column, a tightened validator) has to be applied twice by hand, and the
two copies are free to drift the moment someone forgets. T-260828-20's review
caught this before five more repositories (people, engagements, tasks,
activity, affiliations) copied the same shape.

## Decision

Each entity gets a wire-schema module: `electron/shared/<entity>.ts` — the
first is `electron/shared/companies.ts`. It holds:

- The domain type as read back from the database (`Company`).
- Any enum/union the entity's columns are drawn from (`COMPANY_KINDS`).
- The create and update zod input schemas (`createCompanyInputSchema`,
  `updateCompanyInputSchema`), composed from `electron/shared/types.ts`'s
  primitives (`dateOnlySchema`, `timestampSchema`, `centsSchema`) exactly as
  CONVENTIONS.md requires everywhere else — never a hand-rolled date or money
  check local to the entity module.

The rules that go with it, matching the discipline `types.ts` and
`ipc-types.ts` already follow:

1. **No Node or DOM imports.** `electron/shared/<entity>.ts` may import only
   the ES2022 lib and other `electron/shared/**` modules — the intersection
   both `tsconfig.node.json` and `tsconfig.web.json` typecheck against.
2. **Pure zod plus plain TypeScript types.** No `better-sqlite3`, no
   `drizzle-orm`, no `node:crypto`. The module describes a value crossing a
   boundary, not how it is stored or generated.
3. **SQL, `randomUUID`, row mapping (snake_case → camelCase) and constraint
   translation stay in `electron/main/db/repositories/<entity>.ts`.** That
   module imports its types and schemas from `electron/shared/<entity>.ts`
   rather than redeclaring them, and may re-export what its own call sites
   already use so existing imports of the repository module keep working.
4. **A column the repository does not expose for writing is absent from the
   schema, not present-but-ignored.** `Company.lastTouchAt` is read from
   every row but has no place in `createCompanyInputSchema` or
   `updateCompanyInputSchema` — ADR-001 assigns that column to the activity
   repository. An absent field fails fast (`.strict()`, ADR-007's own schema
   uses it) instead of silently accepting and dropping a value a caller
   thought it was setting.
5. **T-260828-26's `CHANNEL_CONTRACTS` entries import the entity's schemas
   from `electron/shared/<entity>.ts` directly** — a channel's request schema
   for `companies:create` is `createCompanyInputSchema`, not a redeclaration
   of it. This is the payoff rule; 1–4 exist to make it possible.

## Consequences

**Easier.** T-260828-26 declares each entity's IPC channels by importing an
existing schema, the same shape `db:schemaVersion` already established for a
non-entity response. No field list is ever typed twice.

**Easier.** A future renderer-side form can import the same
`createCompanyInputSchema` for client-side validation before a round trip,
because nothing about it is main-process-only. Nothing today asks for this,
but nothing has to be restructured to get it.

**Easier — the next five repositories have a template.** `people.ts`,
`engagements.ts`, `tasks.ts`, `activity.ts` and `affiliations.ts` each get a
sibling `electron/shared/<entity>.ts` built the same way, rather than each
task re-deciding where its schema lives.

**Harder — two files per entity instead of one.** A column rename touches
`electron/shared/<entity>.ts` (the field) and
`electron/main/db/repositories/<entity>.ts` (the column mapping in
`FIELD_SPECS`, or equivalent). Accepted: the alternative is the schema
duplication this ADR exists to prevent, which is the more expensive version
of "touch two places."

**Cost — an import indirection in the repository module.** Every repository
now imports its own domain type and schemas rather than declaring them
in-file, one more place to look when reading a repository top to bottom.
Mitigated by each repository module re-exporting the pieces its own tests and
future callers already use, and by the header comment pointing at the split.

## Alternatives

**Leave the schemas in each repository module and have T-260828-26 redeclare
them in `ipc-types.ts`.** Lost because it is exactly the duplication this ADR
exists to prevent — the failure mode is silent drift between the two copies
the moment a field is added or a validator tightened in one but not the
other, and nothing in the type system catches it.

**Give `electron/shared/ipc-types.ts` a type-only import of `Company` from
the main-process repository module.** Lost on the facts: T-260828-20's build
log records `tsc -p tsconfig.web.json` failing with TS6307 the moment this
was tried, because `electron/main/db/repositories/**` sits outside that
project's `include` list. Composite TypeScript projects reject a reference
outside their own file set even for a type erased at build time — there is no
narrower version of this import that survives the check.

**One `electron/shared/entities.ts` holding every entity's type and schema.**
Lost because it makes the file's size and its diff churn scale with the
number of entities in the app rather than with the one entity actually being
changed, and it invites a merge conflict between every pair of repository
tasks built in parallel (T-260828-21..25 all touch entities). A module per
entity, named for the entity, gives each task its own file.

**Move the *repository* functions (`createCompany`, `deleteCompany`, …) into
`electron/shared/` alongside the schema, since both "belong to companies."**
Lost immediately: `createCompany` calls `db.prepare(...)` and
`randomUUID()`, both Node/main-process-only. `electron/shared/**` cannot hold
either without breaking `tsconfig.web.json`'s typecheck, which is the whole
reason this split exists.
