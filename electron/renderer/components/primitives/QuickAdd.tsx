import { useState, type KeyboardEvent } from 'react'
import { PlusIcon } from '../icons'
import './QuickAdd.css'

export interface QuickAddProps {
  placeholder: string
  /** Called with the trimmed text on Enter. The field clears itself
   * afterwards — same contract as the mockup's `quickAdd()`/`quickService()`
   * handlers, which read the input's value and reset it. */
  onAdd: (value: string) => void
}

/** `.quickadd` from the mockup — the inline "add a todo" / "add a service"
 * row that closes out a Card's list instead of opening a Sheet for
 * one-field records. */
export function QuickAdd({ placeholder, onAdd }: QuickAddProps) {
  const [value, setValue] = useState('')

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setValue('')
  }

  return (
    <div className="quickadd">
      <PlusIcon width={13} height={13} />
      <input
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
