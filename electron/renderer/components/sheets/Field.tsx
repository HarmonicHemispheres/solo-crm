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
export function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return (
    <div>
      <label className="f-lab" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id })}
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
