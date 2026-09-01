import type { VueltaErrorCode } from '../core/contract.js'

/**
 * Every failure the main process surfaces carries one of the codes from the
 * core contract, so the renderer can choose a designed screen instead of
 * printing a stack trace. Spec §3 singles out the 403 case: it will be the
 * most common support issue, and it must never reach the user as raw text.
 */
export class VueltaError extends Error {
  readonly code: VueltaErrorCode

  constructor(code: VueltaErrorCode, message: string) {
    super(message)
    this.name = 'VueltaError'
    this.code = code
  }
}

export function toVueltaError(cause: unknown): VueltaError {
  if (cause instanceof VueltaError) return cause
  if (cause instanceof Error) {
    // Undici surfaces offline/DNS problems as a generic TypeError.
    const networkish = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(
      `${cause.message} ${String((cause as { cause?: unknown }).cause ?? '')}`,
    )
    return new VueltaError(networkish ? 'network' : 'unknown', cause.message)
  }
  return new VueltaError('unknown', String(cause))
}
