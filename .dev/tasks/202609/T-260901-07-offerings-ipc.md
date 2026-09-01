---
id: T-260901-07
title: Expose the offerings repositories over IPC
status: in-progress
category: ipc
created: 2026-09-01
closed:
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
