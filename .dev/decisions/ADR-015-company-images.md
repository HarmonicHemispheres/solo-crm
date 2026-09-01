---
id: ADR-015
title: A company's logo and banner are blobs in a `company_images` table, stored beside a downscaled derivative that is the only thing a list ever reads
status: accepted
date: 2026-09-01
---

## Context

**This is a scope addition, not a bug fix.** §6.2 of the requirements gives a
company an identity colour and initials — `hue(name)` and `initials(name)`,
derived at render time, stored nowhere — and says nothing about an image. The
mockup says nothing either. The request that a company gets an uploadable logo
and a banner, shown on company detail and on every card in the companies grid,
is new scope, and §6.2 is amended as of this ADR's date so that the shipped app
and the requirements do not disagree. It is decided before it is built because
one existing decision is directly in its path.

[ADR-012](ADR-012-operator-branding-storage.md) settled how operator-supplied
images are stored — blobs in the database, 512 KB a slot — and bounded itself
to **"two rows at most, ever."** Its cap is argued entirely from read timing:
both slots are read on every app start, base64-inflated by a third on the way
across IPC, so two slots at the cap is "roughly 1.4 MB of string arriving
before the first view renders — noticeable, bounded, and recoverable."

Per-company images break that argument's premise, not its conclusion. Sixty
companies with a logo and a banner each is 120 blobs, and the companies grid
wants all of them at once. At ADR-012's cap that is 62.9 MB stored and
**83.9 MB of base64 crossing IPC to paint one list.** "Bounded and recoverable"
stops being true, and it stops being true silently — the seeded development
database has nine companies and no images, so the naive read is instantly fast
on every machine a developer will ever run it on.

Three facts fix the shape of the answer:

- **An image reaches the renderer only as a base64 `data:` URL over IPC.** The
  CSP is `img-src 'self' data:` ([`security.ts`](../../electron/main/security.ts)),
  T-260829-05 forbids `blob:` and custom protocols, and the renderer cannot
  read a file. So every byte figure below is the base64 size on the wire, not
  the stored size — a third larger, always.
- **The grid renders every row.** `Companies.tsx` issues one `companies:list`
  and maps the whole result; there is no virtualisation and §6.13 asks for
  none. "The rows on screen" and "all rows" are the same set.
- **The mark is not a shared component.** `CompanyMark` is three local copies
  (`views/Companies.tsx`, `views/CompanyDetail.tsx`, `views/Today.tsx`). Nothing
  central exists that an image could be threaded through, and nothing central
  exists that could quietly start issuing its own read per card.

The six questions the scoping task put are answered in order.

## Decision

### 1. The bytes live in the database — ADR-012's conclusion, reached again

ADR-012's three tests apply unchanged: the store must survive a restart, move
with the data root behind [ADR-006](ADR-006-data-root-pointer-file.md)'s
pointer file, and be inside the nightly backup, which copies *tables*. Files
in the data root fail the third quietly, create a second path that
`resolveDatabasePath()`'s sync-folder guard does not cover, and have no atomic
replace. None of that changes because there are sixty companies rather than
one rail; what changes is only that the failure of files would now be 120
files rather than two. **The bytes live in `solocrm.db`, in their own table.**

The cost this buys is real and is stated in Consequences: the database grows
by whatever the caps admit, and the nightly export copies it.

### 2. `company_images` takes a UUID primary key and a unique index on `(company_id, slot)`

