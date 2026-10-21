import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The frame every screen sits in: the screen itself, and a settings button in
 * the top right corner.
 *
 * There used to be a status strip along the bottom holding the same things —
 * the connection, the device, and Sign out. It was the app's own dark chrome
 * and it read fine under the two machine looks, which are dark too; under the
 * flat-lay, which is a lit paper scene, it cut a black band across the bottom
 * of the picture. A corner button costs the scene nothing and gives those
 * three things somewhere to live.
 *
 * M7 replaces this with frameless chrome and a tray icon.
 */
export function Shell({ children, settings }: { children: ReactNode; settings: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)

  // A menu that cannot be dismissed by clicking away is a trap, and the scene
  // behind it has click handlers of its own.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="shell">
      {children}

      <div className="settings" ref={root}>
        <button
          type="button"
          className="settings__button"
          aria-label="Settings"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          <svg width="18" height="18" viewBox="0 0 22 22" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="3.1" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M11 2.6v2.2M11 17.2v2.2M2.6 11h2.2M17.2 11h2.2M5.1 5.1l1.6 1.6M15.3 15.3l1.6 1.6M16.9 5.1l-1.6 1.6M6.7 15.3l-1.6 1.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {open ? <div className="settings__menu">{settings}</div> : null}
      </div>
    </div>
  )
}
