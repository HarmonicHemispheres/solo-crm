import { useQuery } from '@tanstack/react-query'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import type { ListOfferingsFilter } from '../../../shared/offerings'

/**
 * The company/engagement/person picker lists every sheet in this directory
 * that has a reference field needs — reads through a query hook, per
 * AGENTS.md's "no component may call `window.crm` directly". Defaulted to
 * `[]` (never `undefined`) so a `<select>`'s `.map()` doesn't need its own
 * `?? []` at every one of the (currently five) call sites across
 * `CompanySheet`, `PersonSheet`, `EngagementSheet` and `TodoSheet`.
 */
export function useCompaniesList() {
  const query = useQuery({ queryKey: queryKeys.companies.list(), queryFn: ipcQueryFn('companies:list') })
  return query.data ?? []
}

/** `engagements:list` — `TodoSheet`'s "Engagement" link picker. */
export function useEngagementsList() {
  const query = useQuery({ queryKey: queryKeys.engagements.list(), queryFn: ipcQueryFn('engagements:list') })
  return query.data ?? []
}

/**
 * `offerings:list` — `EngagementSheet`'s "Sold as" picker (T-260901-13).
 *
 * `filter` is passed to both the key and the call, so a filtered read is its
 * own cache entry rather than one competing to populate the unfiltered one —
 * `queryKeys.offerings.list`'s own header states that rule. The sheet asks for
 * `{ active: true }`: an archived offering is not something new work is sold
 * from, and `listOfferings` applies no implicit `active = 1` of its own.
 *
 * The rows carry `currentVersion`, which is what makes the create form's one
 * read of the price list possible — see `EngagementForm`'s `offeringPart`.
 * Nothing here re-reads a rate for an engagement that already exists.
 */
export function useOfferingsList(filter?: ListOfferingsFilter) {
  const query = useQuery({ queryKey: queryKeys.offerings.list(filter), queryFn: ipcQueryFn('offerings:list', filter) })
  return query.data ?? []
}

/** `people:list` — `TodoSheet`'s "Person" link picker. */
export function usePeopleList() {
  const query = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  return query.data ?? []
}
