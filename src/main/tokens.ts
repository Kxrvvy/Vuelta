/**
 * Refresh-token storage, encrypted at rest.
 *
 * CLAUDE.md: "Refresh token → Electron `safeStorage`. Never plaintext."
 *
 * On Windows `safeStorage` is backed by DPAPI via the Credential Manager, so
 * the ciphertext is bound to the OS user account. If encryption is
 * unavailable we do not fall back to writing the token in the clear — we
 * decline to persist it and make the user re-authorize each launch. A
 * degraded-but-secure mode is the only acceptable degradation here.
 */

import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.bin')
}

export function isSecureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function hasStoredSession(): boolean {
  return existsSync(sessionPath())
}

export function saveRefreshToken(token: string): void {
  if (!isSecureStorageAvailable()) {
    // Deliberately a no-op rather than a plaintext write. The caller surfaces
    // this to the user via SetupInfo.secureStorageAvailable.
    return
  }
  writeFileSync(sessionPath(), safeStorage.encryptString(token))
}

export function loadRefreshToken(): string | null {
  if (!isSecureStorageAvailable() || !hasStoredSession()) return null
  try {
    return safeStorage.decryptString(readFileSync(sessionPath()))
  } catch {
    // Ciphertext that will not decrypt (different OS user, corrupted file) is
    // unrecoverable. Drop it so the next launch offers a clean re-authorize.
    clearSession()
    return null
  }
}

export function clearSession(): void {
  rmSync(sessionPath(), { force: true })
}
