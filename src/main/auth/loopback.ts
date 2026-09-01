/**
 * The loopback listener that receives Spotify's redirect.
 *
 * Roughly ten lines of real work wrapped in careful lifecycle handling: the
 * server must never outlive the auth attempt that started it, or a failed
 * login leaves port 8888 held until the app quits.
 */

import { createServer, type Server } from 'node:http'
import { redirectUriFor } from '../config.js'
import { VueltaError } from '../errors.js'

export type CallbackServer = {
  port: number
  redirectUri: string
  /** True when the preferred port was taken — the user must add this URI to their dashboard too. */
  isFallbackPort: boolean
  waitForCode(timeoutMs: number): Promise<string>
  close(): Promise<void>
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#141210; color:#e8e2d9;
         font:16px/1.6 "Segoe UI", system-ui, sans-serif; }
  main { text-align:center; max-width:32rem; padding:2rem; }
  h1 { font-weight:500; font-size:1.35rem; margin:0 0 .5rem; letter-spacing:.01em; }
  p { margin:0; color:#a39a8d; }
</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`
}

/**
 * Bind the first available port from `ports`. The list exists only because a
 * fixed port can collide; the first entry is the one users are told to
 * register, and anything else is surfaced as a fallback.
 */
async function listenOnFirstAvailable(server: Server, ports: number[]): Promise<number> {
  for (const port of ports) {
    const bound = await new Promise<boolean>((resolve) => {
      const onError = () => {
        // Any bind failure — EADDRINUSE being the expected one — means try the
        // next port. If every port fails we throw below.
        server.removeListener('listening', onListening)
        resolve(false)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      // Explicit loopback IP: binding 127.0.0.1 keeps this off the network.
      server.listen(port, '127.0.0.1')
    })
    if (bound) return port
  }
  throw new VueltaError(
    'port-unavailable',
    `None of the redirect ports (${ports.join(', ')}) were available. Close whatever is using them and try again.`,
  )
}

export async function startCallbackServer(
  expectedState: string,
  ports: number[],
): Promise<CallbackServer> {
  let settle: ((result: { code: string } | { error: VueltaError }) => void) | null = null
  const received = new Promise<{ code: string } | { error: VueltaError }>((resolve) => {
    settle = resolve
  })

  const finish = (result: { code: string } | { error: VueltaError }) => {
    settle?.(result)
    settle = null
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('Connection', 'close')

    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    const respond = (status: number, title: string, body: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(page(title, body))
    }

    // Validate `state` before anything else on the request is trusted.
    const state = url.searchParams.get('state')
    if (state !== expectedState) {
      respond(400, 'Authorization rejected', 'The security check failed. Start again from Vuelta.')
      finish({
        error: new VueltaError(
          'auth-failed',
          'The state parameter did not match. The authorization was rejected.',
        ),
      })
      return
    }

    const error = url.searchParams.get('error')
    if (error) {
      respond(200, 'Authorization cancelled', 'You can close this tab and return to Vuelta.')
      finish({
        error:
          error === 'access_denied'
            ? new VueltaError('auth-cancelled', 'You declined the authorization request.')
            : new VueltaError('auth-failed', `Spotify returned "${error}".`),
      })
      return
    }

    const code = url.searchParams.get('code')
    if (!code) {
      respond(400, 'Authorization failed', 'Spotify did not return an authorization code.')
      finish({ error: new VueltaError('auth-failed', 'No authorization code in the callback.') })
      return
    }

    respond(200, 'Vuelta is connected', 'You can close this tab and return to the app.')
    finish({ code })
  })

  const port = await listenOnFirstAvailable(server, ports)

  const close = async (): Promise<void> => {
    // Kill keep-alive sockets first, or close() waits on the browser's
    // still-open connection and this hangs.
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return {
    port,
    redirectUri: redirectUriFor(port),
    isFallbackPort: port !== ports[0],

    async waitForCode(timeoutMs: number): Promise<string> {
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<{ error: VueltaError }>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              error: new VueltaError(
                'auth-cancelled',
                'Timed out waiting for Spotify to redirect back.',
              ),
            }),
          timeoutMs,
        )
      })

      try {
        const result = await Promise.race([received, timeout])
        if ('error' in result) throw result.error
        return result.code
      } finally {
        clearTimeout(timer)
      }
    },

    close,
  }
}
