/**
 * CONNECTING — spec §7. OAuth is in flight, or we are hunting for a device.
 */
export function ConnectingScreen() {
  return (
    <div className="screen screen--centered">
      <h1>Connecting…</h1>
      <p>
        Approve Vuelta in the browser window that just opened. This page will pick things up as soon
        as you do.
      </p>
    </div>
  )
}
