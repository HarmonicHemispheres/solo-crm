---
id: T-260828-09
title: Build the typed IPC bridge — channel registry, validation, error envelope
status: open
category: ipc
plan_ref: P0-07
created: 2026-08-28
closed:
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

*Appended at close. Delete this heading if the task is dropped.*
