---
id: T-260828-55
title: Store the URL that was validated, and match link hosts on a boundary
status: done
category: data
plan_ref: P1-18
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged as `064cf00`. Built by a subagent under the build-only process
(T-260828-54's wave H); reviewed and gated by the orchestrator at merge.

**Changed:** `electron/shared/links.ts`, `electron/main/db/repositories/links.ts`,
`electron/main/db/repositories/links.test.ts`.

Three changes:

1. **The stored URL is the validated one.** `addLink` wrote `parsed.url` — the
   raw string — while the scheme allowlist and `detectLinkKind` both ran against
   the *parsed* `URL`. Those differ: the WHATWG parser strips control characters,
   lowercases the host, normalises the port and percent-encoding, and gives a bare
   origin its trailing slash. Every downstream consumer reads the stored column,
   so the stored column is the one that must carry the guarantee. It is now
   `url.href`.
2. **Host rules match on a label boundary.** `substrings: ['notion.']` compared
   with `host.includes(...)`, so `mynotion.com` and `notion.evil.com` both read
   as Notion links. The rule shape is now `domains: ['notion']`, matched by a new
   exported `hostMatchesDomain(host, domain)` that drops the final label and then
   requires equality or a `.`-delimited suffix. `www.notion.so` passes;
   `mynotion.com`, `notion.evil.com` and `notion.so.evil.com` all refuse.
3. **`linkSchema.url` is `linkUrlSchema`, not `z.string()`.** The scheme
   allowlist was a write-side guarantee only. It is now the same schema on both
   sides, so a row that reaches the table by some other route — a migration, a
   future import, a hand-edited database — cannot cross into the sinks
   (`href`, `shell.openExternal`, T-260828-49's favicon fetch) unchecked.

**Verified at merge**, on the merged tree rather than the branch: `npm run
typecheck` clean; the whole `node` project 528/528 in 8.45s. Both tasks in this
merge are main-process only, so that is the covering scope; the renderer is
untouched. The single full-suite gate for the run covers cross-task interaction.

**Reviewed at merge.** Two things were checked directly rather than taken from
the builder's report. `LINK_KIND_RULES` changed shape, so every reference to
`substrings` was grepped across `electron/` on the branch — the only one is the
test, and it moved with the rule. The label-boundary logic was walked by hand
against `notion.so`, `www.notion.so`, `mynotion.com`, `notion.evil.com`,
`notion.so.evil.com` and `drive.google.com`.

Two pre-existing assertions changed rather than weakened:
`expect(created.url).toBe('http://example.com')` is now `'http://example.com/'`,
because `url.href` gives a bare origin its trailing slash. That is the
normalisation this task exists to pin, so the assertion was wrong about the new
intended behaviour, not made lax — a second test pins the uppercase-host case
alongside it.

## Known limits, recorded deliberately

**A multi-label public suffix is not understood.** `example.co.uk` reduces to
`example.co`, which matches no rule, so a vendor served from one would read as
kind `web`. Recognising those needs the Public Suffix List, a network-fetched
dataset this app deliberately does not carry (AGENTS.md: no network call the user
did not configure). None of the seven vendors serve their product from a
multi-label suffix, and the failure direction is a missing kind, never a false
positive — the same outcome as no rule at all.

**`entityId` is not checked for existence,** and the code now says so. Checking
would mean branching on `entityType` to pick a table, which is the per-type
branching the polymorphic design exists to avoid, and it would be a half-measure
regardless: nothing stops the entity being deleted a second later, since no
foreign key spans three tables. A links row pointing at a dead id is already a
state this schema permits. **T-260828-41 owns the cascade-vs-refuse policy** and
can add the create-side check in the same place it adds the delete-side one, with
one answer instead of two.
