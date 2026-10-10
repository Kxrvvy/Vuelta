/**
 * Every texture in the scene, drawn procedurally at runtime.
 *
 * No image files, no CDN, nothing to load. That keeps the packaged app inside
 * its Content-Security-Policy (`default-src 'self'`) with no network access,
 * and it means the look is parameterised rather than baked — change a number
 * here and the material changes, instead of needing a round trip through an
 * image editor.
 *
 * Textures are cached: each is built once and reused for the life of the
 * renderer.
 */

import type {
  Texture} from 'three';
import {
  CanvasTexture,
  type ColorSpace,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace
} from 'three'
import { RECORD } from '../geometry/dimensions.js'

const TAU = Math.PI * 2

function canvas(size: number, height = size): CanvasRenderingContext2D {
  const element = document.createElement('canvas')
  element.width = size
  element.height = height
  const context = element.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')
  return context
}

function toTexture(context: CanvasRenderingContext2D, colorSpace?: ColorSpace): CanvasTexture {
  const texture = new CanvasTexture(context.canvas)
  if (colorSpace) texture.colorSpace = colorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  return texture
}

const cache = new Map<string, Texture>()
function cached<T extends Texture>(key: string, build: () => T): T {
  const existing = cache.get(key)
  if (existing) return existing as T
  const made = build()
  cache.set(key, made)
  return made
}

/** Call once on teardown so the GPU memory goes back. */
export function disposeTextures(): void {
  for (const texture of cache.values()) texture.dispose()
  cache.clear()
}

// ---------------------------------------------------------------------------
// Vinyl grooves
//
// An honest note on what is being drawn here. A real LP groove pitch is about
// 0.09 mm. A 2048 px texture spread across a 302 mm record resolves 0.15 mm per
// pixel, so individual grooves are physically below the Nyquist limit — trying
// to draw them produces moiré, not detail.
//
// What the reference photograph actually shows is *banding*: the broad
// concentric light and dark rings that come from loudness varying across the
// side, at a scale of millimetres. That is what is drawn. The fine specular
// character comes from the material's anisotropy instead, which is resolution
// independent and therefore the right tool for it.
// ---------------------------------------------------------------------------

const GROOVE_TEXTURE_SIZE = 2048

/** Surface height, in arbitrary units, as a function of physical radius. */
function grooveHeight(radius: number): number {
  if (radius > RECORD.GROOVE_OUTER || radius < RECORD.GROOVE_INNER) return 0
  return (
    0.55 * Math.sin((radius * TAU) / 0.0042) +
    0.3 * Math.sin((radius * TAU) / 0.0017 + 1.3) +
    0.15 * Math.sin((radius * TAU) / 0.0009 + 2.1) +
    0.08 * Math.sin((radius * TAU) / 0.0008 + 0.7)
  )
}

/** Precomputed radial profile. The pattern is 1-D in r, so a table is exact. */
function radialProfile(samples: number) {
  const height = new Float32Array(samples)
  const slope = new Float32Array(samples)
  const step = RECORD.RADIUS / (samples - 1)

  for (let i = 0; i < samples; i++) height[i] = grooveHeight(i * step)
  for (let i = 1; i < samples - 1; i++) {
    slope[i] = ((height[i + 1] ?? 0) - (height[i - 1] ?? 0)) / (2 * step)
  }
  return { height, slope, step }
}

export function grooveNormalMap(): CanvasTexture {
  return cached('groove-normal', () => {
    const size = GROOVE_TEXTURE_SIZE
    const context = canvas(size)
    const image = context.createImageData(size, size)
    const data = image.data
    const { slope } = radialProfile(4096)

    const half = size / 2
    // Scales the baked slope into a sane tangent-space normal. Fine control
    // lives on the material's normalScale, not here.
    const strength = 0.00018

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half
        const dy = (y - half) / half
        const unit = Math.hypot(dx, dy)
        const index = (y * size + x) * 4

        if (unit > 1) {
          data[index] = 128
          data[index + 1] = 128
          data[index + 2] = 255
          data[index + 3] = 255
          continue
        }

        const sampleIndex = Math.min(4095, Math.round(unit * 4095))
        const dhdr = (slope[sampleIndex] ?? 0) * strength
        // Perturbation is purely radial, so project it onto the radial unit
        // vector. UVs on the disc are planar, so tangent space ≈ world xz.
        const nx = unit > 1e-6 ? (-dhdr * dx) / unit : 0
        const ny = unit > 1e-6 ? (-dhdr * dy) / unit : 0
        const length = Math.hypot(nx, ny, 1)

        data[index] = Math.round(((nx / length) * 0.5 + 0.5) * 255)
        data[index + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255)
        data[index + 2] = Math.round((1 / length) * 255)
        data[index + 3] = 255
      }
    }

    context.putImageData(image, 0, 0)
    return toTexture(context)
  })
}

