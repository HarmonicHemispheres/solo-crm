import { useEffect, type ReactNode } from 'react'
import './Toast.css'

export interface ToastProps {
  /** `null`/`undefined` hides the toast. Passing a new message while one is
   * already showing restarts the dismiss timer, matching the mockup's
   * `toast()` (it clears and re-sets its own `setTimeout` on every call so
   * a fast second message doesn't get cut off by the first one's clock). */
  message: ReactNode | null | undefined
  onDismiss: () => void
  durationMs?: number
}

/** `.toast` from the mockup — the transient bottom-center confirmation
 * shown after most create/edit/delete actions. A message can embed a `<b>`
 * for the one emphasised word (`<b>Acme Co</b> added`), same as the
 * mockup's own toast strings. */
export function Toast({ message, onDismiss, durationMs = 2500 }: ToastProps) {
  useEffect(() => {
    if (message == null) return
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [message, durationMs, onDismiss])

  return (
    <div className={message != null ? 'toast show' : 'toast'} role="status" aria-live="polite">
      {message}
    </div>
  )
}
