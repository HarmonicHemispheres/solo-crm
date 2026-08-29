import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import { Chip } from '../primitives/Chip'
import './fields.css'

/**
 * `.f-lab` plus the single labelled control it describes — every field in
 * FORMS.* (planning/solo-crm-mockup.html) is this shape. `children` is the
 * one input/select/textarea this field wraps; `Field` mints one id via
 * `useId()` and clones it onto that element so the `<label>` stays properly
 * associated (X-06's keyboard/focus-ring requirement includes "click the
 * label to focus the control") without every one of this directory's four
 * sheets hand-authoring its own id string per field.
 */
export function Field({
  label,
  error,
  children
}: {
  label: string
  /**
   * The validation failure this field caused, already labelled as the user
   * sees the field (`useSheetMutation`'s `errorFor`). Rendered here, beside
   * the control, rather than as a banner at the top of the sheet naming a
   * database column — T-260828-53 item 2. `aria-invalid` plus
   * `aria-describedby` put the same fact on the control itself, so a screen
   * reader announces it on focus instead of only when the alert fires.
   */
  error?: string
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>
}) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div>
      <label className="f-lab" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined
      })}
      {error && (
        <div className="field-error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export interface ChipFieldOption<V extends string | number> {
  value: V
  label: ReactNode
}

/**
 * `.chiprow` — a single-select group of `Chip`s standing in for a native
 * `<select>` wherever the field is a closed enumeration
 * (.claude/rules/ui-design.md, restated in this task's scope: "Enumerations
 * are chip groups, never native selects"). Company/person/engagement
 * *reference* pickers stay real `<select>`s (a `.inp` with `<option>`s) —
 * those aren't enumerations, and the mockup renders them as selects too.
 */
export function ChipField<V extends string | number>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: readonly ChipFieldOption<V>[]
  value: V
  onChange: (value: V) => void
}) {
  return (
    <div>
      <label className="f-lab">{label}</label>
      <div className="chiprow" role="group" aria-label={label}>
        {options.map((opt) => (
          <Chip key={opt.value} selected={opt.value === value} onClick={() => onChange(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}
