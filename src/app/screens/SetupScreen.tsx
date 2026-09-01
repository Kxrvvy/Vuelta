import { useState } from 'react'
import { CLIENT_ID_PATTERN, type SetupInfo } from '../../core/contract.js'

/**
 * First run — spec §3 and §7 (SETUP).
 *
 * Every user registers their own Spotify app and brings their own Client ID,
 * which is how Vuelta stays inside the five-authorized-user cap indefinitely.
 * That makes this screen load-bearing: it is the whole onboarding funnel, and
 * the spec calls its friction the price of the distribution model.
 *
 * The Premium requirement is stated here rather than only in the README,
 * because that is where someone about to fail will actually read it.
 */
export function SetupScreen({
  setup,
  busy,
  error,
  onSave,
  onCopy,
}: {
  setup: SetupInfo
  busy: boolean
  error: string | null
  onSave: (clientId: string) => void
  onCopy: (text: string) => void
}) {
  const [value, setValue] = useState(setup.clientId ?? '')
  const [copied, setCopied] = useState(false)

  const looksValid = CLIENT_ID_PATTERN.test(value.trim())

  const copy = () => {
    onCopy(setup.redirectUri)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="screen">
      <h2>Set up</h2>
      <h1>Connect Vuelta to your own Spotify app</h1>
      <p>
        Spotify allows five users per app, so Vuelta asks you to register your own. It takes about
        two minutes and only has to be done once.
      </p>

      <ol>
        <li>
          Open the <a href="https://developer.spotify.com/dashboard">Spotify developer dashboard</a>{' '}
          and create an app.
        </li>
        <li>
          Add this exact Redirect URI:
          <div className="uri">
            <code>{setup.redirectUri}</code>
            <button type="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </li>
        <li>
          In the app’s settings, add your own Spotify account to the user list. Skipping this is the
          most common reason Vuelta fails to connect.
        </li>
        <li>Copy the app’s Client ID and paste it below.</li>
      </ol>

      <div className="field">
        <label htmlFor="client-id">
          <h2>Client ID</h2>
        </label>
        <input
          id="client-id"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="32 characters, digits and a–f"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && looksValid && !busy) onSave(value.trim())
          }}
        />
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!looksValid || busy}
          onClick={() => onSave(value.trim())}
        >
          Save and continue
        </button>
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          Spotify Premium is required.
        </span>
      </div>
    </div>
  )
}
