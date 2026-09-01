#!/usr/bin/env node
/**
 * Security guardrails, checked mechanically.
 *
 * The layer boundaries in this project are enforced by the compiler and the
 * linter rather than by discipline. The security rules deserve the same
 * treatment: a rule nothing checks is a rule that decays.
 *
 * Run: npm run security:check   (also part of `npm run verify`)
 *
 * Dependency-free on purpose.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const checks = []
let failed = false

function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  if (!ok) failed = true
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Secrets must never be committed.
// ---------------------------------------------------------------------------

let trackedEnv = ''
try {
  trackedEnv = execFileSync('git', ['ls-files', '.env', '.env.*'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '.env.example')
    .join(', ')
} catch {
  /* not a git repo; skip rather than fail */
}
check(
  'env files untracked',
  trackedEnv === '',
  trackedEnv === '' ? 'no .env committed' : `TRACKED BY GIT: ${trackedEnv} — run: git rm --cached`,
)

const gitignore = readIfExists(join(ROOT, '.gitignore')) ?? ''
check(
  '.gitignore covers .env',
  /^\.env$/m.test(gitignore),
  /^\.env$/m.test(gitignore) ? 'present' : 'add `.env` to .gitignore',
)

// ---------------------------------------------------------------------------
// 2. Nothing secret-shaped may live in an env file.
//
//    electron-vite inlines these into the shipped bundle at build time, so
//    every value is effectively public. Names are the only signal available.
// ---------------------------------------------------------------------------

const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|_KEY|APIKEY|API_KEY|TOKEN|AUTH)/i

for (const file of ['.env', '.env.example']) {
  const contents = readIfExists(join(ROOT, file))
  if (contents === null) continue

  const assignments = contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim())

  const suspicious = assignments.filter((name) => SECRET_NAME.test(name))
  check(
    `${file}: no secret-shaped names`,
    suspicious.length === 0,
    suspicious.length === 0
      ? `${assignments.length} var(s), all public-safe`
      : `${suspicious.join(', ')} — these are inlined into the shipped bundle`,
  )

  // A bare VITE_ prefix reaches the renderer, the least-trusted process.
  const renderer = assignments.filter((name) => name.startsWith('VITE_'))
  check(
    `${file}: no bare VITE_ vars`,
    renderer.length === 0,
    renderer.length === 0
      ? 'none'
      : `${renderer.join(', ')} — bare VITE_ is exposed to the renderer; use MAIN_VITE_`,
  )
}

// ---------------------------------------------------------------------------
// 3. No hardcoded credentials in source.
// ---------------------------------------------------------------------------

const sourceFiles = walk(join(ROOT, 'src')).filter((f) =>
  ['.ts', '.tsx', '.mjs', '.js'].includes(extname(f)),
)

const HARDCODED = [
  {
    label: 'client secret',
    // A client_secret key with a non-empty literal value assigned to it.
    pattern: /client_?secret\s*[:=]\s*['"`][^'"`\s]+['"`]/i,
  },
  {
    label: 'Spotify Client ID literal',
    // 32 hex characters as a bare string literal. The Client ID is not secret,
    // but hardcoding one breaks the bring-your-own-Client-ID model.
    pattern: /['"`][0-9a-f]{32}['"`]/i,
  },
  {
    label: 'bearer token literal',
    pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/,
  },
]

const hardcodedHits = []
for (const file of sourceFiles) {
  const contents = readFileSync(file, 'utf8')
  for (const { label, pattern } of HARDCODED) {
    if (pattern.test(contents)) hardcodedHits.push(`${relative(ROOT, file)} (${label})`)
  }
}
check(
  'no hardcoded credentials in src/',
  hardcodedHits.length === 0,
  hardcodedHits.length === 0 ? `${sourceFiles.length} files scanned` : hardcodedHits.join('; '),
)

// ---------------------------------------------------------------------------
// 4. Electron hardening must not regress.
//
//    These three settings are what make the preload bridge the only way into
//    the main process. Turning any of them off silently would hand the
//    renderer the run of the machine.
// ---------------------------------------------------------------------------

const mainSource = sourceFiles
  .filter((f) => f.includes(`${'src'}${join('/', 'main')}`) || f.includes(join('src', 'main')))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

const HARDENING = [
  { name: 'contextIsolation', bad: /contextIsolation\s*:\s*false/ },
  { name: 'nodeIntegration', bad: /nodeIntegration\s*:\s*true/ },
  { name: 'sandbox', bad: /sandbox\s*:\s*false/ },
  { name: 'webSecurity', bad: /webSecurity\s*:\s*false/ },
  { name: 'allowRunningInsecureContent', bad: /allowRunningInsecureContent\s*:\s*true/ },
]

const regressions = HARDENING.filter(({ bad }) => bad.test(mainSource)).map(({ name }) => name)
check(
  'electron hardening intact',
  regressions.length === 0,
  regressions.length === 0
    ? 'contextIsolation on, nodeIntegration off, sandbox on'
    : `WEAKENED: ${regressions.join(', ')}`,
)

// Positive assertion: the settings are actually present, not merely un-negated.
const asserted = ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true'].filter((s) =>
  mainSource.includes(s),
)
check(
  'hardening explicitly set',
  asserted.length === 3,
  asserted.length === 3 ? 'all three declared' : `only found: ${asserted.join(', ') || 'none'}`,
)

// ---------------------------------------------------------------------------
// 5. The refresh token must never be written unencrypted.
// ---------------------------------------------------------------------------

const tokens = readIfExists(join(ROOT, 'src', 'main', 'tokens.ts')) ?? ''
check(
  'refresh token encrypted at rest',
  tokens.includes('safeStorage.encryptString') && tokens.includes('isEncryptionAvailable'),
  tokens.includes('safeStorage.encryptString')
    ? 'safeStorage with availability guard'
    : 'tokens.ts does not encrypt via safeStorage',
)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const width = Math.max(...checks.map((c) => c.name.length))
console.log('\n  Vuelta security check\n')
for (const c of checks) {
  console.log(`  ${c.name.padEnd(width)}  ${c.ok ? 'OK  ' : 'FAIL'}  ${c.detail}`)
}
console.log('')

if (failed) {
  console.error('  Security check failed.\n')
  process.exit(1)
}
console.log('  All security checks passed.\n')
