/**
 * A bookshelf speaker either side of the deck.
 *
 * Main only. They are drawn as part of the same unit rather than as separates
 * standing nearby: the plinth's wood, a grille cloth on the front, and feet of
 * the same plastic, standing on the surface the deck's feet stand on.
 *
 * Inert. Nothing here takes a click, and nothing moves -- they do not pulse
 * with the music, because Vuelta has no idea what the music is doing. The Web
 * API gives no audio data at all: `audio-features` and `audio-analysis` both
 * return 403, which is why nothing in this app is beat-driven. A speaker that
 * bounced would be inventing it.
 *
 * They widen the machine by about half, and the camera gives that up out of
 * the deck's size -- see `FIT_BOX_WITH_SPEAKERS`.
 */

import { FOOT, PLINTH, SPEAKER, SPEAKER_CENTER_X } from '../geometry/dimensions.js'
import { grilleMaterial, plasticMaterial, plinthMaterial } from '../materials/surfaces.js'

/** Underside of the feet: what the whole machine stands on. */
const BOTTOM_Y = -(PLINTH.HEIGHT + FOOT.HEIGHT)
/** Centre height of a cabinet standing on that. */
const CENTER_Y = BOTTOM_Y + FOOT.HEIGHT + SPEAKER.HEIGHT / 2
const FRONT_Z = PLINTH.CENTER_Z + SPEAKER.DEPTH / 2

function Speaker({ x }: { x: number }) {
  return (
    <group position={[x, 0, PLINTH.CENTER_Z]}>
      {/* The box. */}
      <mesh position={[0, CENTER_Y, 0]} castShadow receiveShadow>
        <boxGeometry args={[SPEAKER.WIDTH, SPEAKER.HEIGHT, SPEAKER.DEPTH]} />
        <primitive object={plinthMaterial()} attach="material" />
      </mesh>

      {/* The grille cloth, a hair proud of the front face so it is never
          z-fighting with it. Inset on all four sides, which is what makes it
          read as cloth stretched on a frame rather than as a painted panel. */}
      <mesh position={[0, CENTER_Y, FRONT_Z - PLINTH.CENTER_Z + 0.0012]} receiveShadow>
        <planeGeometry
          args={[
            SPEAKER.WIDTH - SPEAKER.GRILLE_INSET * 2,
            SPEAKER.HEIGHT - SPEAKER.GRILLE_INSET * 2,
          ]}
        />
        <primitive object={grilleMaterial()} attach="material" />
      </mesh>

      {/* Two feet, front and back, matching the deck's. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[0, BOTTOM_Y + FOOT.HEIGHT / 2, side * (SPEAKER.DEPTH / 2 - FOOT.INSET)]}
          castShadow
        >
          <cylinderGeometry args={[FOOT.RADIUS, FOOT.RADIUS, FOOT.HEIGHT, 16]} />
          <primitive object={plasticMaterial()} attach="material" />
        </mesh>
      ))}
    </group>
  )
}

export function Speakers() {
  return (
    <>
      <Speaker x={SPEAKER_CENTER_X.LEFT} />
      <Speaker x={SPEAKER_CENTER_X.RIGHT} />
    </>
  )
}