```sql
CREATE TABLE `company_images` (
  `id`                 text    PRIMARY KEY NOT NULL,
  `company_id`         text    NOT NULL,
  `slot`               text    NOT NULL,            -- 'logo' | 'banner'
  `content_type`       text    NOT NULL,            -- of `bytes`: image/png | image/jpeg
  `byte_length`        integer NOT NULL,            -- of `bytes`
  `width`              integer NOT NULL,            -- of `bytes`, in pixels
  `height`             integer NOT NULL,
  `created_at`         text    NOT NULL,
  `updated_at`         text    NOT NULL,
  `thumb_content_type` text    NOT NULL,            -- image/png (logo) | image/jpeg (banner)
  `thumb_byte_length`  integer NOT NULL,
  `thumb_bytes`        blob    NOT NULL,            -- the derivative, §3
  `bytes`              blob    NOT NULL,            -- the original, LAST — see below
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `company_images_company_slot_unique`
  ON `company_images` (`company_id`, `slot`);
```

**Not the natural-identity exemption.** AGENTS.md exempts "tables keyed by
natural identity" from the UUID rule, and [ADR-002](ADR-002-settings-key-value-table.md)
gives the membership test: *the key is a value the outside world already
guarantees unique, and no other table holds a foreign key to the row.*
`branding` passed — `'logo'` is an identity the outside world fixes. The pair
`(company_id, slot)` is not: `company_id` is a UUID this app minted, and a
composite of our own foreign key and a discriminator is exactly what ADR-002
refused to call an identity when it gave `taggings` a UUID plus a unique index
on its natural triple. The same reasoning, and the same shape, applies here.
The pair is genuinely unique — a company has one logo — so it is enforced, as
an index rather than as the key. The table is therefore **not** exempt and
carries `created_at` and `updated_at` like every other non-exempt table.

**Absence is the default.** A company with no row for a slot renders the
derived mark and the `hue(name)` gradient it renders today. Clearing a slot is
a `DELETE`, not a write of a sentinel, and there is no `enabled` flag that
could disagree with the bytes. Every column is `NOT NULL`, so a row with an
original and no derivative — or a derivative and no original — cannot exist,
and replacing an image is one upsert on the unique pair in one statement.
Writing an image does **not** touch `companies.updated_at`: the company record
did not change, and the image row carries its own timestamps.

**The original is the last column, on purpose.** SQLite stores a row's
columns in declared order and spills a large row into a chain of overflow
pages; reading a column means walking every page before it. With `bytes`
declared last, the grid's read of `thumb_bytes` walks the handful of overflow
pages a thumbnail occupies and never touches the up-to-256 pages the original
does.
With `bytes` declared first, the same read would walk all of them, for 120
rows, to return the small thing. The Drizzle declaration in `schema.ts` must
keep this order, because `drizzle-kit` emits DDL in declaration order.

`width` and `height` are the original's pixel dimensions, known for free at
write time (`getSize()` in §3) and stored so a view can reserve the banner's
box with `aspect-ratio` before the image decodes. `byte_length` and
`thumb_byte_length` exist for ADR-012's reason: a caller that only wants a size
must not have to load a blob.

### 3. A list reads a stored derivative, never an original — the decision this ADR exists for

Every write stores two renditions in the same row: the bytes the operator
picked, and a **downscaled derivative generated once, in main, at write
time**. The two are read by different callers and nothing else:

| Reader | Channel | Carries | Calls |
|---|---|---|---|
| Companies grid and its table presentation | `companyImages:thumbnails` | every present slot's **derivative**, for every company, as `data:` URLs — a map keyed by company id, present slots only; a company with no images is simply absent | **one**, regardless of how many companies there are |
| Company detail | `companyImages:get` (company id) | that company's two slots, **originals**, `present`/`absent` per slot as `brandingSlotStateSchema` models it, with `width`, `height`, `byteLength`, `updatedAt` | one per detail page |

