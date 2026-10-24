import { useCallback, useEffect, useState } from 'react'
import { createVueltaStore } from '../core/store.js'
import { Stage } from '../views/Stage.js'
import { AuthFailedScreen } from './screens/AuthFailedScreen.js'
import { ConnectingScreen } from './screens/ConnectingScreen.js'
import { IdleScreen } from './screens/IdleScreen.js'
import { NoDeviceScreen } from './screens/NoDeviceScreen.js'
import { NotAllowlistedScreen } from './screens/NotAllowlistedScreen.js'
import { SetupScreen } from './screens/SetupScreen.js'
import { Shell } from './screens/Shell.js'
import { useStoreValue } from './useStore.js'
import { useSync } from './useSync.js'

/**
 * The store is created once, outside the component, so it survives remounts and
 * belongs to the app rather than to a React tree. Core owns the state; React
 * subscribes from the outside.
 */
const store = createVueltaStore()

/** Phases in which there is a session worth polling for. */
const CONNECTED = new Set(['connecting', 'no-device', 'playing', 'paused'])

export function App() {
  const app = useStoreValue(store, (state) => state.app)
  const setup = useStoreValue(store, (state) => state.setup)

  const [busy, setBusy] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  // M1's state layer. It owns the poll loop and the clock from here on, so
  // nothing else in this file fetches playback.
  const sync = useSync(store, CONNECTED.has(app.phase))

  // Launch: read config and tell the state machine what we found. Polling
  // starts on its own once the phase says there is a session.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const info = await window.vuelta.getSetup()
      if (cancelled) return
      const { setSetup, dispatch } = store.getState()
      setSetup(info)
      dispatch({
        type: 'LAUNCHED',
        hasClientId: info.clientId !== null,
        hasStoredSession: info.hasStoredSession,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async () => {
    setBusy(true)
    store.getState().dispatch({ type: 'AUTH_STARTED' })
    try {
      const outcome = await window.vuelta.startAuth()
      const { dispatch, setSetup } = store.getState()
      if (!outcome.ok) {
        dispatch({ type: 'AUTH_FAILED', code: outcome.code, message: outcome.message })
        return
      }
      dispatch({ type: 'AUTH_SUCCEEDED' })
      // The port may have moved to a fallback during the flow.
      setSetup(await window.vuelta.getSetup())
    } finally {
      setBusy(false)
    }
  }, [])

  const saveClientId = useCallback(async (clientId: string) => {
    setBusy(true)
    try {
      const result = await window.vuelta.saveClientId(clientId)
      if (!result.ok) {
        setSetupError(result.message)
        return
      }
      setSetupError(null)
      store.getState().setSetup(result.setup)
      store.getState().dispatch({ type: 'CLIENT_ID_SAVED' })
    } finally {
      setBusy(false)
    }
  }, [])

  const startOver = useCallback(async () => {
    await window.vuelta.signOut()
    const { dispatch, setSetup } = store.getState()
    dispatch({ type: 'SIGNED_OUT' })
    setSetup(await window.vuelta.getSetup())
  }, [])

  /**
   * Sign out and straight back in, to widen the granted scopes.
   *
   * A refresh token carries the scopes it was issued with and a refresh never
   * adds to them, so a session from before the playlist scopes existed has to
   * be replaced rather than renewed. Doing both halves here keeps it one click
   * from the browser bar instead of a trip through the idle screen.
   */
  const reconnect = useCallback(async () => {
    await window.vuelta.signOut()
    store.getState().dispatch({ type: 'SIGNED_OUT' })
    await connect()
  }, [connect])

  const retry = useCallback(() => {
    store.getState().dispatch({ type: 'RETRY' })
  }, [])

  const copy = useCallback((text: string) => {
    void window.vuelta.copyText(text)
  }, [])

  const checkAgain = useCallback(async () => {
    setBusy(true)
    try {
      await sync.pollNow()
    } finally {
      setBusy(false)
    }
  }, [sync])

  // Config hasn't been read yet. One frame, typically.
  if (!setup) return <div className="screen screen--centered" />

  const message = app.error?.message ?? null

  const screen = (() => {
    switch (app.phase) {
      case 'setup':
        return (
          <SetupScreen
            setup={setup}
            busy={busy}
            error={setupError}
            onSave={(id) => void saveClientId(id)}
            onCopy={copy}
          />
        )
      case 'idle':
        return <IdleScreen busy={busy} onConnect={() => void connect()} />
      case 'connecting':
        return <ConnectingScreen />
      case 'no-device':
        return (
          <Stage
            sync={sync}
            scopesStale={setup.scopesStale}
            onReconnect={() => void reconnect()}
            notice={
              <NoDeviceScreen
                busy={busy}
                onRetry={() => void checkAgain()}
                launch={sync.launch}
                onLaunch={() => void sync.runLaunch()}
              />
            }
          />
        )
      case 'playing':
      case 'paused':
        return (
          <Stage
            sync={sync}
            scopesStale={setup.scopesStale}
            onReconnect={() => void reconnect()}
          />
        )
      case 'not-allowlisted':
        return (
          <NotAllowlistedScreen
            setup={setup}
            message={message}
            busy={busy}
            onRetry={retry}
            onStartOver={() => void startOver()}
          />
        )
      case 'auth-failed':
        return (
          <AuthFailedScreen
            message={message}
            busy={busy}
            onRetry={retry}
            onStartOver={() => void startOver()}
          />
        )
    }
  })()

  return (
    <Shell
      settings={
        <>
          <span className="settings__status">
            <span className={app.phase === 'playing' ? 'dot dot--live' : 'dot'} />
            {statusLabel(app.phase)}
          </span>
          {sync.readout.deviceName ? (
            <span className="settings__note">{sync.readout.deviceName}</span>
          ) : null}
          {!setup.secureStorageAvailable ? (
            <span className="settings__note settings__note--warn">Secure storage unavailable</span>
          ) : null}
          {setup.portIsFallback ? (
            <span className="settings__note">Port {setup.redirectPort}</span>
          ) : null}
          {app.phase !== 'setup' ? (
            <button type="button" className="settings__item" onClick={() => void startOver()}>
              Sign out
            </button>
          ) : null}
        </>
      }
    >
      {screen}
    </Shell>
  )
}

function statusLabel(phase: string): string {
  switch (phase) {
    case 'setup':
      return 'Not set up'
    case 'idle':
      return 'Not connected'
    case 'connecting':
      return 'Connecting'
    case 'no-device':
      return 'No device'
    case 'playing':
      return 'Playing'
    case 'paused':
      return 'Paused'
    default:
      return 'Problem'
  }
}
