import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import './Button.css'

/** The two modifier classes the mockup actually pairs with `.btn`. Omitting
 * `variant` renders the bare `.btn` — a real, if currently unused-in-shell,
 * style of its own (structural only: no background or text colour). This
 * union is closed deliberately (see the task's Risks) — a size or intent
 * matrix the mockup doesn't have is a scope change, not a typo fix. */
export type ButtonVariant = 'primary' | 'ghost'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-prim',
  ghost: 'btn-ghost'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
  /** React 19 accepts `ref` as a plain prop on function components — no
   * `forwardRef` needed. Forwarding it is not optional here: NewMenu's
   * trigger both focuses itself back after a sheet closes and hands its own
   * element to the layer manager as the open call's trigger, and both need
   * the real `<button>` node, not a wrapper. */
  ref?: Ref<HTMLButtonElement>
}

/** `.btn` / `.btn-prim` / `.btn-ghost` from the mockup — the shell's only
 * text button shape (as opposed to `IconButton`'s icon-only `.iconbtn`).
 * Renders the exact class strings `buttons.css` styles: `btn btn-prim`,
 * `btn btn-ghost`, or bare `btn`. */
export function Button({ variant, className, type = 'button', children, ref, ...rest }: ButtonProps) {
  const classes = ['btn', variant ? VARIANT_CLASS[variant] : undefined, className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}