`companies:list` is unchanged. It is fetched by Activity, Engagements, People,
every sheet and both detail routes for name lookups, and none of them wants an
image; putting even the derivatives on it would make every view pay for the
grid's pictures. Today's rows, the People grid, the palette and the sheets get
no image at all (T-260901-15's Out list); this table has exactly two readers.

**The mark and the banner layer are presentational.** They take a `dataUrl`
(or `null`, meaning "draw the derived fallback") from the view's single query.
Neither issues a read of its own — a mark with its own `useQuery` is a per-card
fetch wearing a component's clothes, and it is the failure T-260901-15's
channel-count assertion exists to catch.

`companyImages:choose` and `companyImages:clear` invalidate both the
thumbnails key and the company's `get` key, so the grid and the header agree
without a reload.

**The derivative, exactly:**

| Slot | Fits inside | Encoded as | `thumb_content_type` |
|---|---|---|---|
| `logo` | 96 × 96 px | PNG — alpha preserved, a mark sits on a surface | `image/png` |
| `banner` | 480 × 270 px | JPEG, quality 75 — opaque, a wash under a gradient | `image/jpeg` |

Fit means `scale = min(1, boxWidth / width, boxHeight / height)`, target
`round(width × scale) × round(height × scale)` (never below 1 px), aspect
preserved, **never upscaled**: a 64 px logo stays 64 px. A 3:1 banner becomes
480 × 160. Every write goes through the same encode step even when no scaling
happens, so the derivative's format is a function of the slot and nothing
else — which is what lets `thumb_content_type` be asserted rather than
sniffed.

**The API is Electron's own `nativeImage`**, verified against
`node_modules/electron/electron.d.ts` (Electron 44.0.0): `nativeImage.createFromBuffer(Buffer)`
decodes, `image.isEmpty()` says whether it did, `image.getSize()` gives
`{ width, height }`, `image.resize({ width, height, quality: 'best' })`
scales, and `image.toPNG()` / `image.toJPEG(75)` encode. It runs in main, where
the bytes already are, and adds no dependency. The wrapper lives in its own
module (`electron/main/images/derive.ts` is the intended home) and the
repository takes it as an injected dependency defaulting to the real one —
the structural-injection pattern `picker.ts` uses for `dialog` — because
`electron` resolves to a path string under plain-Node vitest. Repository
tests inject a fake deriver; the real one is exercised by a test that boots a
throwaway Electron, in the `RUNTIME_BOOT_NODE_FILES` pool `renderer-globals.test.ts`
already sits in.

**The number.** Measured on 2026-09-01 with that Electron, on Windows, from
synthetic sources (a 2400 × 800 photo-like banner, a flat brand-colour banner,
and pure noise at the derivative's own resolution so the downscale has nothing
to average away; a 1024 px flat-shape mark and a gradient mark for the logo):

| | banner, 480 × 270, JPEG q75 | logo, 96 × 96, PNG |
|---|---|---|
| flat / designed | 2.1 KB | 4.5 KB |
| photo-like / real mark | 11.2 KB | 7.2 KB |
| ceiling (pure noise) | 75.8 KB | 36.9 KB (RGBA raw + framing; PNG cannot exceed it) |

So a **60-company grid with every slot filled transfers about 1.5 MB of
base64** in one message — 60 × (11,212 + 7,191) × 4⁄3 ≈ 1,472,000 bytes — and
**cannot exceed 9.0 MB** even if every image is noise (60 × (75,829 + 36,901)
× 4⁄3 ≈ 9,018,000). At §8's 10× figure of 100 companies: 2.5 MB typical,
15 MB ceiling. Against the 83.9 MB the naive read costs under ADR-012's cap —
125.8 MB under the caps below — that is a 56× reduction in the typical case
and 9× in the pathological one. The company detail page, the one reader of
originals, transfers at most 1.5 MB stored → **2.0 MB of base64** for one
company, once, cached by its query key until an upload invalidates it.

T-260901-15's outcome records what the real grid measures at 60 companies,
whatever this table predicts.

### 4. Two caps, declared once

| Slot | Cap | Why this figure |
|---|---|---|
| `logo` | 512 KB (524,288 bytes) | ADR-012's figure for the same kind of image — a mark — and revisable for the same reason |
| `banner` | 1 MB (1,048,576 bytes) | the detail header renders it across the full page width at 76 px tall; a 2400 px-wide JPEG at quality 85 measures ~430 KB, so 1 MB is a generous export and anything larger is an unoptimised one |

Both are declared in one place, `electron/shared/company-images.ts`, as a
record keyed by slot, so the picker's stat-before-read bound, the
repository's post-read check and any UI that quotes a limit read the same
number. They are **not** `BRANDING_MAX_BYTES` re-exported: a company banner
and the rail's wordmark are different things with different read paths, and
tying the two would mean raising one to raise the other.

The caps are no longer arguing about list timing — §3 took that argument away
from them. They bound three things: the detail page's single read (2.0 MB of
base64 at both caps), the decode in §5, and the database growth in
Consequences.

