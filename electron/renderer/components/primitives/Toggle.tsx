import type { ReactNode } from 'react'
import './Toggle.css'

export interface ToggleOption<Value extends string> {
  value: Value
  label: ReactNode
}

export interface ToggleProps<Value extends string> {
  options: readonly ToggleOption<Value>[]
  value: Value
  onChange: (value: Value) => void
  /** Optional — the buttons carry visible text already, this only helps a
   * screen-reader user recognise the set as one control (e.g. "roll revenue
   * up by"). */
  'aria-label'?: string
}

/** `.toggle` from the mockup — the segmented view-mode control used in the
 * header of revenue, todos, services and engagements (each with 2–3
 * options). Not the settings `.switch` on/off control, which is used in
 * exactly one view and stays there. */
export function Toggle<Value extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel
}: ToggleProps<Value>) {
  return (
    <div className="toggle" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === value ? 'on' : undefined}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
