---
id: ADR-012
title: The operator's icon and logo are blobs in a `branding` table keyed by slot, not files in the data root and not a settings key
status: accepted
date: 2026-08-29
---

## Context

The rail's brand block is hardcoded markup — a fixed mark and the wordmark
"Solo CRM". T-260829-05 through T-260829-07 let the operator replace both with
their own, which first requires a place to keep two images.

Nothing in the app stores an operator-supplied file today. The only table
holding bytes is `favicons`, and those arrive from the network, are
disposable, and are re-fetchable at any time. Branding is the opposite on all
three counts: it comes off the operator's disk, it is not reconstructible from
anywhere else, and losing it is a visible regression rather than a cache miss.

So the store has to satisfy three things the app already guarantees for the
database and for nothing else:

- **It survives a restart.** Obvious, and the reason `localStorage` in the
  renderer is not a candidate (§4, and ADR-002 already rejected it for
  settings).
- **It moves with the data root.** T-260828-19 relocates the whole data root
  behind ADR-006's `data-location.json` pointer file. Anything that is not
  inside the database has to be found, moved and re-pointed by that path too.
- **It is inside the backup.** §8's nightly export copies *tables*. A store
  outside the database is silently outside the backup, and — as ADR-002 said
  of the same idea for settings — nobody discovers that until a restore, which
  is the worst possible time.

Three decisions follow, and they are recorded together because each only makes
sense given the others.

## Decision

### 1. The bytes live in the database, in their own table

[`0005_branding.sql`](../../electron/main/db/migrations/0005_branding.sql):

```sql
CREATE TABLE `branding` (
  `slot` text PRIMARY KEY NOT NULL,
  `bytes` blob NOT NULL,
  `content_type` text NOT NULL,
  `byte_length` integer NOT NULL,
  `updated_at` text NOT NULL
);
```

Two rows at most, ever: `slot` is `'icon'` or `'logo'`
(`BRANDING_SLOTS`, [`electron/shared/branding.ts`](../../electron/shared/branding.ts)).
**A missing row means "use the built-in default."** The absence *is* the
default, so there is no `enabled` flag and no `useDefault` column that could
disagree with the bytes, and clearing a slot is a `DELETE` rather than a write
of a sentinel. Every column is `NOT NULL`, so a half-written row — bytes with
no type, a type with no bytes — is not representable.

> **Scope note (2026-09-01).** "Two rows at most, ever" is a claim about the
> `branding` table, not about operator-supplied images in general.
> [ADR-015](ADR-015-company-images.md) extends this decision to per-company
> logos and banners in their own `company_images` table — one row per company
> and slot — and changes the read path to match, because a per-company table
> is read by a list and this one is not. Nothing here is superseded.

`content_type` is stored rather than re-sniffed on read, which is the one place
this table deliberately differs from `favicons`. It is safe to store precisely
because it is never a caller's claim: `writeBrandingSlot` derives it from the
bytes' own magic numbers via `sniffImageContentType` — the favicon sniffer,
reused, not a second copy — and refuses anything that does not sniff to the
raster set. Storing it saves a sniff on every app start, which is when both
slots are read to paint the rail.

**SVG is refused**, on the argument
[`electron/shared/favicons.ts`](../../electron/shared/favicons.ts) makes for
network-fetched icons and more strongly. There, an SVG would render in a link
row; here it would render in the app's own chrome, inside the app's own origin,
on every view. "The operator picked the file" is not a guarantee about the file
— a logo arrives from a designer or out of a vendor's brand kit — and it has
never been a sound reason to widen what a renderer will parse. The accepted set
is the raster set already declared for favicons: PNG, JPEG, WEBP, GIF, BMP,
ICO, decided by magic number and never by file extension.

**512 KB per slot**, declared once as `BRANDING_MAX_BYTES` and enforced in the
repository. The cap is about read timing, not disk: both slots are read on
every app start and are base64-inflated by a third on the way across IPC, so
two slots at the cap is roughly 1.4 MB of string arriving before the first view
renders. **This number is revisable** — it is a compromise, not a measured
threshold. A 512 KB PNG is a generously large wordmark and anything much bigger
is almost always an unoptimised export; if a legitimate logo is ever refused,
raising it is a one-line change in one file.

This argument is about *two* reads at startup. It does not transfer to a table
read sixty rows at a time; ADR-015 §3 and §4 say what bounds a per-company
image instead, and its caps are declared separately rather than reusing
`BRANDING_MAX_BYTES`.

### 2. `branding` joins ADR-002's natural-identity exemption class

AGENTS.md states, unqualified, that every table gets a UUID primary key and
`created_at`/`updated_at`. [ADR-002](ADR-002-settings-key-value-table.md) rule 4
carves out a *class* — tables keyed by natural identity — and gives the
membership test: **the key is a value the outside world already guarantees
unique, and no other table holds a foreign key to the row.**

`branding` passes both. The slot *is* the identity: a surrogate UUID would
permit two rows both claiming `'logo'`, with no answer to which one the rail
should paint — exactly the argument that decided `settings` by key and
`favicons` by host. Nothing references a branding row; the rail reads it and
nothing else.

