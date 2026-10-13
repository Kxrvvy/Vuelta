/**
 * When the chrome is on screen.
 *
 * The now-playing panel and the browser bar are summoned by a click on the
 * empty field around the machine, and dismissed by another one. Pointer
 * movement does nothing: spec §13's rule is that always-visible chrome fights
 * the illusion of an object on the desk, and chrome that appears whenever the
 * cursor crosses the window is always-visible in practice.
 *
 * The decision lives here rather than inline in the view because it has to
 * combine two pieces of state. The bar is also held up by an open pane, so a
 * single gesture must be able to close the sheet and drop the chrome together
 * -- otherwise dismissing takes two clicks, and which one did what is not
 * obvious from either.
 */

export type ChromeState = {
  /** The view's own flag: chrome was summoned and not yet dismissed. */
  chromeShown: boolean
  /** A playlist or queue sheet is open, which holds the bar up by itself. */
  paneOpen: boolean
}

export type ChromeGesture = {
  chromeShown: boolean
  /** The caller closes the sheet; this module does not own the library. */
  closePane: boolean
}

/**
 * A click on the empty field, or Escape.
 *
 * Dismisses whatever is up, and summons when nothing is. Deliberately not a
 * plain negation of `chromeShown`: with a sheet open and the flag already
 * false, negating would raise the chrome rather than dismiss the sheet.
 */
export function toggleChrome({ chromeShown, paneOpen }: ChromeState): ChromeGesture {
  if (chromeShown || paneOpen) return { chromeShown: false, closePane: true }
  return { chromeShown: true, closePane: false }
}
