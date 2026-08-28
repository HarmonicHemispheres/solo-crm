import type { HTMLAttributes, ReactNode } from 'react'
import './ModelTag.css'

export type BillingModel = 'retainer' | 'fixed' | 'tm' | 'equity'

export interface ModelTagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  model: BillingModel
  children: ReactNode
}

/** `.modeltag` from the mockup — the billing-model pill used on engagement
 * rows, cards and the revenue rollup. The label text is the caller's (it
 * comes from data, e.g. "Retainer" / "T&M"); this only owns the colour per
 * model. */
export function ModelTag({ model, className, children, ...rest }: ModelTagProps) {
  const classes = ['modeltag', `m-${model}`]
  if (className) classes.push(className)
  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
    </span>
  )
}
