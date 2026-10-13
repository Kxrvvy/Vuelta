import { describe, expect, it } from 'vitest'

import { toggleChrome } from '../chrome.js'

describe('the chrome gesture', () => {
  it('summons the chrome when nothing is up', () => {
    expect(toggleChrome({ chromeShown: false, paneOpen: false })).toEqual({
      chromeShown: true,
      closePane: false,
    })
  })

  it('dismisses the chrome when it is up', () => {
    expect(toggleChrome({ chromeShown: true, paneOpen: false })).toEqual({
      chromeShown: false,
      closePane: true,
    })
  })

  it('counts an open sheet as up, even with the flag already down', () => {
    // The bar holds itself up while a pane is open, so a plain negation of the
    // flag would raise the chrome here instead of dismissing the sheet.
    expect(toggleChrome({ chromeShown: false, paneOpen: true })).toEqual({
      chromeShown: false,
      closePane: true,
    })
  })

  it('clears the sheet and the chrome in one gesture', () => {
    expect(toggleChrome({ chromeShown: true, paneOpen: true })).toEqual({
      chromeShown: false,
      closePane: true,
    })
  })

  it('returns to where it started after summon and dismiss', () => {
    const summoned = toggleChrome({ chromeShown: false, paneOpen: false })
    const dismissed = toggleChrome({ chromeShown: summoned.chromeShown, paneOpen: false })
    expect(dismissed.chromeShown).toBe(false)
  })
})
