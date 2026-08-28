import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QuickAdd } from './QuickAdd'

describe('QuickAdd', () => {
  it('submits the trimmed value on Enter and clears the field', () => {
    const onAdd = vi.fn()
    render(<QuickAdd placeholder="Add a todo" onAdd={onAdd} />)
    const input = screen.getByPlaceholderText('Add a todo') as HTMLInputElement

    fireEvent.change(input, { target: { value: '  Call Acme  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('Call Acme')
    expect(input.value).toBe('')
  })

  it('does not submit on Enter when the field is empty or whitespace-only', () => {
    const onAdd = vi.fn()
    render(<QuickAdd placeholder="Add a todo" onAdd={onAdd} />)
    const input = screen.getByPlaceholderText('Add a todo')

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).not.toHaveBeenCalled()
  })
})
