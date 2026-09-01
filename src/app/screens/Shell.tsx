import type { ReactNode } from 'react'

/**
 * The frame every M0 screen sits in: content above, a thin status strip below.
 * M7 replaces this with frameless chrome and a tray icon.
 */
export function Shell({ children, status }: { children: ReactNode; status: ReactNode }) {
  return (
    <div className="shell">
      {children}
      <div className="footer">{status}</div>
    </div>
  )
}
