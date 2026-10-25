/**
 * The app's own name and caption buttons, where the system title bar used to
 * be.
 *
 * With `titleBarStyle: 'hidden'` Windows stops drawing the bar, the title and
 * the icon. It used to go on drawing the minimise, maximise and close buttons
 * as an overlay; that is gone too, and they are drawn here instead.
 *
 * **Why the app draws them.** A click on the empty field dismisses the chrome
 * -- the browser bar, the settings gear, the now-playing panel. Buttons
 * painted by the OS cannot be dismissed with it, so three controls stayed lit
 * in the corner while everything around them faded, which reads as the app
 * having forgotten to clear up rather than as a deliberate exception. Drawn
 * here they are ordinary elements and follow `body[data-chrome]` like the rest.
 *
 * **The strip stays a drag region even when it is invisible.** Hiding the bar
 * must not nail the window to the desktop, so the fade is on the mark and the
 * buttons, never on `.titlebar` itself. The buttons additionally stop taking
 * clicks while hidden -- an invisible close button is a trap, and this is the
 * one place where "cannot be seen" has to mean "cannot be hit".
 *
 * **Two ways to bring it back.** The chrome gesture is one: click the empty
 * field and the title returns with the browser bar. Reaching for the top edge
 * is the other -- the pointer coming within `PEEK_PX` of the top reveals the
 * strip on its own, the way a fullscreen browser gives its tabs back.
 *
 * That second one is a deliberate exception to `core/chrome.ts`, which says
 * pointer movement reveals nothing because chrome that appears whenever the
 * cursor crosses the window is always-visible in practice. The exception holds
 * because this is not app chrome: minimise, maximise and close belong to the
 * window, and needing to close the app should not mean summoning the browser
 * bar and the now-playing panel to do it. Nothing else on screen answers the
 * pointer, and the rule stands for everything that is actually chrome.
 *
 * The strip is only 34px tall because a drag region swallows clicks and the
 * close-up's corner preview sits directly beneath it.
 */

import { useEffect, useState } from 'react'

/**
 * How close to the top edge the pointer has to come, in CSS pixels.
 *
 * A little more than the strip's own 34px on purpose. The strip is a drag
 * region, and a drag region takes its events from the OS rather than passing
 * them to the renderer -- so `mousemove` stops firing the moment the pointer
 * crosses into it. The margin means the reveal has already happened by then,
 * and the last reading simply stands while the pointer is inside. Moving back
 * down resumes the events and hides it again.
 */
const PEEK_PX = 40

/** 10x10, stroked. Sized and spaced after Windows' own caption glyphs. */
function Minimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function Maximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

/** Two offset outlines: the window sitting in front of where it would restore to. */
function Restore() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function Close() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [peek, setPeek] = useState(false)

  // On the window rather than on the strip: see PEEK_PX. A listener on the
  // strip itself would never fire, because it is a drag region.
  useEffect(() => {
    const onMove = (event: MouseEvent) => setPeek(event.clientY <= PEEK_PX)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Asked rather than assumed, because the window can be maximized by ways
  // this component never sees: the snap gesture, Win+Up, a double-click on
  // the drag strip. `resize` covers all of them, since none can happen
  // without one.
  useEffect(() => {
    let alive = true
    const read = () => {
      void window.vuelta.isWindowMaximized().then((value) => {
        if (alive) setMaximized(value)
      })
    }
    read()
    window.addEventListener('resize', read)
    return () => {
      alive = false
      window.removeEventListener('resize', read)
    }
  }, [])

  return (
    <div className="titlebar" data-peek={peek ? 'true' : 'false'}>
      <span className="titlebar__mark">Vuelta</span>

      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__button"
          aria-label="Minimize"
          onClick={() => void window.vuelta.minimizeWindow()}
        >
          <Minimize />
        </button>
        <button
          type="button"
          className="titlebar__button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.vuelta.toggleMaximizeWindow().then(setMaximized)}
        >
          {maximized ? <Restore /> : <Maximize />}
        </button>
        <button
          type="button"
          className="titlebar__button titlebar__button--close"
          aria-label="Close"
          onClick={() => void window.vuelta.closeWindow()}
        >
          <Close />
        </button>
      </div>
    </div>
  )
}
