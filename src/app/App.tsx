import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { createVueltaStore } from '../core/store.js'
import { AuthFailedScreen } from './screens/AuthFailedScreen.js'
import { ConnectingScreen } from './screens/ConnectingScreen.js'
import { IdleScreen } from './screens/IdleScreen.js'
import { NoDeviceScreen } from './screens/NoDeviceScreen.js'
import { NotAllowlistedScreen } from './screens/NotAllowlistedScreen.js'
import { NowPlayingText } from './screens/NowPlayingText.js'
import { SetupScreen } from './screens/SetupScreen.js'
import { Shell } from './screens/Shell.js'
import { useStoreValue } from './useStore.js'

/**
 * The store is created once, outside the component, so it survives remounts and
 * belongs to the app rather than to a React tree. Core owns the state; React
 * subscribes from the outside.
 */
const store = createVueltaStore()

/**
 * The 3D skin, as its own chunk.
 *
 * Lazy rather than a direct import so three.js never lands in the main bundle.
 * The render below is additionally guarded by `import.meta.env.DEV`, so in a
 * packaged build the chunk is never requested.
 */
const Harness = import.meta.env.DEV
  ? lazy(() => import('../skins/3d/dev/Harness.js').then((module) => ({ default: module.Harness })))
  : null

export function App() {
  const [showSkin, setShowSkin] = useState(false)
  const app = useStoreValue(store, (state) => state.app)
  const setup = useStoreValue(store, (state) => state.setup)
  const snapshot = useStoreValue(store, (state) => state.snapshot)

  const [busy, setBusy] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  const poll = useCallback(async () => {
    store.getState().applyPoll(await window.vuelta.getPlayer())
  }, [])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      await poll()
    } finally {
      setBusy(false)
    }
  }, [poll])

  // Launch: read config, tell the state machine what we found, and reconnect
  // straight away if a refresh token is already on disk.
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
      if (info.clientId !== null && info.hasStoredSession) await poll()
    })()
    return () => {
      cancelled = true
    }
  }, [poll])

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
      await poll()
    } finally {
      setBusy(false)
    }
  }, [poll])

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

  const retry = useCallback(() => {
    store.getState().dispatch({ type: 'RETRY' })
  }, [])

  const copy = useCallback((text: string) => {
    void window.vuelta.copyText(text)
  }, [])

  // Dev-only: the 3D skin, driven by a synthetic RenderState. Replaced by the
  // real store at M1. `import.meta.env.DEV` is false in a packaged build, so
  // this whole branch and its chunk drop out.
  if (import.meta.env.DEV && showSkin && Harness) {
    return (
      <Suspense fallback={<div className="screen screen--centered">Loading scene…</div>}>
        <Harness onExit={() => setShowSkin(false)} />
      </Suspense>
    )
  }

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
        return <NoDeviceScreen busy={busy} onRetry={() => void refresh()} />
      case 'playing':
      case 'paused':
        return (
          <NowPlayingText snapshot={snapshot} busy={busy} onRefresh={() => void refresh()} />
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
      status={
        <>
          <span className="row" style={{ gap: '0.5rem' }}>
            <span className={app.phase === 'playing' ? 'dot dot--live' : 'dot'} />
            {statusLabel(app.phase)}
            {snapshot?.deviceName ? ` · ${snapshot.deviceName}` : ''}
          </span>
          <span className="row" style={{ gap: '0.9rem' }}>
            {import.meta.env.DEV ? (
              <button type="button" className="link" onClick={() => setShowSkin(true)}>
                3D skin
              </button>
            ) : null}
            {!setup.secureStorageAvailable ? (
              <span style={{ color: 'var(--danger)' }}>Secure storage unavailable</span>
            ) : null}
            {setup.portIsFallback ? <span>Port {setup.redirectPort}</span> : null}
            {app.phase !== 'setup' ? (
              <button type="button" className="link" onClick={() => void startOver()}>
                Sign out
              </button>
            ) : null}
          </span>
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
