---
id: T-260828-49
title: Fetch and cache favicons in main, once per host, never through a third party
status: done
category: integration
plan_ref: P1-19
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge.

**Changed:** `electron/main/favicons/` (new: `fetch.ts`, `service.ts`,
`sniff.ts`, `store.ts`, `index.ts`, four test files, a recording-fetch
test support), `electron/shared/favicons.ts` (new), `ipc-types.ts`,
`electron/main/ipc/registry.ts`, `electron/renderer/lib/favicon-boundary.test.ts`
(new), `stub-crm.ts`.

### The AGENTS.md rule is asserted two ways, not read

> **Never call a third-party favicon service.** It leaks every client URL and
> breaks offline.

`https://www.google.com/s2/favicons?domain=…` is one line, works immediately,
and quietly ships every client domain this consultancy works with to a third
party. The acceptance was explicit that a reviewer's eye is not the guard —
"asserted by a test over the source *and* over the actual request target, not by
reading the diff".

Both halves exist. A **source scan** over all of `electron/` refuses any known
service host, so the one-line version cannot be added anywhere in the app —
including in a view or a helper nothing to do with this directory. And a
**behavioural** test drives the real fetcher against a recording `fetch` and
requires every requested URL to be on the link's own host, or a host that host
redirected to.

**The source scan bit twice during the build, and the builder took the hit
rather than exempting itself.** It failed on a doc comment in `fetch.ts` that
quoted the search-engine favicon URL, and on a renderer test that named
`XMLHttpRequest` in prose. Both were reworded so the literal strings are gone,
and both now say why the API names are absent from their own prose. That is the
correct call: the checker's whole value is that it cannot tell a mention from a
call site.

### SSRF, decided rather than defaulted

`isFetchableHost` refuses **every IP-literal host — private and public alike** —
plus `localhost`, `.localhost`, `.local`, and dotless intranet names. Refusing
the whole class is narrower and simpler than enumerating private ranges, and it
closes the cloud metadata endpoint in all its integer spellings (the WHATWG
parser normalises `0xa9fea9fe` to `169.254.169.254` before this code sees it —
asserted, not assumed).

**DNS is not resolved**, so a public name pointing into a private range is still
fetched. That is accepted explicitly and stated in `fetch.ts`'s header, on the
grounds that this is a single-user local-first app and the response only ever
reaches the user as pixels that have passed a magic-number check. Recorded as a
decision because the scope asked for it to be one.

### No migration, and why that is not merely a workaround

The scope says "store the bytes and content type", but `favicons` has only
`(host, bytes, fetched_at)`. Adding a column means editing `schema.ts`, whose
drizzle regeneration gate asserts the incremental delta is exactly 0004's
`CREATE INDEX` statements and nothing else — so a column would have forced an
edit to that gate, in a file outside this task's ownership, mid-wave.

The content type is instead recovered by **sniffing the bytes' magic numbers on
read.** The only other source is the arbitrary host's own `Content-Type` header,
which is a *claim*; the bytes end up in a `data:` URL the renderer displays, so
sniffing is the stronger answer regardless. The existing three columns already
carry all four states: absent = never tried, bytes + `fetched_at` = cached,
NULL bytes + `fetched_at` = tried and failed at that instant.

### Absence is an answer, never a wait

The dispatch asked for this because T-260828-50 renders link rows and must not
reflow as favicons resolve. `favicons:get` returns
`{ state: 'ready', contentType, dataUrl, fetchedAt }` or
`{ state: 'none', reason, retryAfter }` with `reason` one of `never-fetched` |
`fetching` | `unavailable` | `unsupported-url`. **Never pending.** The fetch
happens in the background in main and lands in the table for the next query.

`ready` carries a `data:` URL because the CSP is `img-src 'self' data:` — a
`blob:` URL would be refused by the page. `FAVICON_FALLBACK_ICONS` in
`electron/shared/favicons.ts` is keyed by `LinkKind` and exhaustive by
construction.

**Verified at merge:** typecheck clean across all three passes, lint clean, and
the full suite green on the merged tree.

## Two judgement calls a reviewer may want to revisit

**SVG is off the content-type allowlist**, so a host serving only an SVG icon
falls back to its per-kind icon. Documented and reversible.

**The "renderer issues no fetch" criterion is asserted in two files, not one.**
ESLint's `no-renderer-node-access` forbids a renderer module importing
`node:fs`, and the established carve-out convention is four shared config files
the builder did not want to edit mid-wave. So the source scan over
`electron/renderer/**` lives in the node-pool test, and the renderer-side
behavioural half — `window.crm` is the only route, and the first answer is
definite — lives in a renderer-pool test. Each file's header points at the other.

## No ADR, and the reason is this run's own history

The builder declined to write one: ADR-012 would have been the next free number,
and **claiming it mid-wave risks colliding with another agent.** This run
produced two such collisions already (T-46 vs T-51, then T-41 against the
renumber that fixed the first), which is exactly the hazard it avoided.

The SSRF and no-migration decisions are recorded in the module headers instead.
Promoting either to an ADR is a call worth making from outside a wave, when the
next free number is not a moving target.
