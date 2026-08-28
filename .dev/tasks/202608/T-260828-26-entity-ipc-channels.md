---
id: T-260828-26
title: Expose the repositories over IPC — entity channels for companies, people, engagements, tasks, activity, settings
status: open
category: ipc
plan_ref: P1-07
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`window.crm` currently exposes exactly two methods — `app:version` and
`db:schemaVersion` — both of which exist as proofs that the bridge works, not as
features. The renderer cannot read or write a single record, which is the direct
reason every page in the installed app is empty. T-260828-09 built the bridge so
that adding a channel costs one entry in `electron/shared/ipc-types.ts` and one
in `electron/main/ipc/registry.ts`, with `electron/preload/index.ts` and
`electron/main/ipc/index.ts` staying generic. This task spends that budget for
the whole entity surface at once.

**It is one task, not six, deliberately.** The channel registry is a single
file with a `satisfies` constraint over its complete key set; six subagents
editing it in parallel would conflict on every merge whatever their scopes
claimed. The plan says the same thing at P1-07.

## Scope

**In:** Channels for every repository function the renderer legitimately needs:

- `companies:*` — list, get, create, update, delete
- `people:*` — list, get, create, update, delete, plus affiliation add / update /
  end and `people:move`
- `engagements:*` — list, get, create, update, delete, plus `engagements:milestones`
- `tasks:*` — list, get, create, update, delete, `tasks:setNextStep`,
  `tasks:countOpen`
- `activity:list`, `activity:get`, `activity:log` — **and nothing else** (G8)
- `settings:get`, `settings:getAll`, `settings:set`, `settings:reset`

Each gets a request and a response zod schema in `CHANNEL_CONTRACTS`, composed
from `electron/shared/types.ts` primitives rather than redefined, and one
handler entry in `registry.ts` spreading its contract. Repository refusals
(T-260828-20's `errors.ts`) map to the existing `IpcResult` error envelope with
their reason preserved — a delete blocked by activity history must reach the
renderer as a sentence a person can read, never a stack trace, a filesystem path
or a raw `SQLITE_CONSTRAINT` string.

Renderer-side query keys and typed hooks in `electron/renderer/lib/` extend
`query-keys.ts` and its `invalidate` map so views consume channels through
TanStack Query rather than calling `window.crm` directly.

**Out:** `electron/preload/index.ts` and `electron/main/ipc/index.ts` — if
either needs an edit, the generic loop has been broken and that is a finding, not
a change. Any renderer view (each is its own task). Search channels — FTS lands
in T-260828-36 and its channel goes in with it. A generic `invoke(channel,
payload)` escape hatch, which would undo the boundary the preload exists to hold.

## Touches

- `electron/shared/ipc-types.ts` — the contracts
- `electron/main/ipc/registry.ts` — the handlers
- `electron/renderer/lib/query-keys.ts` — keys and invalidations
- `electron/renderer/lib/ipc.ts` — typed call helpers
- `electron/main/ipc/registry.test.ts`, `electron/renderer/lib/*.test.ts`
- **Not** `electron/preload/index.ts`, **not** `electron/main/ipc/index.ts`

## Acceptance

- [ ] `git diff` touches neither `electron/preload/index.ts` nor
      `electron/main/ipc/index.ts` — the generic-loop guarantee, checked
- [ ] Every channel has a zod schema on both request and response, and
      `registry.test.ts`'s existing `Object.keys(registry)` vs `CHANNEL_NAMES`
      assertion still passes over the full set
- [ ] No `activity` update or delete channel exists — asserted over
      `CHANNEL_NAMES`, not by inspection (G8)
- [ ] A repository refusal (deleting a company with activity) arrives in the
      renderer as an error envelope carrying the reason, and a test asserts the
      message contains no filesystem path and no stack frame
- [ ] `tsc -p tsconfig.node.json` and `tsc -p tsconfig.web.json` both pass; a
      channel added to `CHANNEL_CONTRACTS` with no matching handler fails `tsc`
- [ ] A round trip works end to end in a real window: create a company from the
      devtools console via `window.crm`, and `companies:list` returns it
- [ ] Invalidating after a mutation refreshes the list without a manual reload

## Risks

- **The renderer never touches SQLite or the filesystem** (AGENTS.md). A channel
  that takes a path, a SQL fragment or a table name would breach that; every
  payload here is entity data. The read-only query channel is X-02
  (T-260828-39) and is scoped separately precisely because it needs its own
  security review.
- **Leaking internals through the error envelope.** The refusal reasons are
  written for a person, and `better-sqlite3` messages sometimes carry the
  database path. Map, do not forward.
- **Response validation cost.** `index.ts` validates every response in every
  environment by design (T-260828-09). Do not add a production bypass to make a
  list channel faster; §8's volumes make it negligible.
- **Over-wide list responses.** Returning every column of every row for the
  palette's benefit will not scale to the 10× volume X-07 measures. Shape list
  responses to what the views read.