export function grooveRoughnessMap(): CanvasTexture {
  return cached('groove-roughness', () => {
    const size = GROOVE_TEXTURE_SIZE
    const context = canvas(size)
    const image = context.createImageData(size, size)
    const data = image.data
    const { height } = radialProfile(4096)

    const half = size / 2

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half
        const dy = (y - half) / half
        const unit = Math.hypot(dx, dy)
        const radius = unit * RECORD.RADIUS
        const index = (y * size + x) * 4

        let roughness: number
        if (radius > RECORD.GROOVE_OUTER) {
          // Lead-in and rim: pressed smooth, noticeably glossier than the
          // grooved area. This band is what catches the hard highlight.
          roughness = 0.1
        } else if (radius < RECORD.GROOVE_INNER) {
          roughness = 0.12 // run-out land
        } else {
          const sampleIndex = Math.min(4095, Math.round(unit * 4095))
          roughness = 0.26 + (height[sampleIndex] ?? 0) * 0.055
        }

        const value = Math.round(Math.max(0, Math.min(1, roughness)) * 255)
        data[index] = value
        data[index + 1] = value
        data[index + 2] = value
        data[index + 3] = 255
      }
    }

    context.putImageData(image, 0, 0)
    return toTexture(context)
  })
}

/**
 * Direction map for the vinyl's anisotropic highlight.
 *
 * This is the texture that actually sells the record. A real LP's sheen runs
 * *along* the grooves — tangentially — which is why the highlight on a record
 * is a broad arc rather than a round hotspot. Encoding the tangential vector
 * per-pixel in R/G gives three exactly that, and unlike the groove detail it
 * does not fight the texture resolution, because direction varies smoothly.
 *
 * R/G: direction in tangent/bitangent space, remapped from [-1,1].
 * B:   strength, multiplied by the material's own `anisotropy`.
 */
export function grooveAnisotropyMap(): CanvasTexture {
  return cached('groove-anisotropy', () => {
    const size = 1024
    const context = canvas(size)
    const image = context.createImageData(size, size)
    const data = image.data
    const half = size / 2

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half
        const dy = (y - half) / half
        const unit = Math.hypot(dx, dy)
        const index = (y * size + x) * 4

        // Tangential unit vector: the radial vector turned 90°.
        const tx = unit > 1e-6 ? -dy / unit : 0
        const ty = unit > 1e-6 ? dx / unit : 0

        const radius = unit * RECORD.RADIUS
        const inGrooves = radius <= RECORD.GROOVE_OUTER && radius >= RECORD.GROOVE_INNER
        const strength = inGrooves ? 1 : 0.35

        data[index] = Math.round((tx * 0.5 + 0.5) * 255)
        data[index + 1] = Math.round((ty * 0.5 + 0.5) * 255)
        data[index + 2] = Math.round(strength * 255)
        data[index + 3] = 255
      }
    }

    context.putImageData(image, 0, 0)
    return toTexture(context)
  })
}

// ---------------------------------------------------------------------------
// Label — the red A.S.R / LEDA fallback used when there is no album art
// ---------------------------------------------------------------------------

export function fallbackLabelTexture(): CanvasTexture {
  return cached('label-fallback', () => {
    const size = 1024
    const context = canvas(size)
    const mid = size / 2

    context.fillStyle = '#c0291f'
    context.beginPath()
    context.arc(mid, mid, mid, 0, TAU)
    context.fill()

    // Slightly deeper red at the rim, as printed labels always are.
    const vignette = context.createRadialGradient(mid, mid, mid * 0.55, mid, mid, mid)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(60,8,4,0.55)')
    context.fillStyle = vignette
    context.beginPath()
    context.arc(mid, mid, mid, 0, TAU)
    context.fill()

    context.fillStyle = '#17110f'
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    context.font = `600 ${size * 0.075}px Georgia, "Times New Roman", serif`
    context.letterSpacing = `${size * 0.012}px`
    context.fillText('A.S.R', mid, mid - size * 0.135)

    context.font = `700 ${size * 0.2}px Georgia, "Times New Roman", serif`
    context.letterSpacing = `${size * 0.008}px`
    context.fillText('LEDA', mid, mid + size * 0.005)

    context.strokeStyle = '#17110f'
    context.lineWidth = size * 0.012
    for (const offset of [-0.075, 0.09]) {
      context.beginPath()
      context.moveTo(mid - size * 0.215, mid + size * offset)
      context.lineTo(mid + size * 0.215, mid + size * offset)
      context.stroke()
    }

    // Small stars arcing over the top, as on the reference label.
    context.fillStyle = '#17110f'
    for (let i = 0; i < 7; i++) {
      const angle = -Math.PI * 0.78 + (i / 6) * Math.PI * 0.56
      star(context, mid + Math.cos(angle) * size * 0.33, mid + Math.sin(angle) * size * 0.33, size * 0.014)
    }

    return toTexture(context, SRGBColorSpace)
  })
}

