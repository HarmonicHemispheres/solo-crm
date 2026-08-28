---
paths:
  - "electron/renderer/**/*.{ts,tsx,css}"
  - "src/**/*.{ts,tsx,css}"
  - "**/*.css"
---

# UI design principles

[planning/solo-crm-mockup.html](../../planning/solo-crm-mockup.html) is the
authoritative visual spec — open it before building a view. Colour, type,
spacing, radii and motion timings come from `tokens.css`, lifted from the
mockup; use the tokens rather than literal values.

**Show, don't tell.** Prefer a ring, bar, chart, favicon, logo, status dot or
sparkline to a sentence describing the same fact. A cadence ring in its `late`
band beats "last contacted 21 days ago, cadence is 14 days." Colour carries
meaning — section, company, billing model, status — never decoration. Verdigris
is the working accent; gold marks exactly one hero value per view.

**Spend text sparingly.** Cut anything a graphic already says, and anything a
label already says. Numbers take a unit, not a sentence. Dates, counts and IDs
are metadata: mono, small, `--faint`.

**Icon buttons by default.** Reserve text labels for the primary action of a
view or sheet, destructive confirmation, and anything whose icon would be a
guess rather than a convention. Icon-only controls need an `aria-label` — the
icon is the affordance for sighted users, the label for everyone else. Icons are
inline SVG on `currentColor`; no icon fonts, no package pulled in for three
glyphs.

**Responsive by construction.** Everything works from a maximised desktop down
to ~700px. The mockup's breakpoints are the contract: at 900px the rail goes
off-canvas and two-column sheets collapse; at 700px hover-revealed row actions
stay visible, because there is no hover on touch. Grids collapse rather than
scroll sideways, and the page body never scrolls horizontally.

**Five to seven primary regions per view.** A stat row counts as one, a table
counts as one. Today is: hero metrics · Going quiet · Next up · revenue chart ·
linked systems — five, and that is the ceiling rather than the starting point.
Past that, something merges or moves behind a tab, sheet or detail route. Detail
belongs on the record, not the index. A new feature is not a new top-level
section; there are eleven views and a twelfth needs a reason.

**Whitespace is the layout.** Generous padding, real gaps between regions.
Compact density is a setting the user opts into, not the default.

Accessibility is a v1 requirement, not a polish pass — keyboard operation,
visible focus rings, and `prefers-reduced-motion` that removes animation without
removing meaning (decay bars still render at their final width). See
[requirements §8](../../planning/solo-crm-requirements.md).
