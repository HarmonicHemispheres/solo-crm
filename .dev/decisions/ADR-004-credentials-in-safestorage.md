---
id: ADR-004
title: Integration credentials live in Electron safeStorage, never in the database
status: accepted
date: 2026-08-28
---

## Context

§7 defines four adapters that authenticate: Stripe (an API key), Google Calendar
and Gmail (OAuth access and refresh tokens), and the timelog import. Requirements
§5 has nowhere to put any of them.

§6.11 puts integration toggles on the settings surface, which makes the `settings`
table (ADR-002) the obvious-looking home for the keys sitting next to those
toggles. It is the wrong one, and it will not look wrong at the moment someone
does it — the row above will say `stripe.enabled`.

Three properties of this system turn a credential in a table into a leak:

- **§8 requires a nightly export of the whole database to timestamped JSON in a
  user-chosen folder, keeping the last thirty.** The folder is user-chosen, and
  AGENTS.md already warns that the obvious choice is a sync folder. A key in a
  table is a key in thirty plaintext files, possibly inside Google Drive.
- **§6.12 ships a read-only query console** over any table, with saved snippets.
- **§4 keeps a future Turso/libSQL replica as a drop-in**, which would carry
  every table off the machine.

That is why this is a schema decision rather than an implementation detail: the
consequence is about what the schema *exports*, not about how any adapter is
written. It also fails silently — the arrangement holds perfectly until the day
someone adds a settings row for an API key, and nothing breaks then either.

## Decision

**Every secret is encrypted with Electron `safeStorage` and written to a file
under `app.getPath('userData')`, separate from `solocrm.db`.** Secrets means API
keys, OAuth access tokens, refresh tokens, client secrets — anything that would
authenticate a request.

Stated as the rule that is actually enforceable, because it is a rule about a
table rather than about Stripe:

**The `settings` table may hold only non-secret configuration.** It may hold
whether a source is enabled, when it last synced, what it last saw, and any
non-secret identifier the operator typed. It may not hold anything that would
authenticate a request. The test to apply: *if this value would be dangerous
sitting in a plaintext JSON file in the user's Drive folder, it is a secret and
it does not go in the database.*

Three supporting rules:

1. **No secret crosses IPC toward the renderer.** The direction matters: §6.11
   has the operator typing a Stripe key into a settings surface, and the
   renderer is the only place that key can arrive from, so renderer → main is a
   supported path. What never happens is the reverse. The renderer asks whether
   a source is connected and receives a boolean. It never receives the value and
   never displays it, not even masked, and never reads one back in order to edit
   it — a connect flow **replaces**, it does not edit. A submitted value is
   written and forgotten; there is no channel that returns it.
2. **Both `safeStorage` guards are checked before writing.**
   `safeStorage.isEncryptionAvailable()` must return true **and**
   `safeStorage.getSelectedStorageBackend() !== 'basic_text'`. The second is not
   belt-and-braces: on Linux — a first-class target under §4 — with no libsecret
   or kwallet provider, Electron falls back to the `basic_text` backend, which
   "encrypts" with a hardcoded key while `isEncryptionAvailable()` still returns
   true. That is the bare-Linux session this ADR worries about, and the
   availability call alone waves it through. If either check fails, the
   integration reports itself unavailable and nothing is written. There is no
   plaintext fallback, and `basic_text` counts as plaintext, because a fallback
   is how this decision gets undone quietly on one platform.
3. **The nightly backup covers database tables only.** It therefore cannot leak a
   credential by construction, rather than by someone remembering to exclude one.

## Consequences

**Easier.** The backup carries no credential, so it cannot leak one wherever it
is written — including the sync folders the database file itself must avoid, for
the unrelated corruption reason in §4. That is the whole of the claim.
**It is not a claim that the export is safe to put anywhere.** The nightly JSON
is the whole database (§8): every client name, contact email, agreed rate and
private note, in plaintext, thirty generations deep. §8's privacy clause — client
data never leaves the machine except through configured integrations — applies to
it in full. Removing credentials makes the export free of keys, not free of the
book of business.

**Easier.** The §6.12 query console stays a genuine `SELECT *` over any table.
No redaction layer, no table blocklist, no way for a saved snippet to become an
exfiltration tool.

**Easier.** A future Turso replica syncs the whole database without syncing a
single credential — the property that makes the sync path cheap stays cheap.

**Harder — credentials do not travel between machines.** §3 has a laptop and a
desktop, and each must authorise every source separately. That is what
per-machine encryption means and it is the correct behaviour, but it is a real
step the operator will hit and should be told about rather than debug.

**Harder — losing `userData` means re-authorising everything.** Nothing recovers
a `safeStorage` blob without the OS keychain that encrypted it. Restoring a
backup restores the data and none of the connections.

**Cost — a second store**, read at startup, with failure modes the database does
not have: a locked keychain, or no libsecret provider on a bare Linux session.
Rule 2 turns those into a disabled integration rather than a crash.

**Forecloses** putting a credential in `settings` "just for now". This ADR is the
answer when that comes up, and it will come up.

## Alternatives

**A `credentials` table, or rows in `settings`.** Lost because §8's nightly
export copies every table verbatim into a user-chosen folder and keeps thirty
generations. A Stripe key would sit in plaintext in whatever folder the operator
picked — which AGENTS.md warns is likely to be a sync folder — and would also be
readable from the §6.12 console and would ride along to any future replica. One
convenience, three separate leaks.

**Encrypted rows in the database, with the encryption key in `safeStorage`.**
Lost because it is the same file exposure with one extra step: the backup carries
the ciphertext, `safeStorage` still holds the key, and the only thing gained is
that a leak takes slightly longer to exploit. It also makes exports
unreadable-but-not-actually-safe, which is worse than either end of the choice.

**Environment variables or a dotfile.** Lost because a packaged Electron app
launched from a dock has no shell to inherit an environment from, and a dotfile
is plaintext with no OS protection at all — strictly worse than the database,
which at least has a single well-known location.

**The OS keychain directly, via keytar or similar.** Lost because `safeStorage`
*is* the same keychain on macOS and libsecret on Linux, ships inside Electron,
and needs no native module rebuilt against the Electron ABI. That rebuild cost is
already being paid once for better-sqlite3 (P0-03) and is not worth paying twice
for an API that is already present.

**Prompt the operator for the key each session.** Lost because §6.1's Today
metrics depend on synced data and §3 requires the tool to be useful in ten
seconds. A credential prompt at every launch is §12's abandonment risk arriving
on day two.
