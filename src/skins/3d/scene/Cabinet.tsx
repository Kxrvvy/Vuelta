/**
 * The plinth and front panel: wood body, perforated brass grille, volume knob,
 * power LED, feet.
 *
 * None of this is visible from directly overhead, which is why the default
 * camera carries a 20° tilt. It also means the console view at M5 is a camera
 * move rather than a new build — the machine already exists.
 */

import { FOOT, GRILLE, PLATTER, PLINTH } from '../geometry/dimensions.js'
import { deckMaterial, grilleMaterial, plasticMaterial, plinthMaterial } from '../materials/surfaces.js'

const FRONT_Z = PLINTH.CENTER_Z + PLINTH.DEPTH / 2

export function Cabinet() {
  const feet: [number, number][] = [
    [PLINTH.CENTER_X - PLINTH.WIDTH / 2 + FOOT.INSET, PLINTH.CENTER_Z - PLINTH.DEPTH / 2 + FOOT.INSET],
    [PLINTH.CENTER_X + PLINTH.WIDTH / 2 - FOOT.INSET, PLINTH.CENTER_Z - PLINTH.DEPTH / 2 + FOOT.INSET],
    [PLINTH.CENTER_X - PLINTH.WIDTH / 2 + FOOT.INSET, PLINTH.CENTER_Z + PLINTH.DEPTH / 2 - FOOT.INSET],
    [PLINTH.CENTER_X + PLINTH.WIDTH / 2 - FOOT.INSET, PLINTH.CENTER_Z + PLINTH.DEPTH / 2 - FOOT.INSET],
  ]

  return (
    <group>
      {/* Wood body. */}
      <mesh
        position={[PLINTH.CENTER_X, -PLINTH.HEIGHT / 2, PLINTH.CENTER_Z]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[PLINTH.WIDTH, PLINTH.HEIGHT, PLINTH.DEPTH]} />
        <primitive object={plinthMaterial()} attach="material" />
      </mesh>

      {/* Satin black top deck, inset far enough that a wood border reads all
          the way around it — that border is most of what identifies the unit
          as a wooden suitcase player rather than a black slab. */}
      <mesh position={[PLINTH.CENTER_X, 0.0005, PLINTH.CENTER_Z]} receiveShadow>
        <boxGeometry args={[PLINTH.WIDTH - 0.042, 0.002, PLINTH.DEPTH - 0.042]} />
        <primitive object={deckMaterial()} attach="material" />
      </mesh>

      {/* Recessed well the platter sits in. */}
      <mesh position={[0, -0.006, 0]} receiveShadow>
        <cylinderGeometry args={[PLATTER.RADIUS + 0.008, PLATTER.RADIUS + 0.008, 0.012, 96]} />
        <primitive object={deckMaterial()} attach="material" />
      </mesh>

      {/* Perforated speaker grille on the front face. */}
      <mesh
        position={[PLINTH.CENTER_X + GRILLE.OFFSET_X, GRILLE.OFFSET_Y, FRONT_Z + 0.0012]}
        receiveShadow
      >
        <planeGeometry args={[GRILLE.WIDTH, GRILLE.HEIGHT]} />
        <primitive object={grilleMaterial()} attach="material" />
      </mesh>

      {feet.map(([x, z], index) => (
        <mesh key={index} position={[x, -PLINTH.HEIGHT - FOOT.HEIGHT / 2, z]} castShadow>
          <cylinderGeometry args={[FOOT.RADIUS, FOOT.RADIUS * 0.88, FOOT.HEIGHT, 24]} />
          <primitive object={plasticMaterial()} attach="material" />
        </mesh>
      ))}
    </group>
  )
}
