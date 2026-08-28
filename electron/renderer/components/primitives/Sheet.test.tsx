import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { Sheet } from './Sheet'

function renderSheet(open: boolean, onClose: () => void) {
  return render(
    <Sheet open={open} onClose={onClose} title="Create" aria-label="Create" footer={<button>Save</button>}>
      <div>body</div>
    </Sheet>
  )
}

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    const { container } = renderSheet(false, () => {})
    expect(container.firstChild).toBeNull()
  })

  it('moves focus onto the dialog when it opens, so a keyboard user is not left hunting for it', () => {
    renderSheet(true, () => {})
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
  })

  it('closes on Escape, matching the mockup\'s own document-level listener', () => {
    const onClose = vi.fn()
    renderSheet(true, onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closeOnEscape={false} leaves Escape to whoever owns it centrally — the built-in listener is not registered', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} closeOnEscape={false} title="Create" aria-label="Create" footer={<button>Save</button>}>
        <div>body</div>
      </Sheet>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a scrim click but not a click inside the sheet', () => {
    const onClose = vi.fn()
    const { getByRole, container } = renderSheet(true, onClose)
    fireEvent.click(getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    const scrim = container.querySelector('.scrim') as HTMLElement
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
