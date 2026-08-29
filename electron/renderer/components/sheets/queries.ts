import { useQuery } from '@tanstack/react-query'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'

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

/** `people:list` — `TodoSheet`'s "Person" link picker. */
export function usePeopleList() {
  const query = useQuery({ queryKey: queryKeys.people.list(), queryFn: ipcQueryFn('people:list') })
  return query.data ?? []
}