### 5. What is refused: SVG, and — new here — everything `nativeImage` cannot decode from a buffer

**SVG stays refused**, on [`electron/shared/branding.ts`](../../electron/shared/branding.ts)'s
argument, restated and not re-derived: SVG is a scriptable document, and
admitting a document into a `data:` URL the app renders is a strictly larger
surface than admitting pixels. The argument is stronger here than for the
rail, because a banner renders across the whole companies grid — sixty of
them, from sixty sources, on one screen.

**The accepted set is PNG and JPEG.** Narrower than ADR-012's raster set, and
for a reason that did not exist there: a derivative requires a decoder, the
decoder this app has without a new dependency is `nativeImage`, and
`createFromBuffer` "tries to decode as PNG or JPEG" and nothing else — measured
as well as read: a valid GIF and a valid BMP each come back `isEmpty()` from
the same Electron. Accepting WEBP, GIF, BMP or ICO would mean either a second
decoder or a slot with no derivative, and the second is the naive read path
returning one format at a time. The set is declared as a subset checked
against the sniffer's own union
(`satisfies readonly FaviconContentType[]`), not re-listed as fresh literals,
so it cannot compile if `sniffImageContentType` stops returning one of the two.
The type is still decided by `sniffImageContentType` from the bytes' magic
numbers, never by extension and never by anything the renderer says.

**Decoding in main is a new exposure and it is bounded before it happens.**
ADR-012 could say "there is no image decoder in main"; this ADR cannot. A
decoder is only as safe as the size of what it is asked to decode, and a byte
cap does not bound that: a 1 MB PNG can legitimately describe a 256-megapixel
image, and a 1 MB JPEG a larger one, and `createFromBuffer` allocates the
whole bitmap. So, **in this order, all before any decode**: the byte cap, the
magic-number sniff, then the pixel dimensions **read from the container's own
header** — PNG's IHDR (width and height, big-endian, at bytes 16–23) or JPEG's
first SOF marker (`FFC0`/`FFC1`/`FFC2`; height then width in the segment) — and
**an image over 16,777,216 pixels (4096 × 4096 equivalent) is refused** with
a message naming that limit. That bounds the transient decode at 64 MB of
RGBA. A 6000 × 1500 banner is 9 MP and passes; the guard is against bombs,
not photographs. An image that passes all three and still decodes empty is
refused too, so a malformed raster never reaches the renderer at all — a
strictly smaller exposure than ADR-012's, where a file that sniffed as PNG
reached Chromium's decoder in the renderer unexamined.

Every refusal is a `ValidationError` with a hand-written, path-free message,
as the branding path already does; `picker.ts`'s path-leak walker runs over
these channels too (T-260901-12).

### 6. Deletion is a real foreign key with `ON DELETE CASCADE`

`company_images.company_id REFERENCES companies(id) ON DELETE CASCADE` — the
first cascading foreign key in this schema, where every other one is
`ON DELETE no action`.

