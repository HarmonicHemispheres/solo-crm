import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Chip.css'

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'>

export interface ChipProps extends NativeButtonProps {
  /** Whether this chip is the selected option in its group. Omit entirely
   * for a chip that's a plain action (e.g. running a saved snippet) rather
   * than a member of a single-select group. */
  selected?: boolean
  children: ReactNode
}

/** `.chip` from the mockup — a small selectable pill. Views group several
 * inside a plain flex row (the mockup's `.chiprow`, which is layout only —
 * gap and wrap, nothing token-bearing — so it isn't its own primitive) for
 * single-select fields like relationship kind or cadence. */
export function Chip({ selected, className, children, ...rest }: ChipProps) {
  const classes = ['chip']
  if (selected) classes.push('on')
  if (className) classes.push(className)
  return (
    <button type="button" className={classes.join(' ')} aria-pressed={selected} {...rest}>
      {children}
    </button>
  )
}
