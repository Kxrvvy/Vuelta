/**
 * Material definitions for every surface in the scene.
 *
 * Kept apart from the components so the look can be tuned in one place, and
 * so each material is created exactly once rather than per-render.
 */

import {
  Color,
  FrontSide,
  type Texture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  Vector2,
} from 'three'
import {
  grilleTexture,
  grooveAnisotropyMap,
  grooveNormalMap,
  grooveRoughnessMap,
  woodTexture,
} from './textures.js'

const materials = new Map<string, MeshStandardMaterial | MeshPhysicalMaterial>()

function once<T extends MeshStandardMaterial | MeshPhysicalMaterial>(key: string, build: () => T): T {
  const existing = materials.get(key)
  if (existing) return existing as T
  const made = build()
  materials.set(key, made)
  return made
}

export function disposeMaterials(): void {
  for (const material of materials.values()) material.dispose()
  materials.clear()
}

/**
 * Black vinyl.
 *
 * The three things that make this read as a record rather than a black disc:
 * a clearcoat for the lacquer, an anisotropy map so the highlight runs along
 * the grooves instead of pooling, and a roughness map that keeps the smooth
 * lead-in band glossier than the grooved area.
 */
export function vinylMaterial(maxAnisotropicFiltering: number): MeshPhysicalMaterial {
  return once('vinyl', () => {
    const roughness = grooveRoughnessMap()
    const normal = grooveNormalMap()
    const anisotropy = grooveAnisotropyMap()

    // Without this the grooves turn to mush exactly where they matter most —
    // at the grazing angles along the far edge of the disc.
    for (const map of [roughness, normal, anisotropy]) {
      map.anisotropy = maxAnisotropicFiltering
    }

    return new MeshPhysicalMaterial({
      color: new Color('#0a0a0c'),
      roughness: 1,
      roughnessMap: roughness,
      metalness: 0,
      normalMap: normal,
      normalScale: new Vector2(1.1, 1.1),
      anisotropy: 0.85,
      anisotropyMap: anisotropy,
      clearcoat: 1,
      clearcoatRoughness: 0.075,
      envMapIntensity: 1.15,
    })
  })
}

/** The record's rim and underside: same colour, none of the expensive detail. */
export function vinylEdgeMaterial(): MeshStandardMaterial {
  return once('vinyl-edge', () => {
    return new MeshStandardMaterial({
      color: new Color('#0b0b0d'),
      roughness: 0.42,
      metalness: 0,
    })
  })
}

export function labelMaterial(map: Texture | null): MeshStandardMaterial {
  // Not cached: the label changes whenever the track does.
  return new MeshStandardMaterial({
    map,
    color: map ? new Color('#ffffff') : new Color('#c0291f'),
    roughness: 0.62,
    metalness: 0,
  })
}

export function feltMaterial(): MeshStandardMaterial {
  return once('felt', () =>
    new MeshStandardMaterial({
      color: new Color('#15161a'),
      roughness: 0.95,
      metalness: 0,
    }),
  )
}

export function plinthMaterial(): MeshStandardMaterial {
  return once('plinth', () => {
    const map = woodTexture()
    map.wrapS = RepeatWrapping
    map.wrapT = RepeatWrapping
    map.repeat.set(1.6, 1)
    return new MeshStandardMaterial({
      map,
      // White: the wood texture already carries the colour, so tinting here
      // would only darken it twice over.
      color: new Color('#ffffff'),
      roughness: 0.58,
      metalness: 0,
      envMapIntensity: 0.95,
    })
  })
}

/** Satin black for the top deck the platter sits in. */
export function deckMaterial(): MeshStandardMaterial {
  return once('deck', () =>
    new MeshStandardMaterial({
      color: new Color('#1d1a17'),
      roughness: 0.5,
      metalness: 0.2,
    }),
  )
}

export function grilleMaterial(): MeshStandardMaterial {
  return once('grille', () => {
    const map = grilleTexture()
    // One repeat: at four, each hole fell below a pixel on screen and the
    // whole panel averaged out to flat brown.
    map.repeat.set(1, 1)
    return new MeshStandardMaterial({
      map,
      roughness: 0.44,
      metalness: 0.5,
      envMapIntensity: 1.1,
    })
  })
}

/** Polished chrome, for the arm tube and the knob's collar. */
export function chromeMaterial(): MeshStandardMaterial {
  return once('chrome', () =>
    new MeshStandardMaterial({
      color: new Color('#d9dbdd'),
      roughness: 0.12,
      metalness: 1,
      envMapIntensity: 1.4,
    }),
  )
}

/** Moulded black plastic: headshell, pivot housing, feet. */
export function plasticMaterial(): MeshStandardMaterial {
  return once('plastic', () =>
    new MeshStandardMaterial({
      color: new Color('#141416'),
      roughness: 0.46,
      metalness: 0.08,
    }),
  )
}

export function stylusMaterial(): MeshStandardMaterial {
  return once('stylus', () =>
    new MeshStandardMaterial({
      color: new Color('#c62b22'),
      roughness: 0.3,
      metalness: 0.2,
      emissive: new Color('#3a0a06'),
      emissiveIntensity: 0.35,
    }),
  )
}

export function ledMaterial(): MeshStandardMaterial {
  return once('led', () =>
    new MeshStandardMaterial({
      color: new Color('#5ba8ff'),
      emissive: new Color('#3c8dff'),
      emissiveIntensity: 3.2,
      roughness: 0.3,
    }),
  )
}

/**
 * The acrylic lid.
 *
 * Deliberately NOT using `transmission`. It forces three to re-render the
 * whole scene into a separate target every frame, roughly doubling draw cost —
 * and through a flat lid viewed near head-on, refraction contributes almost
 * nothing. What you actually see on the reference is edge brightness and a
 * surface reflection, both of which a cheap transparent material with a strong
 * environment response gives for free.
 */
export function acrylicMaterial(): MeshPhysicalMaterial {
  return once('acrylic', () =>
    new MeshPhysicalMaterial({
      color: new Color('#dfe6ea'),
      transparent: true,
      // Low, and front-faces only. The lid is built from boxes, so every panel
      // presents two surfaces and the walls overlap the top in view — at 0.17
      // double-sided the accumulated alpha fogged the whole record over.
      opacity: 0.075,
      roughness: 0.035,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      ior: 1.49,
      reflectivity: 0.6,
      envMapIntensity: 1.6,
      side: FrontSide,
      depthWrite: false,
    }),
  )
}

/** The lid's cut edges, which catch light far more than its faces do. */
export function acrylicEdgeMaterial(): MeshPhysicalMaterial {
  return once('acrylic-edge', () =>
    new MeshPhysicalMaterial({
      color: new Color('#eef4f7'),
      transparent: true,
      opacity: 0.38,
      roughness: 0.08,
      metalness: 0,
      envMapIntensity: 2.2,
    }),
  )
}
