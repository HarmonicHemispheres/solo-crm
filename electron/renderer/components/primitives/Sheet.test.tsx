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

    // A whole press on the backdrop: down and up both on the scrim. The
    // `mouseDown` is not decoration — see the drag test below for what it
    // distinguishes this from.
    const scrim = container.querySelector('.scrim') as HTMLElement
    fireEvent.mouseDown(scrim)
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a press that started inside the sheet ends on the scrim', () => {
    // The bug this guards, and it was the worst one in the app. A `click`
    // fires on the nearest common ancestor of its mousedown and mouseup
    // targets, so selecting the text already in a field and releasing
    // outside the sheet delivers a click whose `target` IS the scrim. The
    // old handler tested only `target === currentTarget`, could not tell
    // that from a deliberate backdrop click, and closed the sheet — losing
    // every unsaved edit.
    //
    // It hit editing far harder than creating: a create form's fields are
    // empty and there is nothing to drag across, while editing a record
    // starts by selecting the value you mean to replace. Reported as
    // "whenever I try to edit, the form disappears", and confirmed by
    // driving the real app over CDP — a press in the Name field released on
    // the scrim closed the engagement sheet and discarded the typed name.
    const onClose = vi.fn()
    const { getByRole, container } = renderSheet(true, onClose)
    const scrim = container.querySelector('.scrim') as HTMLElement

    // Down inside the dialog...
    fireEvent.mouseDown(getByRole('dialog'))
    // ...up outside it, so the click lands on their common ancestor.
    fireEvent.click(scrim)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close when a press that started on the scrim ends inside the sheet', () => {
    // The mirror case, and the reason this closes on `click` rather than on
    // `mouseDown`: dragging off the backdrop back into the sheet is not a
    // dismissal either. A mousedown-closes implementation would fail here.
    const onClose = vi.fn()
    const { getByRole, container } = renderSheet(true, onClose)
    const scrim = container.querySelector('.scrim') as HTMLElement

    fireEvent.mouseDown(scrim)
    fireEvent.click(getByRole('dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('a backdrop click still closes after an aborted drag out of the sheet', () => {
    // The press flag is per-gesture, not sticky: an inside-out drag must not
    // leave the scrim permanently unclickable afterwards.
    const onClose = vi.fn()
    const { getByRole, container } = renderSheet(true, onClose)
    const scrim = container.querySelector('.scrim') as HTMLElement

    fireEvent.mouseDown(getByRole('dialog'))
    fireEvent.click(scrim)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(scrim)
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
