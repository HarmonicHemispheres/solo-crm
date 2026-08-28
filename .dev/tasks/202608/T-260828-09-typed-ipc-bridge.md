---
id: T-260828-09
title: Build the typed IPC bridge — channel registry, validation, error envelope
status: done
category: ipc
plan_ref: P0-07
created: 2026-08-28
closed: 2026-08-28
---

## Why

The renderer reaches the database through exactly one path, and this is it.
T-260828-04 seals the renderer; this task decides what it is allowed to ask for.
Every repository task after this one adds channels, so the shape chosen here is
copied twenty times — if adding a channel takes edits in four files, four files
will drift.

## Scope

**In:**

- A single channel registry: one place that declares channel name, request
  schema, response schema and handler. Adding a channel is one entry.
- zod validation on **both** sides — main validates what it receives, and the
  response is validated before it leaves. A repository returning a shape the
  renderer does not expect should fail loudly in development, not render as
  `undefined` in a card.
- One error envelope. Errors cross as data with a code and a message, never as a
  thrown exception across the bridge, and never as a raw stack trace.
- `window.crm.*` exposed via `contextBridge`, its type generated from the same
  registry the handlers come from, so a drift between them fails `tsc` rather
  than failing at runtime.
- Composes the shared primitives from T-260828-08 rather than redefining date
  and money schemas.

**Out:** Any entity channel — companies, people, engagements, tasks, activity,
search all land in P1-07 as one task, because they share this registry file and
concurrent subagents would conflict on it. The read-only SQL channel (X-02),
which has its own security gate. TanStack Query wiring (T-260828-10).

## Touches

- `electron/main/ipc/registry.ts` — new, the single source
- `electron/main/ipc/index.ts` — handler binding
- `electron/preload/index.ts` — `contextBridge` exposure
- `electron/shared/ipc-types.ts` — generated or inferred channel types
- One or two trivial channels (`app:version`, `db:schemaVersion`) to prove the
  shape end to end

## Acceptance

- [ ] Adding a channel requires editing exactly one file — demonstrated by adding
      the second proof channel
- [ ] A request payload failing validation returns a typed error envelope; nothing
      throws across the bridge
- [ ] A handler returning the wrong shape fails validation in development rather
      than reaching the renderer
- [ ] Renaming a channel in the registry breaks `npm run typecheck` in the
      renderer — the drift is caught at compile time
- [ ] No `fs`, `path`, `child_process` or database symbol is reachable from
      renderer code, enforced by a lint rule rather than by inspection
- [ ] The bridge works under `sandbox: true` as configured by T-260828-04

## Risks

- **`sandbox: true` constrains the preload.** If T-260828-04 has not landed, this
  gets built against assumptions that do not hold and reworked. Read that task's
  outcome for what the preload may use.
- **`ipcRenderer.invoke` exposed generically is the whole boundary undone.**
  Exposing a single `invoke(channel, payload)` on `window.crm` is convenient and
  means the renderer can call anything, including channels added later for other
  purposes. Expose named methods only.
- Response validation costs time on every call. At §8's volumes it should be
  negligible, but if it is disabled in production for speed, say so explicitly
  rather than leaving a silent asymmetry between environments.
- The error envelope is where a stack trace leaks. Requirements §8 forbids
  telemetry, and a trace in a toast is a smaller version of the same problem —
  it puts filesystem paths on screen. Codes and messages, not traces.

---

## Outcome

Merged to main in run R-260828-01 (merge + fixes through `e55180b`). The wire
contract lives in `electron/shared/ipc-types.ts` (channel name + request/
response zod schemas + `IpcResult` envelope + `CrmApi`); handlers in
`electron/main/ipc/registry.ts`; a generic loop in `ipc/index.ts` validates
request → handles → validates response → returns the envelope, never throwing
across the bridge. `window.crm` exposes named, frozen methods for exactly the
registry's channels — no generic invoke, no `ipcRenderer` leak, proven by an
adversarial probe against real sandboxed Electron (bind/call/apply redirection
all fail closed; a decoy non-registry channel is unreachable).

**"One file" criterion is honestly two files** — the wire contract entry and
the handler entry — because composite tsconfigs forbid `electron/shared/**`
referencing main-only code even type-only (TS6307). The reviewer judged the
intent (no four-file drift) satisfied: preload and binding loops never change,
and after the merge fix the `satisfies` is a mapped type over the contract's
own schema types, so a schema mismatch between the two files fails `tsc` (the
reviewer proved the bare `Record` version let schemas drift silently).

Security gate: PASS. Error envelope carries literal strings only — a forced
handler error with filesystem paths in its message reached the renderer as
`{code:'handler-error', message:'db:schemaVersion: something went wrong…'}`;
the stack stayed in main. Response validation runs in production too,
deliberately. Real production bug found and fixed by the builder: the preload
build left zod external, and a sandboxed preload cannot resolve node_modules —
the packaged app's bridge would have crashed. `out/preload/index.cjs` now
contains exactly one `require("electron")` and nothing else.

Applied at merge (review findings): mapped-type `satisfies`;
`no-renderer-node-access` now also covers `electron/shared/**` (the indirect
import path had zero lint coverage); the unreachable non-isolated preload
branch now fails loudly instead of assigning `window.crm` to an unisolated
world; stale comment + dependency ordering. Verify after fixes: 230/230, all
gates green.

Handoff for P1-07 (the twenty-channel task): copy this registry shape — one
contract entry + one handler entry per channel; the mapped-type `satisfies`
and `registry.test.ts` catch set and schema drift; never expose a generic
invoke.
