/**
 * Puts everything inside it on one three.js layer.
 *
 * R3F has no declarative way to say this, and a layer has to be set on every
 * descendant rather than on the group, because `Object3D.layers` is not
 * inherited -- the renderer tests each object on its own.
 *
 * The traverse runs on every commit rather than once. `Record` and
 * `TimeDisplay` both build meshes after their first render, and a child that
 * arrived late would otherwise keep layer 0 and show up in the one view it is
 * meant to be absent from.
 */

import { useLayoutEffect, useRef } from 'react'
import type { Group } from 'three'

export function OnLayer({ value, children }: { value: number; children: React.ReactNode }) {
  const group = useRef<Group>(null)

  useLayoutEffect(() => {
    group.current?.traverse((object) => object.layers.set(value))
  })

  return <group ref={group}>{children}</group>
}