It keeps `updated_at` and omits `created_at`, for `settings`' reason rather than
`favicons`': last-write-wins is what a future replica needs, and a slot has no
creation event worth recording, because the built-in default was in force
before the row existed.

This is written down rather than left implicit because ADR-002's own Context
says why: an exemption applied to a named list is a special case someone will
later "fix", and a new natural-identity table with no ADR reads as a violation
of the AGENTS.md rule rather than as a member of a stated class. The
`schema.ts` header and this ADR are the two places that say `branding` belongs
to it.

### 3. Branding is not a `settings` key

`settings` is the obvious home for "workspace identity" and it is the wrong
one, for a reason about read *volume* rather than about types — see the
Alternatives below.

## Consequences

**Easier — one path, one guard.** The images are inside `solocrm.db`. The data
root relocation (T-260828-19) moves them because it moves the database;
`resolveDatabasePath()` and its sync-folder guard stay the only door to
operator data, which is the AGENTS.md gotcha this decision is most exposed to.
The nightly export carries them because it copies tables.

**Easier — an atomic swap.** Replacing a logo is one upsert in one
transaction. There is no window in which the row names a file that is not
there yet, which is the failure a filesystem store has to be written carefully
to avoid and gets wrong under a crash.

**Harder — the database grows by up to 1 MB.** Two 512 KB blobs is a real
increase against a database that is otherwise text and small. Accepted: it is
bounded by the cap, it is a one-time cost rather than a growth rate, and SQLite
stores a blob of this size in overflow pages that no query except the branding
read ever touches.

**Harder — no streaming.** A blob column is read whole. That is why
`byte_length` is a column: a caller that only wants to report the size does not
have to load the bytes. Nothing in the app wants to stream an image this small.

**Sniffing is the only gate, and that is a known, bounded exposure.** A file
that sniffs as PNG but is malformed still reaches Chromium's decoder as a
`data:` URL. This is the same exposure `electron/main/favicons/` already
accepts, bounded by the same three things: raster only, no SVG, a hard byte
cap. There is no image decoder in main and this decision does not add one —
resizing, re-encoding and dimension validation are all deliberately out of
scope, and display size is a CSS concern the consuming task owns. (ADR-015
adds a decoder in main for `company_images` only, with its own guards; the
branding path is unchanged and still decodes nothing.)

**Forecloses branding history.** Writing overwrites; the previous logo is
gone. Nothing asks for history, and `updated_at` answers the only question
anyone has actually had.

## Alternatives

**Files in the data root — `branding/icon.png`, `branding/logo.png`, beside
`solocrm.db`.** The intuitive shape, and the one this decision most nearly
took. It lost on three specific counts, any one of which would have been
enough:

- **It creates a second path to resolve and guard.** ADR-006 makes
  `resolveDatabasePath()` the single door through which every operator-data
  path passes, precisely so the sync-folder guard cannot be bypassed. A
  `branding/` directory resolved beside the database is either a second,
  unchecked way to reach the data root, or a second caller of the same guard
  that has to be kept in step with it forever. AGENTS.md names this as a
  silently-wrong failure rather than a loud one.
- **It falls out of the backup.** §8's export copies tables. Files beside the
  database would need an explicit second step in the exporter and in any
  future restore — and a missing step there is invisible until the restore.
- **It has no atomic write.** A crash between "write the new logo" and "the app
  reads it" leaves a truncated file the renderer displays as a broken image,
  with nothing to roll back to. The database gives that for free.

The advantage it would have bought — not loading a blob column — is worth
nothing at 512 KB, read once per start.

**A `settings` key holding a base64 data URL.** Lost on read volume, which is
the specific thing that makes `settings` the wrong table for this and the right
one for a density preference. `settings:getAll` returns the whole snapshot in
one object and is fetched by the shell on every load *and* by the settings
view; ADR-002 rule 1 makes `value` JSON precisely so settings stay small,
cheap, unrelated scalars. Two images at the cap would put roughly 1.4 MB of
base64 into every one of those reads, so opening the settings view — or any
view at all — would pay for an image nobody asked for. It also inverts the
storage: bytes would be stored base64-inflated on disk rather than inflated
only at the wire, and every write would go through JSON encoding. ADR-004's
rule that `settings` holds non-secret values is untouched by this; the
objection is size and read frequency, not sensitivity.

**One table, one row, two blob columns (`icon_bytes`, `logo_bytes`).** Lost to
the shape argument ADR-002 made against a single-row `workspace` table: a
column list that grows with each new image, and NULL doing double duty as both
"not set" and "cleared". Keying by slot makes "absent" a missing row, which is
a state SQL can express exactly once.

**A `blob_store` table keyed by a UUID, with `settings` holding the ids.**
Lost as generality bought before there was a second customer for it: it adds a
foreign key, an orphan-cleanup problem, and two reads where one would do, to
serve exactly two images whose identities are already known at compile time.
If a third kind of operator-supplied file ever appears, that is the moment to
reconsider — not now.
