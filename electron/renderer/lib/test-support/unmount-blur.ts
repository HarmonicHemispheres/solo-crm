import { act, fireEvent } from '@testing-library/react'

/**
 * Presses `key` on `input` and replays the blur Chromium fires when a
 * focused element is unmounted — jsdom fires none (T-260901-25).
 *
 * A plain `fireEvent.blur(input)` after the keydown proves nothing: RTL's
 * `act` has already flushed the state update that removed the input, so the
 * blur lands on a detached node with no ancestors and React's root listener
 * never sees it. Every "Escape does not save" test written that way passes
 * against code with no guard at all.
 *
 * So the blur is dispatched from a `document` keydown listener: bubbling
 * reaches `document` after React's root container, so React's own `onKeyDown`
 * has already run and queued the unmount, but the flush is a microtask away
 * and the input is still in the tree — which is exactly the moment Chromium
 * delivers the unmount blur. `focusout`, not `blur`, because that is the
 * native event React's `onBlur` listens for.
 */
export async function keyDownWithUnmountBlur(input: HTMLElement, key: 'Escape' | 'Enter'): Promise<void> {
  const replayBlur = (event: KeyboardEvent) => {
    if (event.target !== input) return
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }
  document.addEventListener('keydown', replayBlur)
  try {
    fireEvent.keyDown(input, { key })
  } finally {
    document.removeEventListener('keydown', replayBlur)
  }
  // A mutation reached by the replayed blur runs its `mutationFn` a few
  // microtasks later, so a synchronous "not called" assertion right after
  // the keydown passes whether or not the write happened. Let that settle
  // before the caller asserts.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
}
