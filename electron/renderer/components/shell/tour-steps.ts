/**
 * The five steps of the first-run tour (T-260829-15), and the shape of one.
 *
 * Split out of `Tour.tsx` for the same reason `layer-manager-context.ts` is
 * split out of `LayerManager.tsx`, and by the same rule:
 * `react-refresh/only-export-components` disallows a file that exports both
 * a component and a constant. `Tour.test.tsx` reads this list directly to
 * assert what the tour actually says, so it is a real export rather than a
 * private array.
 */
export interface TourStep {
  /** The card heading — named after the view it describes. */
  readonly title: string
  /** Two or three sentences, in the same voice as that view's own
   * `ViewHeader` `description`; several are lifted near-verbatim from them,
   * which is the point — the tour and the view should not describe the same
   * idea two different ways. */
  readonly body: string
  /**
   * An extra button that leaves the tour for the view being described.
   * Only step 2 carries one: Companies is where a new workspace actually
   * starts, so "start here" has to be a control and not a sentence.
   */
  readonly action?: { readonly label: string; readonly path: string }
  /** Where *Finish* goes on the last step. Only the last step sets it. */
  readonly finishPath?: string
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: 'Today',
    body:
      'This screen leads with what is owed, not with what is stored. Overdue and due-today work comes first, ' +
      'then the relationships going quiet against their own cadence. Everything else in the app is reachable from what it shows you.'
  },
  {
    title: 'Companies',
    body:
      'Start here — a company is the anchor everything else hangs off. End clients are companies you deliver to but do not invoice: ' +
      'they carry their own contacts, budget and touchpoints while revenue rolls up to the billing partner.',
    action: { label: 'Open Companies', path: '/companies' }
  },
  {
    title: 'People',
    body:
      'Contacts are stored separately from companies, so history follows the person when they change jobs. ' +
      'An affiliation ties someone to a company for a stretch of time; ending it keeps the person and everything logged against them.'
  },
  {
    title: 'Engagements',
    body:
      'The work itself, and how it bills. Each engagement carries a billing model — retainer, fixed scope or time and materials — ' +
      'and asks separately who is billed and who the work is for, because those are often not the same company.'
  },
  {
    title: 'Workspace',
    body:
      'Cadence defaults per company kind, your own icon and logo, and where your database file lives. ' +
      'Nothing here reaches the network you did not configure: every integration is pull-only and there is no telemetry.',
    finishPath: '/workspace/settings'
  }
]

