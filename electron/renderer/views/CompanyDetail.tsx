import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type SVGProps } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { nowTimestamp, parseDateOnly, parseTimestamp } from '../../shared/format'
import type { Company, CompanyKind } from '../../shared/companies'
import {
  COMPANY_IMAGE_SLOTS,
  type CompanyImageSlot,
  type CompanyImageSlotState,
  type CompanyImagesSnapshot
} from '../../shared/company-images'
import type { BillingModel, EngagementStatus, EngagementWithOffering } from '../../shared/engagements'
import type { Task } from '../../shared/tasks'
import type { Activity } from '../../shared/activity'
import { resolveTimelineKind, type TimelineKind } from '../../shared/timeline'
import { useTimelineKinds } from '../lib/timeline'
import { TimelineKindIcon } from '../components/timeline/TimelineKindTag'
import type { Person, PersonAffiliation, PersonWithAffiliations } from '../../shared/people'
import { ipcMutationFn, ipcQueryFn, unwrapMutationResult } from '../lib/ipc'
import { decayForCompany, type Decay } from '../lib/decay'
import { identityColor as hue, initials } from '../lib/identity'
import { invalidate, queryKeys } from '../lib/query-keys'
import { Card } from '../components/primitives/Card'
import { Section } from '../components/primitives/Section'
import { Button } from '../components/primitives/Button'
import { ModelTag, type BillingModel as ModelTagBillingModel } from '../components/primitives/ModelTag'
import { Tag, type TagVariant } from '../components/primitives/Tag'
import { EmptyState } from '../components/primitives/EmptyState'
import { ConfirmDelete } from '../components/primitives/ConfirmDelete'
import { Toast } from '../components/primitives/Toast'
import { Toggle } from '../components/primitives/Toggle'
import { Row } from '../components/primitives/Row'
import { IconButton } from '../components/primitives/IconButton'
import { PlusIcon } from '../components/icons'
import { LinkFavicon, LinksCard } from '../components/links/LinksCard'
import { localToday } from './todo-urgency'
import { useLayerManager, type LayerManagerContextValue } from '../components/shell/layer-manager-context'
import './detail-header.css'
import './CompanyDetail.css'

/**
 * `/company/:id` (T-260828-29) — the view that proves split billing is real:
 * *billed here* and *delivered here, billed elsewhere* have to read
 * correctly from either side of the same engagement row. See this task's
 * Risks: the two sections are two independently server-filtered
 * `engagements:list` calls (`billingCompanyId` / `clientCompanyId`), not one
 * unfiltered list sliced two ways in this component — that shortcut is
 * exactly the bug whose page still looks plausible.
 *
 * T-260828-30 adds the rest of this page below: todos (with the one
 * exclusive-per-company next step, promoted through `tasks:setNextStep`),
 * the append-only activity timeline (merged from three independently-
 * filtered `activity:list` calls — company, its people, its engagements —
 * for the same reason "billed here"/"delivered here" above are two calls
 * and not one sliced client-side), and contacts (current affiliations only,
 * historical ones behind a disclosure). Links and any revenue or hours
 * figure are still out of this page's scope — ADR-003 puts every revenue
 * question through `revenue_lines`, not per-billing-model branching
 * rendered here.
 */

// ---------------------------------------------------------------------------
// Local display helpers — `hue`/`initials`/`mark` are planning/solo-crm-
// mockup.html's own page-level helpers (lines ~928-934), kept local to this
// view rather than promoted to a shared module: no other view exists yet to
// share them with, and T-260828-28 (Companies view) is an independent
// concurrent branch — see this task's worktree notes.
// ---------------------------------------------------------------------------



type StyleWithAccent = CSSProperties & { '--c': string }

/**
 * The derived mark, and — since T-260901-14 — the company's own logo where
 * one has been set. `imageUrl` is optional and only this view's own header
 * passes it: the mark is used at three sizes across three views, and teaching
 * a *shared* one to render an image would change the companies grid and the
 * table row too, which is T-260901-15's territory (this task's Risks). So the
 * image-aware mark stays local here, exactly as `hue`/`initials` did.
 *
 * Absence is the default rather than a state to design (ADR-015): no image is
 * the initials, computed at render time, which is also what a company with no
 * images looked like before this existed.
 *
 * `alt=""` because the mark is decorative in the only place it renders an
 * image — the `<h1>` beside it names the company, so a logo with an alt text
 * would announce the name twice.
 */
function CompanyMark({ name, size, color, imageUrl }: { name: string; size: number; color: string; imageUrl?: string | null }) {
  return (
    <span
      className={imageUrl != null ? 'cmark has-image' : 'cmark'}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.37), color }}
    >
      {imageUrl != null ? <img className="cmark-img" src={imageUrl} alt="" /> : <span>{initials(name)}</span>}
    </span>
  )
}

/** The mockup's `VIA_ICON` (planning/solo-crm-mockup.html line ~939) — a
 * small "redirected" glyph in front of every billed-elsewhere marker. */
function ViaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--lapis)" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" width={11} height={11}>
      <path d="M7 7h6a4 4 0 014 4v6M17 17l-3-3M17 17l3-3" />
    </svg>
  )
}

/** The "sold as" marker (T-260901-13) — the same price-tag glyph the
 * Engagements view draws beside the same label, kept local for the same
 * reason `ViaIcon` is. */
function SoldAsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--lapis)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width={11} height={11}>
      <path d="M11.5 3.5H20v8.5l-8.7 8.7a1.6 1.6 0 0 1-2.3 0l-6.2-6.2a1.6 1.6 0 0 1 0-2.3Z" />
      <path d="M16.5 7.5h.01" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// T-260828-30's own icons — a view's per-kind glyphs stay with the view that
// uses them (components/icons.tsx's own header), same as `ViaIcon` above.
// ---------------------------------------------------------------------------

/** The todo checkbox glyph — mockup's `.check svg` path, styled entirely by
 * `.check`/`.check svg` in CompanyDetail.css rather than inline props. */
function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** "Promote to next step" — new UI with no mockup source (this task's Risks:
 * the mockup never shows how a next step gets chosen). A flag, not a star:
 * `.nextbadge` already reads "next step" in text, so the glyph only needs to
 * read as "mark this" rather than borrow a meaning (favourite, priority)
 * that isn't what this button does. */
function NextStepIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 3v18" />
      <path d="M6 4h12l-3.5 4L18 12H6" />
    </svg>
  )
}

// The glyphs and the label this card used to declare here — as
// `Record<ActivityKind, …>` maps over what was then a closed four-value enum
// — moved to `components/timeline/TimelineKindTag.tsx` when the category
// became the operator's own editable list. A total map over a set the user
// can add to renders *nothing at all* for a category they invented, silently;
// `TimelineKindIcon`/`TimelineKindTag` fall back instead. PersonDetail.tsx
// held a byte-identical copy of the same glyphs and now imports the same one.

const KIND_LABEL: Record<CompanyKind, string> = {
  client: 'Client',
  prospect: 'Prospect',
  end_client: 'End client',
  advisory: 'Advisory',
  channel: 'Channel'
}

const KIND_TAG_VARIANT: Record<CompanyKind, TagVariant> = {
  client: 'verd',
  prospect: 'gold',
  end_client: 'lapis',
  advisory: 'lapis',
  channel: 'lapis'
}

const STATUS_LABEL: Record<EngagementStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  proposed: 'Proposed',
  held: 'Held',
  delivered: 'Delivered',
  lost: 'Lost'
}

const STATUS_TAG_VARIANT: Record<EngagementStatus, TagVariant> = {
  active: 'green',
  pending: 'orange',
  proposed: 'orange',
  held: 'gold',
  delivered: 'default',
  lost: 'red'
}

const MODEL_LABEL: Record<BillingModel, string> = {
  retainer: 'Retainer',
  fixed: 'Fixed',
  tm: 'T&M',
  equity: 'Equity',
  none: '—'
}

/** `ModelTag` only draws the four models that get a colour (mockup's `.m-*`
 * set) — `'none'` has no swatch of its own, so an engagement with no
 * billing model just shows no model pill rather than a blank grey one. */
function isTaggableModel(model: BillingModel | null): model is ModelTagBillingModel {
  return model != null && model !== 'none'
}

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** UTC-formatted so a `YYYY-MM-DD` value never shifts a day under a
 * negative-UTC-offset local timezone (see `electron/shared/format.ts`'s own
 * header on exactly this bug). */
