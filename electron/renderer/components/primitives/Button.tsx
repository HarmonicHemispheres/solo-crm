import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import './Button.css'

/** The two modifier classes the mockup actually pairs with `.btn`, and the
 * only two ways to render a button. There is no variantless button: bare
 * `.btn` carries the geometry both modifiers build on and sets no
 * `background` and no `color`, so on its own it falls through to the user
 * agent's near-white `ButtonFace` while `base.css`'s `button { color:
 * inherit }` paints the label `--papyrus` — light text on a white box.
 * That shipped twice on `/workspace/data` (T-260901-01) because the prop
 * was optional and the type checker had nothing to object to; `variant` is
 * required now so the next one does not compile. This union is closed
 * deliberately — a size or intent matrix the mockup doesn't have is a scope
 * change, not a typo fix. */
export type ButtonVariant = 'primary' | 'ghost'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-prim',
  ghost: 'btn-ghost'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant: ButtonVariant
  /** React 19 accepts `ref` as a plain prop on function components — no
   * `forwardRef` needed. Forwarding it is not optional here: NewMenu's
   * trigger both focuses itself back after a sheet closes and hands its own
   * element to the layer manager as the open call's trigger, and both need
   * the real `<button>` node, not a wrapper. */
  ref?: Ref<HTMLButtonElement>
}

/** `.btn-prim` / `.btn-ghost` from the mockup — the shell's only text button
 * shape (as opposed to `IconButton`'s icon-only `.iconbtn`). Renders the
 * exact class strings `Button.css` styles: `btn btn-prim` or `btn btn-ghost`,
 * never bare `btn`. */
export function Button({ variant, className, type = 'button', children, ref, ...rest }: ButtonProps) {
  const classes = ['btn', VARIANT_CLASS[variant], className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}
