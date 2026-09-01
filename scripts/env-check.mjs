#!/usr/bin/env node
/**
 * Vuelta environment check — the `activate`-equivalent for this project.
 *
 * Node has no virtualenv. `node_modules/` gives dependency isolation for free,
 * but nothing pins the interpreter, the package manager, or exact versions.
 * This script asserts all three and fails loudly when the environment drifts.
 *
 * Run: npm run env:check
 *
 * Deliberately dependency-free — it must be able to run *before* and
 * *independently of* a successful install.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const results = []
let failed = false

function record(name, actual, ok, detail) {
  results.push({ name, actual, ok, detail })
  if (!ok) failed = true
}

/**
 * Minimal semver range test. Supports the space-separated comparator form
 * used by this project's `engines` field, e.g. ">=24.12.0 <25".
 * Not a general semver implementation, and does not need to be.
 */
function parseVersion(v) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

function satisfies(version, range) {
  const v = parseVersion(version)
  if (!v) return false
  return range
    .trim()
    .split(/\s+/)
    .every((comparator) => {
      const m = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator)
      if (!m) return false
      const target = parseVersion(m[2])
      if (!target) return false
      const c = compare(v, target)
      switch (m[1] ?? '=') {
        case '>=':
          return c >= 0
        case '<=':
          return c <= 0
        case '>':
          return c > 0
        case '<':
          return c < 0
        default:
          return c === 0
      }
    })
}

// ---------------------------------------------------------------- interpreter
const nodeRange = pkg.engines?.node ?? '*'
const nodeActual = process.versions.node
record('node', nodeActual, satisfies(nodeActual, nodeRange), `required ${nodeRange}`)

// ----------------------------------------------------------- package manager
const pinned = pkg.packageManager ?? ''
const [pinnedName, pinnedVersion] = pinned.split('@')
let npmActual = 'not found'
// When run through `npm run`, npm advertises itself here. Preferred over
// spawning: no child process, and no shell quoting on Windows.
const uaMatch = /\bnpm\/(\S+)/.exec(process.env.npm_config_user_agent ?? '')
if (uaMatch) {
  npmActual = uaMatch[1]
} else {
  try {
    // Standalone invocation. On Windows the shim is npm.cmd, which Node
    // refuses to execute without a shell.
    const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    npmActual = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim()
  } catch {
    /* leave as 'not found' */
  }
}
record(
  pinnedName || 'npm',
  npmActual,
  npmActual === pinnedVersion,
  `pinned ${pinned} (enable Corepack to enforce automatically)`,
)

// ------------------------------------------------------------------ lockfile
const lockPath = join(ROOT, 'package-lock.json')
record('package-lock.json', existsSync(lockPath) ? 'present' : 'missing', existsSync(lockPath), 'commit it — this is the reproducible manifest')

// -------------------------------------------------------------- dependencies
const modulesPath = join(ROOT, 'node_modules')
if (!existsSync(modulesPath)) {
  record('node_modules', 'missing', false, 'run `npm ci`')
} else {
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const drifted = []
  for (const [name, want] of Object.entries(declared)) {
    const manifest = join(modulesPath, ...name.split('/'), 'package.json')
    if (!existsSync(manifest)) {
      drifted.push(`${name} (absent)`)
      continue
    }
    const got = JSON.parse(readFileSync(manifest, 'utf8')).version
    // save-exact=true means every declared version is exact, so this is a
    // straight equality check rather than a range test.
    if (got !== want) drifted.push(`${name} ${got} != ${want}`)
  }
  record(
    'installed deps',
    drifted.length === 0 ? `${Object.keys(declared).length} in sync` : `${drifted.length} drifted`,
    drifted.length === 0,
    drifted.length ? drifted.slice(0, 5).join(', ') : 'exact-pinned',
  )
}

// ------------------------------------------------------------------- report
const width = Math.max(...results.map((r) => r.name.length))
console.log('\n  Vuelta environment\n')
for (const r of results) {
  const mark = r.ok ? 'OK  ' : 'FAIL'
  console.log(`  ${r.name.padEnd(width)}  ${String(r.actual).padEnd(14)} ${mark}  ${r.detail}`)
}
console.log('')

if (failed) {
  console.error('  Environment does not match the pins in package.json.\n')
  process.exit(1)
}
console.log('  Environment matches the pins.\n')