function formatMonthYear(dateOnly: string): string {
  return MONTH_YEAR_FORMAT.format(parseDateOnly(dateOnly))
}

/**
 * `endsOn: null` means rolling, never a blank or a missing date (this
 * task's Risks, and `electron/shared/engagements.ts`'s header) — the one
 * place that meaning is rendered.
 */
function formatRange(startedOn: string, endsOn: string | null): string {
  return `${formatMonthYear(startedOn)} → ${endsOn ? formatMonthYear(endsOn) : 'rolling'}`
}

const DAY_MS = 24 * 60 * 60 * 1000

// Cadence state for the header's `DecayMeter` is `lib/decay.ts`'s
// `decayForCompany` — the same call Today.tsx and Companies.tsx make
// (T-260901-27). This page kept its own `cadenceState` until then, and while
// it agreed with `decay.ts` on flooring, it did not agree on the two things
// that matter:
//
//   - It read the company's own `cadenceDays` and nothing else, so a company
//     with none — the "Not set" chip the company sheet deliberately offers —
//     drew a full red bar here while Today, which falls back to the kind's
//     default cadence from settings (P2-03), called the same company current.
//   - Its never-touched label was "no contact logged" against `decay.ts`'s
//     "never". Both are honest; two of them for one state is the problem.
//
// The ADR-001 guard the old function carried a paragraph about is not lost —
// it moved into `decayForCompany`, which returns `POSITIVE_INFINITY` for a
// null `lastTouchAt` for exactly the same stated reason, and `decay.test.ts`
// holds it there. `CompanyDetail.test.tsx`'s assertion on the meter's `late`
// class for an untouched company is unchanged and still passes, which is the
// evidence that the guard survived the move rather than the claim that it did.

// ---------------------------------------------------------------------------
// Todos — due-date / waiting-since formatting, mockup's `dueInfo()`
// (planning/solo-crm-mockup.html line ~795) reproduced against this app's
// own date helpers rather than the mockup's ad hoc `new Date(d+'T09:00:00')`.
// ---------------------------------------------------------------------------

const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** UTC-formatted for the same reason `formatMonthYear` above is: a
 * `dateOnly` value must never shift a day under the caller's local
 * timezone. */
function formatMonthDay(dateOnly: string): string {
  return MONTH_DAY_FORMAT.format(parseDateOnly(dateOnly))
}

/**
 * Today's date as a LOCAL calendar `YYYY-MM-DD` string — deliberately the
 * one place in this file that reads local `Date` accessors rather than
 * UTC ones. "Today" is inherently the viewer's local calendar day, the
 * same way `dueOn` itself is calendar-date data with no time zone
 * attached — see `daysSinceDateOnly` below for why comparing it this way
 * matters.
 */
