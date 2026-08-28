import type { HTMLAttributes, ReactNode } from 'react'
import './Tag.css'

export type TagVariant = 'default' | 'verd' | 'gold' | 'lapis' | 'green' | 'orange' | 'red'

export interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  variant?: TagVariant
  children: ReactNode
}

/** `.tag` from the mockup — a small mono-caps label. Colour marks meaning
 * (kind, status), never decoration: pick `variant` to match what the tag is
 * reporting, not to make a row less monochrome. */
export function Tag({ variant = 'default', className, children, ...rest }: TagProps) {
  const classes = ['tag']
  if (variant !== 'default') classes.push(variant)
  if (className) classes.push(className)
  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
    </span>
  )
}
