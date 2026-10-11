/**
 * View A — spec §12. "Camera overhead. Disc and tonearm fill the window."
 *
 * Composes the 3D skin with the now-playing overlay. `views/` exists for
 * exactly this (spec §15): the skin draws, the view decides what is on screen
 * alongside it. M5's console view becomes a sibling of this file rather than
 * a rewrite of it.
 */

import { NowPlayingPanel, usePointerActivity } from '../app/panel/NowPlayingPanel.js'
import type { Sync } from '../app/useSync.js'
import { Turntable } from '../skins/3d/Turntable.js'

export function TopView({ sync }: { sync: Sync }) {
  const awake = usePointerActivity()

  return (
    <div className="stage">
      <Turntable
        state={sync.stateRef}
        actions={sync.actions}
        albumArtUrl={sync.track?.albumArtUrl ?? null}
        volumePercent={sync.readout.volumePercent}
        active={sync.active}
        onToggleLid={sync.toggleLid}
        onArmDragStart={sync.beginArmDrag}
        onArmDragTo={sync.dragToProgress}
        onArmDragEnd={sync.endArmDrag}
      />

      <NowPlayingPanel
        track={sync.track}
        progressMs={sync.readout.progressMs}
        durationMs={sync.readout.durationMs}
        isPlaying={sync.readout.isPlaying}
        volumePercent={sync.readout.volumePercent}
        deviceName={sync.readout.deviceName}
        actions={sync.actions}
        visible={awake}
      />
    </div>
  )
}
