import type { ReactNode } from 'react'
import './EmptyState.css'

export interface EmptyStateProps {
  children: ReactNode
  /**
   * An optional call to action below the message (e.g. "Add one"). This
   * task has no Button primitive — it isn't in the closed list in
   * T-260828-11, and the mockup's `.btn`/`.btn-ghost` styling wasn't given
   * a home in that task's Touches either — so this slot takes whatever the
   * caller renders rather than assuming a button shape.
   */
  action?: ReactNode
}

/** `.empty` from the mockup — the placeholder shown in place of a card body,
 * table or list when there's nothing to show. */
export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {children}
      {action != null && <div className="empty-action">{action}</div>}
    </div>
  )
}