Not [ADR-011](ADR-011-polymorphic-attachment-cascade.md)'s trigger, and
ADR-011 itself says why: it reached for triggers because "SQLite cannot
express a foreign key with three possible parents," and named the declarative
form it would otherwise have used — "the case where a foreign key would have
been declared `ON DELETE CASCADE`." This table has one parent. The engine can
express the cascade, so the engine does; a trigger here would be a second
mechanism for a case the first one handles, and it would grow
`referential-guard.ts`'s attachment list — whose test asserts a trigger per
polymorphic table — by a member that is not polymorphic.

An image is an attachment in ADR-011's sense — a property *of* the company,
meaningless without it, referenced by nothing — so it cascades rather than
blocks. What follows for the code:

- **`deleteCompany`'s `refuseIfReferenced` list does not gain this table.**
  Its header says it names "every foreign key migration 0001 points at
  `companies.id`"; this is the one later foreign key that is deliberately not
  a blocker, and the migration's own comment says so.
- The cascade fires because `connection.ts` sets `PRAGMA foreign_keys = ON`
  per connection. `migrate.ts` turns the pragma off around each migration,
  which is irrelevant at runtime and right during one.
- It covers every deleter, including `seed/index.ts` and any future importer
  that never calls `deleteCompany` — ADR-011's reason for preferring the
  engine over repository code, inherited.
- **The create side comes free.** A row cannot name a company that does not
  exist: SQLite raises `SQLITE_CONSTRAINT_FOREIGNKEY`. The repository
  pre-checks anyway and throws `NotFoundError('Company', id)`, because the
  raw constraint error is neither actionable nor path-free and T-260901-12
  requires the refusal to say nothing beyond "no such company."
- The Drizzle declaration carries `onDelete: 'cascade'` so the snapshot drift
  test agrees with the migration.
- Tested by deleting a company that holds both slots and counting
  `company_images` rows, not by reading the DDL.

## Consequences

**Easier — the grid's cost is a fixed small number, not a function of the
operator's export settings.** 1.5 MB typical and 9 MB at worst for sixty
companies, one message, cached. The seeded database and a real one now
behave the same way, which is the property the scoping task was written to
get.

**Easier — the original is the source of truth and the derivative is a
cache that can be rebuilt.** If 480 × 270 turns out wrong, a migration
regenerates every `thumb_bytes` from `bytes` and nothing the operator uploaded
is lost. That is why the original is kept at all rather than replaced by the
derivative on write.

**Harder — the database grows, and the nightly export copies it.** Sixty
companies with both slots at both caps is about 95 MB of blobs in a database
that is otherwise a few megabytes of text. The nightly JSON export (§8, X-04,
not yet built) copies tables, JSON has no byte type, so those blobs become
base64: **~127 MB per export, ~3.8 GB across the 30 retained.** Realistically
— a third of companies with images, ~200 KB originals — it is 5 MB and a
rounding error, but the ceiling is stated here so X-04 decides how to treat
blob-bearing tables (`favicons`, `branding` and this one) with the number in
hand rather than discovering it on the first full export. Replacing an image
leaves free pages behind, which §6.12's `VACUUM` action already reclaims.

**Harder — main decodes images.** A decoder crash in main is an app crash
where the same crash in the renderer was a tab crash. Accepted: the decoder is
Chromium's own, already in the process; the input is an operator-picked local
file under a byte cap, a magic-number sniff and a pixel-count guard; and the
alternative — a separate native decoder dependency — is a larger and less
audited surface than the one already shipped.

**Cost — a banner with transparency comes out with a black background on the
card.** JPEG has no alpha; transparent pixels encode as black. The card
surface is near-black and the image sits under a gradient, so this reads as
the wash it is meant to be, but it is a visible difference from the detail
header, which shows the original. Stated rather than solved: PNG banners
measure 8× larger in the photo-like case for a wash nobody looks at closely.

**Cost — HiDPI softness on wide cards.** 480 px covers the 290 px minimum
card at 1.65× and a stretched card at less. Under the gradient mask that is
the design, not a defect; if a sharper wash is ever wanted the fix is the
regenerate-from-originals migration above, not a wider read.

