---
id: T-260828-55
title: Store the URL that was validated, and match link hosts on a boundary
status: in-progress
category: data
plan_ref: P1-18
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->
## Why

Deferred from T-260828-48's review, which was non-blocking but found a real
seam. `addLink` validates the WHATWG-parsed URL and then inserts the **raw
caller string**, so characters the parser strips survive into the row — a URL
carrying an embedded tab or NUL stores them verbatim.

The scheme allowlist is not bypassable (the parser strips control characters
before the protocol check, so a tabbed `javascript:` still refuses), so this is
hardening rather than an open hole today. But the stored value is not the value
that was validated, and T-260828-49 (favicon fetch), T-260828-50 (links UI) and
any `shell.openExternal` all read the stored form. The guarantee is also
write-side only: `linkSchema.url` in `electron/shared/links.ts` is a bare
`z.string()`.

Separately, `detectLinkKind` matches its rule substrings against the whole
hostname, so `mynotion.com` and `notion.evil.com` both resolve as Notion. The
acceptance criterion T-260828-48 was written against — the query-string spoof —
is met and tested; the false-positive direction never was.

## Scope

**In:**

- Insert `url.href` (the parsed, normalised form) rather than the caller string,
  and reuse `linkUrlSchema` in `linkSchema` so the read side carries the same
  guarantee as the write side.
- Host matching on label boundaries — exact host or a `.`-delimited suffix —
  rather than `host.includes(substring)`.
- Close the mutation survivors review found: every `.strict()` can currently
  become `.passthrough()` and both empty-string guards can be relaxed with all
  31 tests still green.
- A stable `ORDER BY`: `added_at` is millisecond-precision with no tiebreaker,
  and flipping `DESC` to `ASC` leaves the suite green. Every sibling repository
  that orders on a non-unique column has a tiebreaker.
- Decide, and state in a comment, whether `addLink` validates that the
  `entityId` exists. It currently accepts any string for a valid
  `entityType`, so a typo'd id creates a link nobody can reach — and unlike the
  delete-side question, T-260828-41 does **not** cover this.

**Out:** The delete/orphan policy, which is T-260828-41's. The links UI
(T-260828-50). Favicon fetching (T-260828-49).

## Touches

- `electron/shared/links.ts`
- `electron/main/db/repositories/links.ts`
- `electron/main/db/repositories/links.test.ts`

## Acceptance

- [ ] A URL containing an embedded tab or NUL is stored in its parsed,
      normalised form — asserted by reading the row back, not by inspecting the
      input
- [ ] `mynotion.com`, `notion.evil.com`, `github.evil.com` and
      `drive.google.evil.com` all resolve as `web`, each asserted separately
- [ ] `notion.so` and `www.notion.so` still resolve as `notion`
- [ ] Replacing every `.strict()` with `.passthrough()` makes at least one test
      fail — verified by actually performing the mutation
- [ ] Two links added within the same millisecond come back in a deterministic
      order, asserted
- [ ] Flipping the `ORDER BY` direction makes a test fail

## Risks

- **Normalising more than intended.** `url.href` also lowercases the host, adds
  a trailing slash to a bare origin and may re-encode the path. That is the
  point, but it means a link's stored text can differ from what the user pasted;
  the title still shows what they typed, and the test should pin one such case
  so the change is deliberate rather than surprising.
- **A suffix match that forgets the exact case.** `notion.so` must match
  `notion.so` itself, not only `*.notion.so`.
