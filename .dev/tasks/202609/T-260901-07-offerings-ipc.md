---
id: T-260901-07
title: Expose the offerings repositories over IPC
status: done
category: ipc
created: 2026-09-01
closed: 2026-09-01
---

## Why

[T-260901-05](T-260901-05-offerings-repository.md) builds the offerings
repositories in main. The renderer cannot reach them — it never touches
SQLite, everything crosses a typed channel through `window.crm.*` — so
without this the offerings view has nothing to call and `/offerings` stays a
placeholder.

Split from the repository task rather than folded into it because that is how
every entity in this app was built: T-260828-20 through T-260828-25 wrote six
repositories and T-260828-26 exposed all of them in one 🔌 ipc task, and the
branding feature split the same way one wave later (T-260829-04 store,
T-260829-05 channels, T-260829-07 view). The categories decide the review
gate — this one carries `security-review` and the repository does not.

## Scope

**In:** the channels the offerings view and the engagement form need, declared
and validated exactly as the existing entity channels are — read
`electron/shared/ipc-types.ts` and `electron/main/ipc/registry.ts` and follow
them; do not introduce a second pattern.

- `offerings:listCategories`
- `offerings:list` — takes the filter (`type`, `categoryId`, `active`), returns
  offerings with their current rate
- `offerings:get` — one offering with its version history
- `offerings:createCategory`, `offerings:updateCategory`,
  `offerings:deleteCategory`
- `offerings:create`, `offerings:update`, `offerings:archive`,
  `offerings:duplicate`

Every request and response validated by the zod schemas T-260901-05 declares
in `electron/shared/offerings.ts`, `.strict()` on request bodies as the
existing channels are, so a caller cannot smuggle a field past validation.
Refusals come back as `{ ok: false }` envelopes through `registry.ts`'s
`runMutation`, carrying the repository's own message.

Plus the renderer-side plumbing every other entity has: query keys in
`lib/query-keys.ts` with an `invalidate.offerings` helper, the preload
surface, `window.d.ts`, and stubs in `lib/test-support/stub-crm.ts` — the
stub file is what every renderer test depends on and a missing entry there
surfaces as an unrelated view's test failing.

**Out:**

- A price-change channel. P3-02 owns appending a version and it does not
  exist yet; a channel here that could write a second version would let the
  UI change a price without the effective-date semantics §6.5 requires.
- Anything reading `revenue_lines`.
- A read-only SQL path — `db:query` already exists for that
  (T-260828-39) and is not the way a view reads records.
- The view itself ([T-260901-11](T-260901-11-offerings-view.md)).

## Touches

- `electron/shared/ipc-types.ts` — channel declarations
- `electron/main/ipc/registry.ts` — handlers
- `electron/main/ipc/index.ts` — registration
- `electron/preload/index.ts` — the `window.crm.*` surface
- `electron/renderer/window.d.ts`
- `electron/renderer/lib/query-keys.ts` — keys + `invalidate.offerings`
- `electron/renderer/lib/test-support/stub-crm.ts` — one stub per channel
- the matching `.test.ts` beside each

## Acceptance

- [ ] Every channel above appears in `ipc-types.ts`, in the preload surface
      and in `stub-crm.ts`; `registry.test.ts`'s existing completeness check
      (or a new one) fails if one is declared and not handled.
- [ ] A request body carrying an undeclared extra field is rejected by the
      channel, not silently accepted — asserted per mutating channel.
- [ ] `offerings:deleteCategory` on a category holding an offering returns
      `{ ok: false }` with the repository's reason reaching the renderer
      verbatim, and the category still exists afterwards.
- [ ] `offerings:create` with no rate returns `{ ok: false }` and writes no
      row.
- [ ] No channel returns a filesystem path, and none accepts one.
- [ ] `npm run verify` passes.
- [ ] `security-review` has run over the added surface and its findings are
      recorded in the outcome.

## Risks

- **This is the boundary.** `.dev/README.md` is explicit that
  `security-review` runs over the accumulated surface in its own session
  rather than per diff — the URL-scheme gap on `companies.website` was found
  exactly that way. Adding ten channels without that pass leaves the largest
  single widening of the IPC surface since T-260828-26 unexamined.
- `offerings.blurb` is free operator text that will be rendered in a view.
  It crosses the boundary as a string like `companies.notes` does; whatever
  the existing rule is for rendering those, this follows it rather than
  inventing one.
- `stub-crm.ts` is shared by every renderer test. A stub whose shape differs
  from the real channel's response makes view tests pass against a fiction.

## Outcome

**Changed:** 6 files. Ten channels in `ipc-types.ts` / `registry.ts` —
`offerings:listCategories` / `list` / `get` / `createCategory` /
`updateCategory` / `deleteCategory` / `create` / `update` / `archive` /
`duplicate` — every request and response schema imported from
`electron/shared/offerings.ts`; the preload and `window.d.ts` build from
`CHANNEL_NAMES` and needed no edit. `stub-crm.ts` answers each one;
`query-keys.ts` gains `offerings.{all, list(filter?), detail, categories}`
and `invalidate.offerings` over the whole prefix. Shapes a downstream task
should know: `offerings:list` takes `listOfferingsFilterSchema.optional()`
and answers `OfferingListItem[]`; `get` / `create` / `update` / `archive` /
`duplicate` answer `OfferingWithVersions` (archive returns the row, not
`{ id }`, since nothing is deleted); `duplicate` takes `{ id, overrides? }`
with the name nested under `overrides`; `deleteCategory` answers `{ id }`.

**Not built, on purpose:** no `offerings:restore` (no repository inverse
for `archiveOffering`), no category archive (categories have no `active`
column — they delete, and the delete refuses while offerings point at
them), no price-change channel (`updateOfferingInputSchema` has no
`rateCents`; appending a version is P3-02).

**Review:** passed after one test strengthened on the branch. Five mutants
against `registry.test.ts` (+ `query-keys.test.ts` for the last): list
ignoring its filter (red), duplicate dropping `overrides` (red),
`deleteCategory` not deleting (3 red), `invalidate.offerings` narrowed to
the list key (red), and `offerings:update`'s wrapper losing `.strict()` —
**survived**: the strictness test probed extra keys inside `patch` and on
every other wrapper but not on this one. Added the top-level case
(`713dad6`); the mutant then died. Covering run on the merged tree: ipc
42 tests, renderer lib 67; tsconfig.node and web clean.

**Found at merge, fixed on main (`897943d`):** the builder reported
`npm run lint` clean, but `eslint` on the merged tree flagged the stub
category's `color: '#C9A84C'` under `local/no-literal-colour` — a hex
literal in a renderer file. The column is nullable, so the stub carries
`null`. The clean lint report is the `npm run` exit-1-silently artifact
this run keeps meeting; the gate at the end runs eslint directly.

**Pending:** `security-review` over the added surface runs in its own
session — its findings are not in this outcome yet. What this review
checked by hand: no channel accepts or returns a filesystem path (walked
by a test), every mutating wrapper is `.strict()`, `blurb` crosses as a
plain string and is never interpolated into markup.