**Cost — WEBP is refused for company images though the rail accepts it.**
Two operator-supplied image sets with different accepted formats is one more
thing to explain. Revisable the day `nativeImage` decodes WEBP from a buffer;
until then a WEBP banner is a re-export away.

**Forecloses a per-slot history and any format the app cannot decode.** As
ADR-012: writing overwrites, `updated_at` answers the only question asked.

**ADR-012 is extended, not superseded.** Its decision stands in full for the
`branding` table; what changes is the scope of one sentence. "Two rows at
most, ever" is a claim about `branding` and must read that way to someone who
finds ADR-012 first, so it gains a pointer here. Its cap argument — read timing
at startup — does not transfer to this table and this ADR does not reuse it.

## Alternatives

**Read every original into the grid, at ADR-012's cap.** 83.9 MB of base64
for sixty companies. The option this ADR exists to refuse, and the one that is
indistinguishable from the right answer on the development database.

**A per-company request the card issues lazily.** Sixty IPC round trips on
mount, cards that pop in one at a time, and — the actual defect — the same
originals still cross the wire, merely spread out: scrolling the grid transfers
all 83.9 MB eventually. It is also the exact pattern T-260901-15's
channel-count assertion is written to catch. Lost.

**A list channel returning images only for the rows asked for.** The grid
has no virtualisation and renders every row, so the rows asked for are all
rows and the number does not move. It would only help with a windowed grid
§6.13 does not ask for. Lost — though `companyImages:thumbnails` can grow an
optional id list the day virtualisation arrives, without changing what it
returns per row.

**A cap low enough that the naive read is fine.** To hold a 60-company grid
near 2 MB of base64 the cap is about 12 KB per image. That is a favicon. A
12 KB banner across a 1200 px detail header is the feature not shipping. Lost.

**A derivative — chosen. Sub-choices that lost:**

- *Keep only the derivative.* The detail header needs the resolution, and a
  change to the derivative's spec would be unrecoverable. Lost.
- *Generate the derivative on read.* Decodes and resizes 120 images on every
  grid load, and has to read the originals to do it — the cost being avoided,
  plus a CPU cost. Lost.
- *A second table for derivatives.* Two rows per slot to keep in step, a
  transaction where one `INSERT` does, and nothing gained: with the original
  declared last, co-location costs the thumbnail read nothing. Lost.
- *Bigger derivatives.* 640 × 360 measures 17 KB photo-like and 133 KB at the
  noise ceiling — 1.5× and 1.8× the chosen size for sharpness the gradient
  mask hides. *Smaller* — 320 × 180 at 6.8 KB — reads visibly soft on any card
  wider than the minimum. 480 × 270 is the middle, chosen against the numbers.
- *PNG banners.* Alpha would survive, at 93 KB against 11 KB photo-like. Lost
  to an 8× cost for a wash.

**A native image library (`sharp` or similar) for decoding, so WEBP and the
rest could be accepted.** A native build dependency on Windows, a second
decoder next to the one Chromium already ships in the process, and its own
security surface — for one resize. Lost; revisable if the accepted-format gap
ever matters to an operator.

**Accept the full raster set and skip the derivative where the decoder
returns empty.** Reintroduces the naive read one format at a time, and makes
acceptance depend on the platform's decoder rather than on a stated rule.
Lost.

**Files in the data root.** Lost on ADR-012's three counts unchanged — a
second path outside the sync-folder guard, outside the table-copying backup,
without an atomic replace — and on a fourth that is new: 120 files whose
existence has to agree with 120 rows.

**A polymorphic trigger cascade, extending migration 0004.** Lost because the
table is not polymorphic; §6 has the argument, and ADR-011 made it first.

**A composite natural primary key `(company_id, slot)`.** Lost on ADR-002's
membership test and on the `taggings` precedent; §2 has the argument.