function localDateOnly(now: number): string {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * A `dateOnly` value's age in days as of `now` — positive once it's in the
 * past. Review fix: this used to be `Math.floor((now -
 * parseDateOnly(dateOnly).getTime()) / DAY_MS)`, subtracting a
 * UTC-midnight instant (`dueOn`) from a raw epoch-millis wall-clock
 * instant (`now`) — two different time frames. For any viewer west of
 * UTC, once local time crosses into the next UTC calendar day (~17:00
 * local at UTC-7), that mixing reads every due date one day later than
 * the viewer's actual local calendar day. Comparing calendar date to
 * calendar date instead — `today` derived locally via `localDateOnly`,
 * both sides then parsed to a UTC-midnight instant via `parseDateOnly` —
 * keeps the difference a whole number of calendar days regardless of
 * what hour it currently is.
 */
function daysSinceDateOnly(dateOnly: string, now: number): number {
  const todayMs = parseDateOnly(localDateOnly(now)).getTime()
  return Math.round((todayMs - parseDateOnly(dateOnly).getTime()) / DAY_MS)
}

/** A full timestamp's age in days as of `now` — `waitingSince` is a
 * `timestampSchema` value (an instant), not a `dateOnly`, so it parses with
 * `parseTimestamp`, not `parseDateOnly`. */
function daysSinceTimestamp(timestamp: string, now: number): number {
  return Math.floor((now - parseTimestamp(timestamp).getTime()) / DAY_MS)
}

interface DueInfo {
  readonly cls: 'over' | 'soon' | 'later' | 'wait'
  readonly label: string
}

/**
 * Mockup's `dueInfo()`: a `waiting` task reads its age off `waitingSince`
 * (§6.6/requirements: waiting items are excluded from the owed count but
 * age visibly), everything else off `dueOn`. `cls` and `label` are each the
 * mockup's own ternary chain, kept as two separate chains rather than
 * merged into one lookup — the mockup itself computes them independently
 * off the same `d`, and collapsing them would have to invent a combined
 * table the mockup doesn't have.
 */
function taskDueInfo(task: Task, now: number): DueInfo {
  if (task.status === 'waiting') {
    const days = task.waitingSince != null ? Math.max(daysSinceTimestamp(task.waitingSince, now), 0) : 0
    return { cls: 'wait', label: `waiting ${days}d` }
  }
  if (task.dueOn == null) return { cls: 'later', label: 'no date' }
  const d = daysSinceDateOnly(task.dueOn, now)
  const cls = d > 0 ? 'over' : d === 0 ? 'soon' : d >= -7 ? 'soon' : 'later'
  const label = d > 0 ? `${d}d overdue` : d === 0 ? 'today' : d === -1 ? 'tomorrow' : formatMonthDay(task.dueOn)
  return { cls, label }
}

// ---------------------------------------------------------------------------
// Activity — `occurredAt` is a genuine instant (`timestampSchema`), not a
// `dateOnly` value, so it is deliberately formatted in the viewer's local
// time (no `timeZone: 'UTC'` override) rather than reusing the UTC-pinned
// formatters above — there is no "which calendar day does this string mean"
// question for an instant the way there is for a `dateOnly` value.
// ---------------------------------------------------------------------------

const ACTIVITY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

function formatActivityDate(occurredAt: string): string {
  return ACTIVITY_DATE_FORMAT.format(parseTimestamp(occurredAt))
}

/**
 * Review fix (item 3): true when `occurredAt` falls inside the affiliation's
 * own window — `started` through `ended` inclusive, or open-ended for a
 * still-current affiliation. Without this bound, `relevantPersonIds` pulled
 * in EVERY activity row tied to a person once they had ever been affiliated
 * with this company — including a *former* contact's activity from after
 * they left, logged against whatever company they moved to next, leaking
 * it onto their old company's timeline. `ended` is a calendar date, so its
 * whole day still counts as affiliated.
 */
function withinAffiliationWindow(occurredAt: string, affiliation: PersonAffiliation): boolean {
  const occurred = parseTimestamp(occurredAt).getTime()
  if (occurred < parseDateOnly(affiliation.started).getTime()) return false
  return affiliation.ended == null || occurred < parseDateOnly(affiliation.ended).getTime() + DAY_MS
}

// ---------------------------------------------------------------------------
// Details card — read-only since T-260901-14.
//
// **The company sheet is the authoritative writer for every column on this
// card.** That decision is this task's own requirement, and the reason is its
// Risks section: inline editing here and a form over the same six columns
// (kind, website, cadence, since, budget note, notes) is two writers with two
// validations and two error surfaces, and they drift. One of them had to stop
// writing, and the one that stops is this card — the sheet is the path the
// header's Edit button makes discoverable, it is the shape every other entity
// in the app is already edited through, and it can say "name is required"
// against a named field, which a click-a-value-to-type-in-it row cannot do at
// all (it has no way to render the name).
//
// So this card holds no mutation, no `companies:update` call and no control
// that writes — asserted in CompanyDetail.test.tsx, so the two cannot
// silently become two writers again. `PersonDetail` keeps its own inline
// editing; person detail is explicitly out of this task's scope, and the same
// question there is a decision that has not been made yet.
// ---------------------------------------------------------------------------

/**
 * **What this card holds, and what the header holds instead.**
 *
 * The card used to list all nine stored fields, every unset one an em-dash
 * row — so a company with three facts recorded drew nine rows, six of them
 * saying nothing, and the four that identify a relationship (when it
 * started, how often to reach out, when you last did, who invoices) were
 * buried among them at the bottom of the page.
 *
 * Those four are now the header's own fact line, which is where someone
 * arriving on the page looks. What is left here is the reference material:
 * kind, site, who introduced them. **An unset field is not a row.**
 * It joins the one "+ Add …" line at the foot, which opens the same edit
 * sheet every other write on this page opens — so nothing is hidden, and
 * nothing empty takes a row's worth of height to say so.
 *
 * "Introduced by" is a person (migration 0009) and links to their page in
 * People. The budget note is gone with its field — the operator asked for
 * it to go from the form, and a fact the form cannot edit has no business
 * on a card the form is the only writer for.
 */
const OPTIONAL_FIELD_LABEL = {
  website: 'website',
  introducedByPersonId: 'introduced by'
} as const
type OptionalFieldKey = keyof typeof OPTIONAL_FIELD_LABEL

/**
 * The website as a link, wearing its host's favicon. `LinkFavicon` is the
 * links card's own slot — the same read of main's cache, the same fixed
 * box so the row never moves when the icon lands, the same `web` fallback
 * — because a website *is* a link and has the same reason to be
 * recognisable at a glance. `target="_blank"` routes through the
 * window-open guard to the operator's browser (LinksCard.tsx's third
 * commitment). A bare host with no scheme is opened over https, which is
 * what the links card does with a typed URL too.
 */
function WebsiteRow({ website }: { website: string }) {
  const href = /^[a-z][a-z0-9+.-]*:/i.test(website) ? website : `https://${website}`
  return (
    <div className="field">
      <span className="k">Website</span>
      <span className="v website">
        <LinkFavicon url={href} kind="web" />
        <a className="mono" href={href} target="_blank" rel="noopener noreferrer">
          {website}
        </a>
      </span>
    </div>
  )
}

function DetailsCard({ company, peopleById }: { company: Company; peopleById: Map<string, Person> }) {
  const { editSheet } = useLayerManager()
  const introducedBy = company.introducedByPersonId != null ? peopleById.get(company.introducedByPersonId) : undefined
  const missing = (Object.keys(OPTIONAL_FIELD_LABEL) as OptionalFieldKey[]).filter((key) => company[key] == null)

  return (
    <Section title="Details" actions={<EditLink company={company} onEdit={editSheet} label={`Edit ${company.name}'s details`} />}>
      <Card>
        <div className="field">
          <span className="k">Kind</span>
          <span className="v">{company.kind != null ? KIND_LABEL[company.kind] : 'Not set'}</span>
        </div>
        {company.website != null && <WebsiteRow website={company.website} />}
        {company.introducedByPersonId != null && (
          <div className="field">
            <span className="k">Introduced by</span>
            <span className="v">
              <Link to={`/person/${company.introducedByPersonId}`}>{introducedBy?.name ?? company.introducedByPersonId}</Link>
            </span>
          </div>
        )}
        {missing.length > 0 && (
          <button
            type="button"
            className="field-add"
            onClick={(event) => editSheet('company', company.id, event.currentTarget)}
          >
            + Add {missing.map((key) => OPTIONAL_FIELD_LABEL[key]).join(', ')}…
          </button>
        )}
      </Card>
    </Section>
  )
}

/**
 * Notes, out of the field list and into their own card.
 *
 * A note is prose — the sentence explaining why invoices go through someone
 * else, what the client actually wants — and it was rendered in a
 * `.field`'s value cell, a column sized for "90 days". It read as a
 * squeezed fragment of something longer. Its own card gives it the width of
 * the column and lets it wrap, and gives the empty case somewhere to invite
 * a first note rather than printing an em dash.
 */
function NotesCard({ company }: { company: Company }) {
  const { editSheet } = useLayerManager()
  return (
    <Section title="Notes" actions={<EditLink company={company} onEdit={editSheet} label={`Edit ${company.name}'s notes`} />}>
      <Card>
        {company.notes != null && company.notes.trim() !== '' ? (
          <p className="notes-body">{company.notes}</p>
        ) : (
          <button type="button" className="field-add" onClick={(event) => editSheet('company', company.id, event.currentTarget)}>
            + Add a note
          </button>
        )}
      </Card>
    </Section>
  )
}

/** The quiet "Edit" a card header carries — the same edit sheet the hero's button opens, reached from the card whose contents it changes. */
function EditLink({
  company,
  onEdit,
  label
}: {
  company: Company
  onEdit: LayerManagerContextValue['editSheet']
  label: string
}) {
  return (
    <button type="button" className="card-edit" aria-label={label} onClick={(event) => onEdit('company', company.id, event.currentTarget)}>
      Edit
    </button>
  )
}

// ---------------------------------------------------------------------------
// Engagement cards — billed here / delivered here, billed elsewhere
// ---------------------------------------------------------------------------

/**
 * One engagement, as the mockup's `.row`: the name, one line under it, the
 * tags on the right. The line is the facts in reading order — model, what it
 * was sold as, when — separated by dots rather than stacked as three rows
 * each with its own glyph; a row that took four lines to say "retainer, sold
 * as consulting, Sep 26 → Dec 26" was most of why the old grid ran out of
 * room. The "sold as" clause keeps its name and its rule (T-260901-13): a
 * name, never a rate. Who is billed sits with the status on the right, as
 * the tag it is, with the redirect glyph that means "elsewhere".
 */
function EngagementRow({ engagement, viaLabel }: { engagement: EngagementWithOffering; viaLabel: string | null }) {
  const facts: ReactNode[] = []
  if (engagement.billingModel != null && engagement.billingModel !== 'none') facts.push(MODEL_LABEL[engagement.billingModel])
  if (engagement.offeringName != null) {
    facts.push(
      <span className="sold-as" key="sold-as">
        <SoldAsIcon />
        sold as {engagement.offeringName}
      </span>
    )
  }
  facts.push(formatRange(engagement.startedOn, engagement.endsOn))
  return (
    <div className="eng">
      <div className="eng-body">
        <div className="eng-t trunc">{engagement.name}</div>
        <div className="eng-s">
          {facts.map((fact, index) => (
            <span key={index} className="eng-fact">
              {fact}
            </span>
          ))}
        </div>
      </div>
      <div className="eng-r">
        {viaLabel != null && (
          <span className="tag via">
            <ViaIcon />
            {viaLabel}
          </span>
        )}
        {isTaggableModel(engagement.billingModel) && (
          <ModelTag model={engagement.billingModel}>{MODEL_LABEL[engagement.billingModel]}</ModelTag>
        )}
        {engagement.status != null && <Tag variant={STATUS_TAG_VARIANT[engagement.status]}>{STATUS_LABEL[engagement.status]}</Tag>}
      </div>
    </div>
  )
}

function EngagementCard({
  title,
  count,
  engagements,
  viaLabelFor
}: {
  title: string
  count: number
  engagements: readonly EngagementWithOffering[]
  viaLabelFor: (engagement: EngagementWithOffering) => string | null
}) {
  const { openSheet } = useLayerManager()
  return (
    <Section
      title={title}
      count={count}
      actions={
        <IconButton aria-label="New engagement" title="New engagement" onClick={(event) => openSheet('engagement', event.currentTarget)}>
          <PlusIcon />
        </IconButton>
      }
    >
      <Card>
        {engagements.length === 0 ? (
          <EmptyState>Nothing here yet.</EmptyState>
        ) : (
          engagements.map((engagement) => <EngagementRow key={engagement.id} engagement={engagement} viaLabel={viaLabelFor(engagement)} />)
        )}
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// End clients
// ---------------------------------------------------------------------------

function EndClientsCard({ companyName, endClients }: { companyName: string; endClients: readonly { company: Company; engagementCount: number }[] }) {
  return (
    <Section
      title="End clients"
      count={endClients.length}
      caption={
        <>
          <ViaIcon /> revenue rolls up to {companyName}
        </>
      }
    >
      <Card>
        {endClients.map(({ company, engagementCount }) => (
          <Link key={company.id} to={`/company/${company.id}`} className="endrow">
            <CompanyMark name={company.name} size={30} color={hue(company.name)} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="nm trunc" style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
                {company.name}
              </span>
              <span className="meta">
                {engagementCount} engagement{engagementCount === 1 ? '' : 's'}
              </span>
            </span>
          </Link>
        ))}
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Todos — T-260828-30. The next step (`is_next_step`, exclusive per company,
// T-260828-23) is pulled out of the ordinary list into its own block above
// it: a structural and textual distinction (position plus the `.nextbadge`
// "next step" label), not a colour alone — `.claude/rules/ui-design.md`'s
// rule this task's Risks section names explicitly.
// ---------------------------------------------------------------------------

/**
 * Review fix (item 2): this block used to render only the badge, title and
 * due label — the one todo the page exists to draw attention to was the
 * only one with no way to tick it off or hand the marker to another task.
 * `onComplete`/`onPromote` give it the exact same inline controls
 * `TodoRow` below renders, wrapped in the same `.sub` layout that row uses
 * for its checkbox/due/promote trio (`.next-step-block .sub` in
 * CompanyDetail.css mirrors `.todo .sub`, since this block isn't a `.todo`
 * row itself).
 */
function NextStepBlock({
  task,
  now,
  onComplete,
  onPromote
}: {
  task: Task
  now: number
  onComplete: (id: string) => void
  onPromote: (id: string) => void
}) {
  const due = taskDueInfo(task, now)
  return (
    <div className="next-step-block">
      <span className="nextbadge">next step</span>
      <div className="next-step-title">{task.title}</div>
      <div className="sub" style={{ marginTop: 6 }}>
        <button
          type="button"
          className={task.status === 'waiting' ? 'check wait' : 'check'}
          onClick={() => onComplete(task.id)}
          aria-label={`Mark "${task.title}" done`}
        >
          <CheckIcon />
        </button>
        <span className={`due ${due.cls}`}>{due.label}</span>
        <IconButton aria-label={`Set "${task.title}" as next step`} onClick={() => onPromote(task.id)}>
          <NextStepIcon />
        </IconButton>
      </div>
    </div>
  )
}

function TodoRow({
  task,
  now,
  onComplete,
  onPromote
}: {
  task: Task
  now: number
  onComplete: (id: string) => void
  onPromote: (id: string) => void
}) {
  const due = taskDueInfo(task, now)
  return (
    <div className="todo">
      <button
        type="button"
        className={task.status === 'waiting' ? 'check wait' : 'check'}
        onClick={() => onComplete(task.id)}
        aria-label={`Mark "${task.title}" done`}
      >
        <CheckIcon />
      </button>
      <span className="tx">
        {/* The same `.tli-k` chip an activity row carries, so a reader can
            tell a plan from a record at a glance now that the two share one
            list — the checkbox alone is a control, not a label. */}
        <span className="tli-k todo-k">Todo</span>
        {task.title}
        <span className="sub">
          <span className={`due ${due.cls}`}>{due.label}</span>
        </span>
      </span>
      <IconButton aria-label={`Set "${task.title}" as next step`} onClick={() => onPromote(task.id)}>
        <NextStepIcon />
      </IconButton>
      <span className="tli-when">{formatActivityDate(task.createdAt)}</span>
    </div>
  )
}

/**
 * **One feed, not two cards.**
 *
 * Todos and touches were two cards side by side, each with its own list,
 * its own count and its own quick-add strip — and between them they told
 * one story out of order. What happened with this company, most recent
 * first, is a single sequence: you called them, you sent the summary, you
 * owe them a scope. Splitting it by whether an entry is a *plan* or a
 * *record* meant reading two columns and interleaving them by eye.
 *
 * So this card holds both, sorted newest first on one clock: an activity
 * row by when it happened (`occurred_at`), a todo by when it was written
 * (`created_at`). A todo also carries its due label, which is the thing a
 * plan has that a record does not.
 *
 * **The two writes stay two writes.** The quick-add strip has a Touch/Todo
 * switch, and each side calls exactly the channel it always did —
 * `activity:log` (append-only, G8, and the only writer of
 * `companies.last_touch_at`) or `tasks:create`. Merging the *display* of
 * two tables must not merge their vocabularies: nothing here writes an
 * activity row to represent a todo, or the reverse.
 *
 * The task list is unfiltered by `open` on purpose — that flag's
 * `OPEN_STATUS_SQL` excludes `waiting` too, and §6.6 ("waiting items age
 * visibly") keeps them here, styled distinctly. Only `done` drops out.
 */
type FeedEntry =
  | { readonly kind: 'task'; readonly id: string; readonly at: string; readonly task: Task }
  | { readonly kind: 'activity'; readonly id: string; readonly at: string; readonly activity: Activity }

/** ISO-8601 UTC timestamps sort correctly as plain strings, so this is a compare, not a parse. */
function newestFirst(a: FeedEntry, b: FeedEntry): number {
  return b.at.localeCompare(a.at)
}

const QUICK_ADD_MODES = [
  { value: 'touch', label: 'Touch' },
  { value: 'todo', label: 'Todo' }
] as const
type QuickAddMode = (typeof QUICK_ADD_MODES)[number]['value']

function ActivityCard({
  companyId,
  companyName,
  tasks,
  items,
  now,
  mode,
  onModeChange,
  inputRef
}: {
  companyId: string
  companyName: string
  tasks: readonly Task[]
  items: readonly Activity[]
  now: number
  /** Lifted to the view so the hero's "Log touch" button can put the composer into touch mode and focus it, rather than opening a second composer that would not know which company it is on. */
  mode: QuickAddMode
  onModeChange: (mode: QuickAddMode) => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const queryClient = useQueryClient()
  const { createSheet } = useLayerManager()
  // Once for the whole feed, handed down to each row. Per-row it would be a
  // `QueryObserver` apiece for one cached value — see Activity.tsx's note
  // where the same wrapper was removed for the same reason.
  const kinds = useTimelineKinds()

  const completeTask = useMutation({
    mutationFn: (id: string) => ipcMutationFn('tasks:update')({ id, patch: { status: 'done' } }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })
  const promoteTask = useMutation({
    mutationFn: (id: string) => ipcMutationFn('tasks:setNextStep')({ id }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })
  const createTask = useMutation({
    mutationFn: (title: string) => ipcMutationFn('tasks:create')({ title, companyId }).then(unwrapMutationResult),
    onSuccess: () => invalidate.tasks(queryClient)
  })
  const logActivity = useMutation({
    mutationFn: (title: string) =>
      ipcMutationFn('activity:log')({
        occurredAt: nowTimestamp(),
        kind: 'note',
        title,
        body: null,
        companyId,
        source: 'manual'
      }).then(unwrapMutationResult),
    // T-260901-23: `activity:log` advances `companies.last_touch_at` in the
    // same transaction (repositories/activity.ts), and this page's header,
    // the grid and Today all read that column from the `companies` cache at
    // `staleTime: Infinity` — so the company is stale too, not just the
    // activity list. QuickLog invalidates the same pair for the same
    // reason. Not awaited, for the reason QuickLog gives.
    onSuccess: () => {
      void Promise.all([invalidate.activity(queryClient), invalidate.companies(queryClient)])
    }
  })

  const openTasks = tasks.filter((task) => task.status !== 'done')
  const nextStep = openTasks.find((task) => task.isNextStep) ?? null

  // The next step is drawn above the feed in its own block, so it is not
  // also drawn inside it — one todo, one row.
  const feed: FeedEntry[] = [
    ...openTasks.filter((task) => task !== nextStep).map((task): FeedEntry => ({ kind: 'task', id: task.id, at: task.createdAt, task })),
    ...items.map((activity): FeedEntry => ({ kind: 'activity', id: activity.id, at: activity.occurredAt, activity }))
  ].sort(newestFirst)

  const activeError = completeTask.isError
    ? completeTask.error
    : promoteTask.isError
      ? promoteTask.error
      : createTask.isError
        ? createTask.error
        : logActivity.isError
          ? logActivity.error
          : null

  return (
    <Section
      title="Activity"
      /* Rows in the card, which is what a count beside a list means
         everywhere else in the app. Not "open todos": that number was the
         Todos card's, and reading it off a card that also holds five
         touches would be a count of something the reader cannot see. */
      count={feed.length + (nextStep == null ? 0 : 1)}
      caption="todos and touches, newest first"
      actions={
        <>
          {/* The composer below this is the one-line path and stays the
              fastest way to log a touch on the company already on screen.
              This opens the full entry form for the times that is not
              enough — a full description, a date that is not today, a due
              date, a category — already pointed at this company, so the
              operator never re-picks the record they are looking at. */}
          <IconButton
            aria-label={`New entry for ${companyName}`}
            title="New entry"
            onClick={(event) => createSheet('entry', { companyId }, event.currentTarget)}
          >
            <PlusIcon />
          </IconButton>
          <Link className="card-more" to="/activity">
            View all
          </Link>
        </>
      }
    >
      <Card>
        <div className="feed-add">
          <Toggle options={QUICK_ADD_MODES} value={mode} onChange={onModeChange} aria-label="What to add" />
          <FeedComposer
            key={mode}
            inputRef={inputRef}
            placeholder={mode === 'touch' ? `Log a touch for ${companyName}` : `Add a todo for ${companyName}`}
            submitLabel={mode === 'touch' ? 'Log' : 'Add'}
            onSubmit={(value) => (mode === 'touch' ? logActivity.mutate(value) : createTask.mutate(value))}
          />
        </div>
        {nextStep != null && <NextStepBlock task={nextStep} now={now} onComplete={completeTask.mutate} onPromote={promoteTask.mutate} />}
        <div className="tl">
          {feed.length === 0 && nextStep == null ? (
            <EmptyState>Nothing logged, nothing open.</EmptyState>
          ) : (
            feed.map((entry) =>
              entry.kind === 'activity' ? (
                <ActivityRow key={entry.id} activity={entry.activity} kinds={kinds} />
              ) : (
                <TodoRow key={entry.id} task={entry.task} now={now} onComplete={completeTask.mutate} onPromote={promoteTask.mutate} />
              )
            )
          )}
        </div>
        <Toast
          message={activeError?.message ?? null}
          onDismiss={() => {
            completeTask.reset()
            promoteTask.reset()
            createTask.reset()
            logActivity.reset()
          }}
        />
      </Card>
    </Section>
  )
}

/**
 * The composer beside the Touch/Todo switch. Not `QuickAdd`: that primitive
 * is Enter-only with a decorative plus, which is right for a strip that
 * closes a list and wrong for the one control that does two different
 * things — the mode is a choice the operator just made, and a visible
 * button says which of the two pressing Enter will do.
 */
function FeedComposer({
  placeholder,
  submitLabel,
  onSubmit,
  inputRef
}: {
  placeholder: string
  submitLabel: string
  onSubmit: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const [value, setValue] = useState('')
  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setValue('')
  }
  return (
    <div className="feed-composer">
      <input
        ref={inputRef}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
      />
      <Button variant="ghost" onClick={submit} disabled={value.trim() === ''}>
        {submitLabel}
      </Button>
    </div>
  )
}

function ActivityRow({ activity, kinds }: { activity: Activity; kinds: readonly TimelineKind[] }) {
  return (
    <div className="tli">
      <span className="bul">
        <TimelineKindIcon kind={activity.kind} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="t">
          <span className="tli-k">{resolveTimelineKind(activity.kind, kinds).label}</span>
          {activity.title}
        </span>
        {activity.body != null && <div className="note">{activity.body}</div>}
      </span>
      <span className="tli-when">{formatActivityDate(activity.occurredAt)}</span>
    </div>
  )
}
// ---------------------------------------------------------------------------
// Contacts — T-260828-30. Current affiliations only in the main list; a
// person whose only tie to this company has `ended` shows solely under the
// `<details>` disclosure below, its subtitle naming when they left rather
// than reusing their old title — "visibly historical" (this task's
// Acceptance), not just relocated.
// ---------------------------------------------------------------------------

interface ContactEntry {
  readonly person: Person
  readonly affiliation: PersonAffiliation
}

function ContactRow({ entry, historical, onClick }: { entry: ContactEntry; historical: boolean; onClick: () => void }) {
  const subtitle = historical
    ? entry.affiliation.ended != null
      ? `left ${formatMonthYear(entry.affiliation.ended)}`
      : 'former contact'
    : (entry.affiliation.title ?? undefined)
  return (
    <Row
      onClick={onClick}
      leading={<CompanyMark name={entry.person.name} size={28} color={hue(entry.person.name)} />}
      title={entry.person.name}
      subtitle={subtitle}
      trailing={!historical && entry.affiliation.isPrimary ? <Tag variant="gold">Primary</Tag> : undefined}
    />
  )
}

/**
 * The way a contact is added here: pick someone who already exists in
 * People, give them a title, and open an affiliation. It used to be a "+"
 * that opened the new-person sheet, which made this card a second place
 * people were *created* — the operator's words: contacts should reference
 * people in the People tab, "not be a separate people/contact form".
 *
 * One write, `people:addAffiliation`, with `started` stamped today the way
 * `PersonSheet` stamps its first affiliation. The picker omits everyone
 * who is a current contact already; a former contact is offered, since
 * coming back is a new stint (`electron/shared/people.ts`'s header on why
 * the pair is not unique). With nobody in People at all there is nothing
 * to pick, and the field says so and points at the one place to fix it.
 */
function AddContactField({
  companyId,
  companyName,
  people,
  excludeIds
}: {
  companyId: string
  companyName: string
  people: readonly Person[]
  excludeIds: ReadonlySet<string>
}) {
  const queryClient = useQueryClient()
  const [personId, setPersonId] = useState('')
  const [title, setTitle] = useState('')
  const add = useMutation({
    mutationFn: () =>
      ipcMutationFn('people:addAffiliation')({ personId, companyId, title: title.trim() || null, started: localToday() }).then(
        unwrapMutationResult
      ),
    onSuccess: () => {
      setPersonId('')
      setTitle('')
      // `people:get` per person is what this page derives its contacts from
      // (`queryKeys.people.detail`), and it sits under `people.all()`.
      return invalidate.people(queryClient)
    }
  })

  if (people.length === 0) {
    return (
      <p className="meta contacts-add-empty">
        Nobody in People yet. <Link to="/people">Add a person</Link> and they can be linked here.
      </p>
    )
  }

  const candidates = people.filter((person) => !excludeIds.has(person.id))
  return (
    <form
      className="contacts-add"
      onSubmit={(event) => {
        event.preventDefault()
        if (personId === '' || add.isPending) return
        add.mutate()
      }}
    >
      <select
        className="inp"
        aria-label={`Add a contact to ${companyName}`}
        value={personId}
        onChange={(event) => setPersonId(event.target.value)}
      >
        <option value="">— pick a person —</option>
        {candidates.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      <input
        className="inp"
        aria-label="Title at this company"
        placeholder="Title (optional)"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button type="submit" variant="ghost" disabled={personId === '' || add.isPending}>
        Add
      </Button>
      {add.error != null && (
        <p className="contacts-add-error" role="alert">
          {add.error.message}
        </p>
      )}
    </form>
  )
}

function ContactsCard({
  companyId,
  companyName,
  current,
  historical,
  people
}: {
  companyId: string
  companyName: string
  current: readonly ContactEntry[]
  historical: readonly ContactEntry[]
  /** Everyone in People — the picker's candidates. */
  people: readonly Person[]
}) {
  const navigate = useNavigate()
  const goToPerson = (personId: string) => () => navigate(`/person/${personId}`)
  const currentIds = new Set(current.map((entry) => entry.person.id))

  return (
    <Section title="Contacts" count={current.length}>
      <Card>
        {current.length === 0 && historical.length === 0 ? (
          <EmptyState>No contacts yet.</EmptyState>
        ) : current.length === 0 ? (
          <EmptyState>No current contacts.</EmptyState>
        ) : (
          current.map((entry) => <ContactRow key={entry.person.id} entry={entry} historical={false} onClick={goToPerson(entry.person.id)} />)
        )}
        {historical.length > 0 && (
          <details className="contacts-historical">
            <summary>
              {historical.length} former contact{historical.length === 1 ? '' : 's'}
            </summary>
            {historical.map((entry) => (
              <ContactRow key={entry.person.id} entry={entry} historical onClick={goToPerson(entry.person.id)} />
            ))}
          </details>
        )}
        <AddContactField companyId={companyId} companyName={companyName} people={people} excludeIds={currentIds} />
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// The header — the company's own banner and logo, and the way in to editing
// (T-260901-14, ADR-015).
//
// Nothing here is optimistic, for `WorkspaceSettings`' `BrandingGroup`'s
// reason restated: what a pick produces depends on a native dialog the
// renderer cannot predict and on a refusal decided in main by the bytes' own
// magic number, so the only image shown is one a channel came back with.
//
// The rail's `BrandingRow` is deliberately NOT extracted and shared with the
// row below, though this task asked the question. They agree on the two
// buttons and on where a refusal lands, and on nothing else: the previews are
// different components in different boxes (a `.mark`/`.wordmark` pair against
// Solo CRM's own default, versus this page's derived initials mark and
// `hue(name)` gradient), the state lines are different sentences over
// different content-type sets (six formats and one cap, versus two formats
// and a cap per slot), and the union types are structurally similar but
// nominally distinct. A shared component would take the preview as a render
// prop, the caption as a string and the state as a third generic — which is
// the two rows plus a seam, not one row. See T-260901-15 if a *third*
// instance appears; two is not yet duplication worth an abstraction.
// ---------------------------------------------------------------------------

const IMAGE_SLOT_LABEL: Record<CompanyImageSlot, string> = { logo: 'Logo', banner: 'Banner' }

/**
 * Both slots absent — what the header draws against while `companyImages:get`
 * is in flight, and what it keeps drawing when the answer is that this company
 * has no images. Those two render identically on purpose: absence is the
 * default (ADR-015, and this task's Scope), so there is no placeholder that
 * flashes into an image and no "no image" state to design — the derived mark
 * and the gradient *are* it.
 */
const NO_COMPANY_IMAGES: CompanyImagesSnapshot = {
  logo: { state: 'absent', slot: 'logo' },
  banner: { state: 'absent', slot: 'banner' }
}

/**
 * One slot's upload/replace/remove pair. `role="group"` carrying the slot's
 * own name is what disambiguates them: two rows both offering "Upload…" read
 * identically on their own, and an `aria-label` on the button would have
 * replaced its visible text rather than qualified it (`BrandingRow`'s own
 * reasoning, which is the one thing the two rows genuinely share).
 *
 * A refusal renders inside this group, so it lands beside the control that
 * failed rather than under the header as a banner naming neither slot.
 */
function ImageSlotControls({
  state,
  message,
  onChoose,
  onClear
}: {
  state: CompanyImageSlotState
  message?: string
  onChoose: () => void
  onClear: () => void
}) {
  const label = IMAGE_SLOT_LABEL[state.slot]
  return (
    <span className="dhead-img" role="group" aria-label={label}>
      <span className="dhead-img-k">{label}</span>
      <Button variant="ghost" onClick={onChoose}>
        {state.state === 'present' ? 'Replace…' : 'Upload…'}
      </Button>
      {state.state === 'present' && (
        <Button variant="ghost" onClick={onClear}>
          Remove
        </Button>
      )}
      {message != null && (
        <span className="dhead-img-error" role="alert">
          {message}
        </span>
      )}
    </span>
  )
}

/**
 * A small "…" menu for the actions that are not the two anyone came here to
 * press. Local rather than a `LayerManager` layer for the same reason the
 * delete confirmation below is: the topbar's `menu` layer is the New menu's,
 * and a second one would have to share that single slot.
 *
 * Closes on Escape, on an outside click, and on choosing anything.
 */
function OverflowMenu({ label, open, onOpenChange, children }: { label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onOpenChange(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

  return (
    <div className="hero-menu" ref={wrapRef}>
      <Button ref={buttonRef} variant="ghost" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => onOpenChange(!open)}>
        <MoreIcon />
      </Button>
      {open && (
        <div className="hero-menu-panel" role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}

/** The three-dot glyph — drawn here rather than imported for the reason `ViaIcon` is. */
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  )
}

const SINCE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * The header's fact line — since, cadence, last touch, who invoices.
 *
 * These four used to be rows in the Details card at the bottom of the page,
 * and the header carried a `DecayMeter` instead: a coloured bar and a word
 * ("never"), which is a *state* without the facts that produce it. Someone
 * looking at a company wants to know when the relationship started, how
 * often they meant to be in touch, when they last were, and who is on the
 * invoice — in that order, in one line, above the fold.
 *
 * "Last touch" carries the band as a class, so the colour still says overdue
 * where the word says a date. `decay.touched` is what distinguishes "never"
 * — an honest statement about the activity log — from a bar that used to
 * render every new company as maximally late (see `lib/decay.ts`).
 */
function HeaderFacts({ company, decay, billedVia }: { company: Company; decay: Decay; billedVia: Company | undefined }) {
  const since = company.since != null ? parseDateOnly(company.since) : null
  return (
    <div className="dfacts">
      {since != null && (
        <span>
          Since <b>{SINCE_FORMAT.format(since)}</b>
        </span>
      )}
      <span>
        Cadence <b>{decay.cadenceDays > 0 ? `${decay.cadenceDays} days` : 'not set'}</b>
      </span>
      <span title={decay.description}>
        Last touch <b className={`dfact-${decay.band}`}>{decay.touched ? decay.label : 'never'}</b>
      </span>
      {company.billedViaCompanyId != null && (
        <span>
          Billed via{' '}
          <Link to={`/company/${company.billedViaCompanyId}`}>
            <b>{billedVia?.name ?? company.billedViaCompanyId}</b>
          </Link>
        </span>
      )}
    </div>
  )
}

function CompanyHeader({
  company,
  companiesById,
  decay,
  hasActiveEngagement,
  onLogTouch
}: {
  company: Company
  companiesById: Map<string, Company>
  decay: Decay
  hasActiveEngagement: boolean
  onLogTouch: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { editSheet } = useLayerManager()
  // Local rather than a LayerManager layer: the confirmation is opened from
  // this header, owns its own Escape (Sheet's default), and closing it
  // returns here. Routing it through the layer stack would mean a new
  // `LayerKind` and a `SheetKind` for a dialog that is not a form.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Owned here rather than inside `OverflowMenu`: choosing Delete has to
  // close the menu, and the image controls inside it deliberately must not
  // — a refusal ("that file is 12 MB") is rendered beside the control that
  // was pressed, and a menu that closed on every click would take the
  // message with it.
  const [menuOpen, setMenuOpen] = useState(false)
  const accent = hue(company.name)

  // The one read that carries originals, one company at a time (ADR-015) —
  // never the grid's read, which is `companyImages:thumbnails`.
  const imagesQuery = useQuery({
    queryKey: queryKeys.companyImages.detail(company.id),
    queryFn: ipcQueryFn('companyImages:get', { companyId: company.id })
  })

  // One refusal at a time, remembered with the slot it belongs to.
  const [failure, setFailure] = useState<{ slot: CompanyImageSlot; message: string } | null>(null)

  const chooseImage = useMutation({
    mutationFn: (slot: CompanyImageSlot) =>
      ipcMutationFn('companyImages:choose')({ companyId: company.id, slot }).then(unwrapMutationResult),
    onSuccess: async (choice) => {
      // Cancelling is a success that changed nothing
      // (`companyImageChoiceSchema`), so it shows nothing — no error raised,
      // and no standing message cleared either: the operator changed their
      // mind, they did not fix anything.
      if (choice.outcome === 'cancelled') return
      setFailure(null)
      await invalidate.companyImages(queryClient)
    },
    onError: (error, slot) => setFailure({ slot, message: error.message })
  })

  const clearImage = useMutation({
    mutationFn: (slot: CompanyImageSlot) =>
      ipcMutationFn('companyImages:clear')({ companyId: company.id, slot }).then(unwrapMutationResult),
    onSuccess: async () => {
      setFailure(null)
      await invalidate.companyImages(queryClient)
    },
    onError: (error, slot) => setFailure({ slot, message: error.message })
  })

  const images = imagesQuery.data ?? NO_COMPANY_IMAGES
  const banner = images.banner
  const logo = images.logo

  return (
    <div className="dhero">
      {/* The banner keeps its `hue(name)` gradient exactly as it was until an
          image is actually stored. With one, `.dbanner.has-image` swaps the
          accent radial for a contrast scrim over the picture — see the CSS,
          which is where the "works for a white banner and a black one"
          argument lives. `alt=""`: it is a wash behind a heading that already
          names the company. */}
      <div className={banner.state === 'present' ? 'dbanner has-image' : 'dbanner'} style={{ '--c': accent } as StyleWithAccent}>
        {banner.state === 'present' && <img className="dbanner-img" src={banner.dataUrl} alt="" />}
      </div>
      <div className="dhead">
        <CompanyMark name={company.name} size={50} color={accent} imageUrl={logo.state === 'present' ? logo.dataUrl : null} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="dtitle">
            <h1>{company.name}</h1>
            {company.kind != null && <Tag variant={KIND_TAG_VARIANT[company.kind]}>{KIND_LABEL[company.kind]}</Tag>}
            {/* Not a stored column: "active" here means at least one
                engagement on this company is `active`, which is what the
                grid's own badge counts. Nothing is drawn when there are
                none — an absent tag, not an "inactive" one. */}
            {hasActiveEngagement && <Tag variant="green">Active</Tag>}
          </div>
          <HeaderFacts
            company={company}
            decay={decay}
            billedVia={company.billedViaCompanyId != null ? companiesById.get(company.billedViaCompanyId) : undefined}
          />
        </div>
        <div className="dhead-actions">
          {/* The one thing this page exists to make easy — and it drives the
              composer already on the page rather than opening ⌘L's QuickLog,
              which has its own company picker and would ask again which
              company this is. One composer, one writer of `activity` rows. */}
          <Button variant="primary" aria-label={`Log a touch for ${company.name}`} onClick={onLogTouch}>
            <PlusIcon />
            Log touch
          </Button>
          {/* The whole point of this control: a company has always been
              editable, but only through a card called "Details" below the
              fold with no cue that anything on the page could be changed.
              The accessible name carries the company so "Edit" is not the
              only thing announced on a page full of buttons; the visible
              text stays a prefix of it, which is what keeps voice control
              working. */}
          <Button variant="ghost" aria-label={`Edit ${company.name}`} onClick={(event) => editSheet('company', company.id, event.currentTarget)}>
            Edit
          </Button>
          {/* Images and delete move behind "…": four buttons of chrome sat
              across the header, and none of them is why anyone opens a
              company. Delete is not red here either — this only opens the
              question; the destructive control is inside the dialog. */}
          <OverflowMenu label={`More actions for ${company.name}`} open={menuOpen} onOpenChange={setMenuOpen}>
            {COMPANY_IMAGE_SLOTS.map((slot) => (
              <ImageSlotControls
                key={slot}
                state={images[slot]}
                message={failure?.slot === slot ? failure.message : undefined}
                onChoose={() => chooseImage.mutate(slot)}
                onClear={() => clearImage.mutate(slot)}
              />
            ))}
            <button
              type="button"
              role="menuitem"
              className="hero-menu-danger"
              onClick={() => {
                setMenuOpen(false)
                setConfirmingDelete(true)
              }}
            >
              Delete {company.name}
            </button>
          </OverflowMenu>
        </div>
      </div>
      {confirmingDelete && (
        <ConfirmDelete
          entity="company"
          id={company.id}
          name={company.name}
          onClose={() => setConfirmingDelete(false)}
          // The page is about a record that no longer exists, so it cannot
          // stay open on it. Back to the list, which the delete's own
          // invalidation has already refreshed.
          onDeleted={() => navigate('/companies')}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function CompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const companyId = id ?? ''
  // Computed once per mount, not read live during render — `Date.now()` is
  // an impure call react-hooks/purity refuses inline; a detail page's
  // cadence state doesn't need to tick while it's open.
  const [now] = useState(() => Date.now())
  // The same instant as `now`, as the `Date` `decayForCompany` takes. Two
  // shapes rather than one because `now` is a number in seven other places
  // on this page (`taskDueInfo`, `daysSinceTimestamp`, …) and converting
  // those is not this change; deriving it here keeps the page on one clock.
  const [nowDate] = useState(() => new Date(now))
  // The merged feed's composer, owned here so the hero's "Log touch"
  // button can aim at it — see ActivityCard's `mode` prop.
  const [feedMode, setFeedMode] = useState<QuickAddMode>('touch')
  const composerRef = useRef<HTMLInputElement>(null)

  const companyQuery = useQuery({
    queryKey: queryKeys.companies.detail(companyId),
    queryFn: ipcQueryFn('companies:get', { id: companyId }),
    enabled: companyId !== ''
  })
  const companiesListQuery = useQuery({
    queryKey: queryKeys.companies.list(),
    queryFn: ipcQueryFn('companies:list')
  })
  // `decayForCompany`'s kind-default cadence. The same key Shell.tsx and
  // Rail.tsx already hold, so opening this page issues no extra
  // `settings:getAll`.
  const settingsQuery = useQuery({ queryKey: queryKeys.settings.list(), queryFn: ipcQueryFn('settings:getAll') })
  const billedHereQuery = useQuery({
    queryKey: queryKeys.engagements.byBillingCompany(companyId),
    queryFn: ipcQueryFn('engagements:list', { billingCompanyId: companyId }),
    enabled: companyId !== ''
  })
  const clientHereQuery = useQuery({
    queryKey: queryKeys.engagements.byClientCompany(companyId),
    queryFn: ipcQueryFn('engagements:list', { clientCompanyId: companyId }),
    enabled: companyId !== ''
  })

  // -- Todos (T-260828-30): one company-scoped query, no `open` filter — see
  // TodosCard's own comment on why `waiting` tasks stay in this list. --
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks.byCompany(companyId),
    queryFn: ipcQueryFn('tasks:list', { companyId }),
    enabled: companyId !== ''
  })

  // -- Contacts (T-260828-30): no `people:list({ companyId })` filter exists
  // — `people:list` returns bare `Person` rows with no affiliation data at
  // all — so every person is fetched (cheap: a solo consultancy's whole
  // contact book) and then `people:get` per person pulls the affiliation
  // history `people:list` doesn't carry, exactly like `people:get`'s own
  // response shape already requires for a single person's detail page.
  // `useQueries` keeps this parallel rather than N sequential round trips. --
  const peopleListQuery = useQuery({
    queryKey: queryKeys.people.list(),
    queryFn: ipcQueryFn('people:list')
  })
  const peopleDetailQueries = useQueries({
    queries: (peopleListQuery.data ?? []).map((person) => ({
      queryKey: queryKeys.people.detail(person.id),
      queryFn: ipcQueryFn('people:get', { id: person.id })
    }))
  })

  // Names for the Details card's "Introduced by" (a `people.id` since
  // migration 0009), from the same list the contacts derive from.
  const peopleById = new Map((peopleListQuery.data ?? []).map((person) => [person.id, person] as const))

  const currentContacts: ContactEntry[] = []
  const historicalContacts: ContactEntry[] = []
  for (const result of peopleDetailQueries) {
    const person: PersonWithAffiliations | null | undefined = result.data
    if (person == null) continue
    const atThisCompany = person.affiliations.filter((affiliation) => affiliation.companyId === companyId)
    if (atThisCompany.length === 0) continue
    const openStint = atThisCompany.find((affiliation) => affiliation.current)
    if (openStint != null) {
      currentContacts.push({ person, affiliation: openStint })
    } else {
      // Most recently ended stint at this company — `ended` is never null
      // here (every entry in `atThisCompany` that isn't `openStint` has one).
      const mostRecent = [...atThisCompany].sort((a, b) => (b.ended ?? '').localeCompare(a.ended ?? ''))[0]
      historicalContacts.push({ person, affiliation: mostRecent })
    }
  }
  // Every person this company has ever had an affiliation with — current and
  // historical alike, matching the Activity section's own "this company's
  // people" scope (this task's Scope), not only its present-day contacts.
  // Each entry carries the affiliation `withinAffiliationWindow` bounds that
  // person's merged-in activity to below (review fix item 3).
  const relevantContacts: readonly ContactEntry[] = [...currentContacts, ...historicalContacts]

  // -- Activity (T-260828-30): merged from three independently-filtered
  // `activity:list` calls — companyId directly, this company's people, this
  // company's engagements — per this task's Risks ("pulling person and
  // engagement activity in with three separate queries and merging
  // client-side out of order"). Engagement ids come straight off the raw
  // `billedHereQuery`/`clientHereQuery` results (deduped — an engagement
  // billed and delivered to the same company satisfies both filters) rather
  // than the post-return `billedHere`/`deliveredElsewhere` locals below,
  // which don't exist yet this early in the hook order. --
  const engagementIds = Array.from(
    new Set([...(billedHereQuery.data ?? []), ...(clientHereQuery.data ?? [])].map((engagement) => engagement.id))
  )
  const companyActivityQuery = useQuery({
    queryKey: queryKeys.activity.byCompany(companyId),
    queryFn: ipcQueryFn('activity:list', { companyId }),
    enabled: companyId !== ''
  })
  const personActivityQueries = useQueries({
    queries: relevantContacts.map((entry) => ({
      queryKey: queryKeys.activity.byPerson(entry.person.id),
      queryFn: ipcQueryFn('activity:list', { personId: entry.person.id })
    }))
  })
  const engagementActivityQueries = useQueries({
    queries: engagementIds.map((engagementId) => ({
      queryKey: queryKeys.activity.byEngagement(engagementId),
      queryFn: ipcQueryFn('activity:list', { engagementId })
    }))
  })

  // T-260828-53 item 7, second half — closed here because that task did not
  // own this file. `companiesById` is built from `companies:list`, but the
  // body used to render as soon as `companies:get` resolved, so on the fast
  // path the header rendered "billed through <a raw uuid>" and every
  // cross-company label fell through to its id, then silently corrected
  // itself a frame later. Gating on both queries makes the body's dependency
  // on the list an actual precondition rather than a race it usually wins.
  // The two run in parallel — this waits for the slower one, it does not
  // serialise them.
  //
  // `settingsQuery` joins them for the same class of reason, one step
  // narrower: `decayForCompany` reads the kind-default cadence out of the
  // snapshot, so rendering the header before it arrives would paint a band
  // computed against a cadence the workspace may not use, then correct it.
  if (companyQuery.isPending || companiesListQuery.isPending || settingsQuery.isPending) {
    return <div className="empty">Loading…</div>
  }
  if (companyQuery.isError) return <div className="empty">{companyQuery.error.message}</div>
  if (companiesListQuery.isError) return <div className="empty">{companiesListQuery.error.message}</div>
  if (settingsQuery.isError) return <div className="empty">{settingsQuery.error.message}</div>

  const settings = settingsQuery.data

  const company = companyQuery.data
  if (company == null) return <EmptyState>Company not found.</EmptyState>

  const companiesById = new Map((companiesListQuery.data ?? []).map((c) => [c.id, c] as const))
  companiesById.set(company.id, company)

  // "Billed here": billingCompanyId === this company (server-filtered — the
  // whole list already satisfies this by construction). Never coalesced
  // with "delivered here" — §5, this task's Risks.
  const billedHere = billedHereQuery.data ?? []
  // "Delivered here, billed elsewhere": clientCompanyId === this company
  // AND billingCompanyId !== this company. The clientCompanyId filter alone
  // would also catch this company's own self-billed engagements (already
  // covered by "billed here" above) — this narrows further, in the same
  // direction the filter already established, not a reversal of it.
  const deliveredElsewhere = (clientHereQuery.data ?? []).filter((engagement) => engagement.billingCompanyId !== company.id)

  // **Two ways to be an end client, and the card needs both.**
  //
  // This used to derive the list from engagements alone: a company was an
  // end client of this one if some engagement billed *here* named it as the
  // client. That is the right list for "who is the work for", and it is not
  // the relationship the Companies grid counts — that one reads
  // `companies.billed_via_company_id`, the standing fact that this company
  // is the one on the invoice. A sub-client created and not yet given an
  // engagement satisfied the second and not the first, so it appeared as
  // "1 end client" on the grid and nowhere at all on the parent's page: the
  // exact record an operator goes looking for after creating it.
  //
  // So the card is the union, keyed by company id, and `engagementCount` is
  // what it always was — engagements billed here for that company, which is
  // legitimately `0` for one whose only tie is the billing column.
  const endClientCounts = new Map<string, number>()
  for (const candidate of companiesListQuery.data ?? []) {
    if (candidate.billedViaCompanyId === company.id && candidate.id !== company.id) endClientCounts.set(candidate.id, 0)
  }
  for (const engagement of billedHere) {
    if (engagement.clientCompanyId != null && engagement.clientCompanyId !== company.id) {
      endClientCounts.set(engagement.clientCompanyId, (endClientCounts.get(engagement.clientCompanyId) ?? 0) + 1)
    }
  }
  const endClients = Array.from(endClientCounts.entries())
    .map(([clientId, engagementCount]) => {
      const endClientCompany = companiesById.get(clientId)
      return endClientCompany ? { company: endClientCompany, engagementCount } : null
    })
    .filter((entry): entry is { company: Company; engagementCount: number } => entry != null)
    .sort((a, b) => b.engagementCount - a.engagementCount || a.company.name.localeCompare(b.company.name))

  // Merge + dedupe (an activity row can carry both a matching companyId and
  // a matching personId/engagementId, landing in more than one of the three
  // queries above) then sort newest first — a `Map` keyed by id does both in
  // one pass, and ISO-8601 UTC timestamps sort correctly as plain strings.
  const activityById = new Map<string, Activity>()
  for (const activity of companyActivityQuery.data ?? []) activityById.set(activity.id, activity)
  // Bounded per contact by their affiliation window (review fix item 3) — a
  // historical contact's activity from after they left, at whatever company
  // they moved to next, must not leak onto this one just because their
  // `activity:list({ personId })` query itself returns every row they've
  // ever been party to.
  relevantContacts.forEach((entry, index) => {
    for (const activity of personActivityQueries[index]?.data ?? []) {
      if (withinAffiliationWindow(activity.occurredAt, entry.affiliation)) activityById.set(activity.id, activity)
    }
  })
  for (const result of engagementActivityQueries) for (const activity of result.data ?? []) activityById.set(activity.id, activity)
  const activityItems = Array.from(activityById.values()).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  // `settingsQuery.data` is non-null here: the early return above waits on
  // it, for the reason stated there.
  const decay = decayForCompany(company, settings, nowDate)

  return (
    <div>
      <Link className="back" to="/companies">
        ← Companies
      </Link>
      <CompanyHeader
        company={company}
        companiesById={companiesById}
        decay={decay}
        hasActiveEngagement={[...billedHere, ...deliveredElsewhere].some((engagement) => engagement.status === 'active')}
        onLogTouch={() => {
          setFeedMode('touch')
          composerRef.current?.focus()
        }}
      />

      {/* Two columns, never more (planning/solo-crm-company-page-mockup.html):
          what's *happening* on the left — engagements, end clients, the feed
          — and what's *true* on the right — details, contacts, links, notes.
          The old auto-fit grid dealt the same eight cards into however many
          330px columns the window allowed, so at a wide window they sat four
          abreast, each too narrow for its own rows, and their order changed
          with the width. */}
      <div className="cols">
        <div className="col">
          {/* **The split-billing distinction stays, and stops taking a column
              to say nothing.** These are still two independently server-filtered
              reads, never one list sliced two ways (§5, and the bug whose page
              still looks plausible) — but a company with no work delivered for
              someone else drew an empty card headed "Delivered here, billed
              elsewhere", which is a third of the page spent on a distinction
              that does not apply to it. The second card appears when there is
              something in it, and the first is called what it is: with nothing
              billed elsewhere, "Billed here" is just this company's
              engagements. The mockup does the same (`views.company`). */}
          <EngagementCard
            title={deliveredElsewhere.length > 0 ? 'Billed here' : 'Engagements'}
            count={billedHere.length}
            engagements={billedHere}
            viaLabelFor={(engagement) =>
              engagement.clientCompanyId != null && engagement.clientCompanyId !== company.id
                ? `for ${companiesById.get(engagement.clientCompanyId)?.name ?? engagement.clientCompanyId}`
                : null
            }
          />
          {deliveredElsewhere.length > 0 && (
            <EngagementCard
              title="Delivered here, billed elsewhere"
              count={deliveredElsewhere.length}
              engagements={deliveredElsewhere}
              viaLabelFor={(engagement) =>
                engagement.billingCompanyId != null ? `billed to ${companiesById.get(engagement.billingCompanyId)?.name ?? engagement.billingCompanyId}` : null
              }
            />
          )}
          {endClients.length > 0 && <EndClientsCard companyName={company.name} endClients={endClients} />}
          <ActivityCard
            companyId={company.id}
            companyName={company.name}
            tasks={tasksQuery.data ?? []}
            items={activityItems}
            now={now}
            mode={feedMode}
            onModeChange={setFeedMode}
            inputRef={composerRef}
          />
        </div>
        <div className="col">
          <DetailsCard company={company} peopleById={peopleById} />
          <ContactsCard
            companyId={company.id}
            companyName={company.name}
            current={currentContacts}
            historical={historicalContacts}
            people={peopleListQuery.data ?? []}
          />
          {/* §6.10's links, in the mockup's own position — after Contacts in
              the right-hand column. */}
          <LinksCard entityType="company" entityId={company.id} />
          <NotesCard company={company} />
        </div>
      </div>
    </div>
  )
}
