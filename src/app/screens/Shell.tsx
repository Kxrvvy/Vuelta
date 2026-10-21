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
/**
 * A cog, built from its teeth rather than drawn by hand.
 *
 * What was here was a ring with eight thin rays around it, which is a sun.
 * A gear reads as a gear because of the *teeth*: short trapezoidal lugs with
 * flat tops, each as wide as the gap beside it, not spokes radiating into
 * space.
 *
 * Generated so the shape stays regular — eight teeth placed by hand never
 * quite are — and so the proportions can be adjusted in one place.
 */
function cogPath(teeth: number, outer: number, root: number, hub: number): string {
  const centre = 11
  const step = (Math.PI * 2) / teeth
  /** Half the angular width of a tooth's flat top, and of its flank. */
  const top = step * 0.17
  const flank = step * 0.31

  const at = (radius: number, angle: number) =>
    `${(centre + radius * Math.cos(angle)).toFixed(2)} ${(centre + radius * Math.sin(angle)).toFixed(2)}`

  const parts: string[] = []
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step - Math.PI / 2
    parts.push(
      `${i === 0 ? 'M' : 'L'}${at(root, a - flank)}`,
      `L${at(outer, a - top)}`,
      `L${at(outer, a + top)}`,
      `L${at(root, a + flank)}`,
    )
  }
  parts.push('Z')

  // The bore, as a second sub-path. With fill-rule evenodd it is cut out of
  // the body rather than drawn on top of it, so the cog works on any ground.
  parts.push(
    `M${centre + hub} ${centre}`,
    `A${hub} ${hub} 0 1 0 ${centre - hub} ${centre}`,
    `A${hub} ${hub} 0 1 0 ${centre + hub} ${centre}`,
    'Z',
  )
  return parts.join(' ')
}

const COG = cogPath(8, 9.6, 7.3, 3.3)

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
          <svg width="18" height="18" viewBox="0 0 22 22" fill="currentColor" aria-hidden>
            <path d={COG} fillRule="evenodd" />
          </svg>
        </button>

        {open ? <div className="settings__menu">{settings}</div> : null}
      </div>
    </div>
  )
}
