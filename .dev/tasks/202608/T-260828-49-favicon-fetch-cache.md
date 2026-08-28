---
id: T-260828-49
title: Fetch and cache favicons in main, once per host, never through a third party
status: open
category: integration
plan_ref: P1-19
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

AGENTS.md carries this as a standing gotcha, in the section for things that are
*silently wrong rather than loudly broken*:

> **Never call a third-party favicon service.** It leaks every client URL and
> breaks offline. Main fetches once and caches in the `favicons` table.

That is the whole reason this is its own task with its own security review rather
than three lines inside the links UI. `https://www.google.com/s2/favicons?domain=…`
is the obvious implementation, it is one line, it works immediately, and it
quietly ships every client domain this consultancy works with to a third party —
in an app whose stated position is no telemetry, no analytics, and no network
call the user did not configure.

The `favicons` table already exists in migration 0001, keyed by host under
ADR-002's natural-identity exemption. Nothing writes it.

## Scope

**In:**

- A main-process favicon fetcher: given a host, fetch that host's own favicon
  directly (`/favicon.ico`, and the `<link rel="icon">` the HTML declares),
  store the bytes and content type in the `favicons` table keyed by host.
- **Fetched once per host.** The second link to the same host reads the cache.
  A failed fetch is also recorded, with a timestamp, so a dead host is not
  retried on every render — with a stated retry-after interval rather than never.
- A per-kind fallback icon set, used when there is no cached favicon: with the
  network off, links still render.
- Timeouts, a response size cap, and a redirect limit. This is the app's only
  outbound request to an arbitrary host, and the host is supplied by whatever
  URL the user pasted.
- Only `http:` / `https:` are ever fetched, matching T-260828-48's allowlist.
- An IPC channel to read a cached favicon. The renderer **never issues the
  fetch** — it asks main for what is cached, and main decides whether to fetch.

**Out:** The links UI (T-260828-50). The links repository (T-260828-48).
Prefetching favicons for hosts with no link. Any image processing beyond storing
what was returned — no resizing, no format conversion.

## Touches

- `electron/main/favicons/` — new
- `electron/shared/ipc-types.ts`, `electron/main/ipc/registry.ts` — the read channel
- `electron/main/favicons/*.test.ts` — new
- Assets for the per-kind fallback set

## Acceptance

- [ ] **No third-party favicon service is contacted from any code path** —
      asserted by a test over the source and over the actual request target, not
      by reading the diff. AGENTS.md names this specifically, and "we checked the
      diff" is exactly how it comes back later
- [ ] A host is fetched once; a second link to the same host issues no request —
      asserted by counting requests, not by observing a cache field
- [ ] With the network unavailable, links render with the per-kind fallback and
      nothing throws
- [ ] The renderer issues no fetch — asserted from the renderer side, since
      `contextIsolation` and the preload boundary are what make this true
- [ ] A host that never responds is bounded by the timeout, and one that returns
      a very large body is bounded by the size cap
- [ ] A redirect chain terminates at the limit rather than following indefinitely
- [ ] A failed fetch is recorded and not retried on every subsequent render
- [ ] A `file:` or `javascript:` URL is never fetched

## Risks

- **The one-line third-party call.** It is genuinely the easiest implementation
  and it violates a named AGENTS.md gotcha. `security-review` is the category
  default for `integration` and this is the diff it exists for.
- **Fetching on render.** If the read channel triggers a fetch synchronously, a
  company page with twelve links makes twelve outbound requests when it opens,
  and the offline case becomes twelve timeouts.
- **Unbounded response.** The host is arbitrary and user-supplied; a favicon
  endpoint returning a gigabyte is a denial of service against the user's own
  machine.
- **SSRF-shaped requests.** A pasted URL can name `localhost`, a private range,
  or a cloud metadata endpoint. Decide explicitly whether those are fetched, and
  record the decision — for a local-first single-user app the exposure is small,
  but "we never thought about it" is not the same as "we decided".
- **No telemetry, no analytics, no network call the user did not configure**
  (AGENTS.md). This task adds the app's first outbound request; it needs to be
  the kind a user would recognise as theirs.