function star(context: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  context.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45
    const a = (i / 10) * TAU - Math.PI / 2
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fill()
}

// ---------------------------------------------------------------------------
// Cabinet surfaces
// ---------------------------------------------------------------------------

export function woodTexture(): CanvasTexture {
  return cached('wood', () => {
    const size = 1024
    const context = canvas(size)

    context.fillStyle = '#6b4a35'
    context.fillRect(0, 0, size, size)

    // Grain: long, mostly-straight streaks with a slow wander, which is what
    // reads as walnut rather than as noise.
    for (let i = 0; i < 900; i++) {
      const y = Math.random() * size
      const darkness = Math.random()
      context.strokeStyle = `rgba(${darkness > 0.6 ? '140,104,74' : '52,33,21'},${0.05 + Math.random() * 0.16})`
      context.lineWidth = 0.6 + Math.random() * 2.4
      context.beginPath()
      context.moveTo(0, y)
      let drift = y
      for (let x = 0; x <= size; x += 32) {
        drift += (Math.random() - 0.5) * 5
        context.lineTo(x, drift)
      }
      context.stroke()
    }

    // A few darker heartwood bands.
    for (let i = 0; i < 7; i++) {
      const y = Math.random() * size
      context.strokeStyle = 'rgba(40,24,14,0.28)'
      context.lineWidth = 6 + Math.random() * 14
      context.beginPath()
      context.moveTo(0, y)
      context.bezierCurveTo(size * 0.3, y + 18, size * 0.6, y - 18, size, y + 6)
      context.stroke()
    }

    const texture = toTexture(context, SRGBColorSpace)
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    return texture
  })
}

/**
 * The perforated brass speaker grille. Drawn as a staggered hole grid, which
 * is what the reference shows — not a square grid.
 */
export function grilleTexture(): CanvasTexture {
  return cached('grille', () => {
    const size = 1024
    const context = canvas(size, size / 4)
    const height = size / 4

    context.fillStyle = '#c99a55'
    context.fillRect(0, 0, size, height)

    const pitch = 26
    context.fillStyle = '#140d07'
    for (let row = 0; row * pitch < height + pitch; row++) {
      const y = row * pitch
      const stagger = row % 2 === 0 ? 0 : pitch / 2
      for (let column = 0; column * pitch < size + pitch; column++) {
        context.beginPath()
        context.arc(column * pitch + stagger, y, pitch * 0.26, 0, TAU)
        context.fill()
      }
    }

    const texture = toTexture(context, SRGBColorSpace)
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    return texture
  })
}

// ---------------------------------------------------------------------------
// Environment
//
// An equirectangular map drawn by hand, fed through PMREMGenerator by the
// staging component. This replaces a preset HDRI: presets are fetched from a
// CDN at runtime, which the packaged CSP forbids and which would make the
// scene depend on the network.
//
// Three softboxes. The long strip across the top is the one doing the real
// work — it is what draws the sheen across the vinyl.
// ---------------------------------------------------------------------------

export function studioEnvironmentTexture(): CanvasTexture {
  return cached('environment', () => {
    const width = 1024
    const height = 512
    const context = canvas(width, height)

    const base = context.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#2b2622')
    base.addColorStop(0.45, '#14110f')
    base.addColorStop(1, '#060505')
    context.fillStyle = base
    context.fillRect(0, 0, width, height)

    softbox(context, width * 0.3, height * 0.17, width * 0.34, height * 0.2, 2.4)
    softbox(context, width * 0.76, height * 0.26, width * 0.17, height * 0.14, 1.35)
    softbox(context, width * 0.5, height * 0.05, width * 0.82, height * 0.05, 1.1)

    return toTexture(context)
  })
}

function softbox(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  intensity: number,
): void {
  const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2)
  const peak = Math.min(255, Math.round(150 * intensity))
  gradient.addColorStop(0, `rgb(${peak},${peak},${Math.round(peak * 0.97)})`)
  gradient.addColorStop(0.55, `rgba(${peak},${peak},${peak},0.38)`)
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  context.save()
  context.translate(cx, cy)
  context.scale(1, h / w)
  context.translate(-cx, -cy)
  context.fillStyle = gradient
  context.fillRect(cx - w, cy - w, w * 2, w * 2)
  context.restore()
}
