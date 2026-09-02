---
id: T-260901-21
title: Bound the favicon body read by the same deadline as the headers, and close the trailing-dot host bypass
status: done
category: integration
created: 2026-09-01
closed: 2026-09-01
---

## Why

`fetchBounded` cleared its abort timer as soon as `fetch` resolved — headers
in — and read the body with no deadline. A host that answered 200 and then
stalled held the read open for the life of the process, and `service.ts`'s
in-flight entry for that host never cleared: every later `favicons:get` on
it answered `fetching` until restart. Separately, `isFetchableHost` refused
`localhost` but admitted `localhost.`, which the URL parser keeps and DNS
resolves to loopback.

## Story

As the operator, a link whose host misbehaves costs me one timeout and a
fallback icon, never a host that stays "fetching" all day; and a pasted
`http://localhost./…` link makes no request.

## Constraints

- AGENTS.md: never a third-party favicon service; the recording-fetch tests
  assert the request targets and must keep doing so.
- One deadline per redirect hop, unchanged budget (`FAVICON_TIMEOUT_MS`).

## Acceptance

- [x] A route that answers headers then stalls the body ends with
      `{ reason: 'timeout' }` inside the budget.
- [x] `isFetchableHost('localhost.')`, `'foo.localhost.'`, `'printer.local.'`,
      `'intranet.'` are all false.
- [x] Every existing favicon test passes unchanged.

## Related

`electron/main/favicons/fetch.ts`, `service.ts`,
`test-support/recording-fetch.ts`, `fetch.test.ts`.

---

## Outcome

**Changed:** `fetch.ts` — the timer's `finally` now wraps the whole hop,
and a rejected body read maps to `timeout`/`network-error`; the host check
strips one trailing dot. `recording-fetch.ts` gained `stallBody`; two tests.

**Departed from scope:** Nothing.

**Not verified:** Against a real stalling host — the stalled stream is
simulated, rejecting on abort the way undici's does.

**Elapsed:** ~15 minutes.
