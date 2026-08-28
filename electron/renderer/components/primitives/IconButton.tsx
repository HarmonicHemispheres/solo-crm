import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './IconButton.css'

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children' | 'type'>

export interface IconButtonProps extends NativeButtonProps {
  /** The icon, as an inline SVG (see components/icons.tsx). */
  children: ReactNode
  /**
   * Required. An icon-only control has no visible text: the icon is the
   * affordance for sighted users, this label is the affordance for
   * everyone else (see .claude/rules/ui-design.md). There is no safe
   * default to fall back to, so this is not optional.
   */
  'aria-label': string
}

/** `.iconbtn` from the mockup — the small square icon-only control used for
 * secondary actions throughout every view. */
export function IconButton({ children, className, ...rest }: IconButtonProps) {
  return (
    <button type="button" className={className ? `iconbtn ${className}` : 'iconbtn'} {...rest}>
      {children}
    </button>
  )
}
