import type { VisualState } from '@renderer/runtime/PetRuntime'

/**
 * Visuals for the mini-games. Positions are written every frame by PetRuntime.applyPlayFrame
 * (class names .play-ball, .play-rope, .play-handle) so React only mounts/unmounts them.
 */
export function PlayLayer({ visual }: { visual: VisualState }): JSX.Element | null {
  if (visual.playMode === 'none') return null
  return (
    <div className={`play-layer mode-${visual.playMode}${visual.tugHolding ? ' holding' : ''}`}>
      {visual.playMode === 'tug' && (
        <svg className="play-rope-svg" aria-hidden>
          <path className="play-rope-shadow" d="" />
          <path className="play-rope" d="" />
          <circle className="play-handle" r="11" />
        </svg>
      )}
      {visual.playMode === 'fetch' && (
        <div className={`play-ball held-${visual.ballHeld ?? 'free'}`} aria-hidden>
          <span className="play-ball-seam" />
        </div>
      )}
    </div>
  )
}
