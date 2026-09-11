import type { VisualState } from '@renderer/runtime/PetRuntime'

interface Props {
  visual: VisualState
  onStop: () => void
}

/** Small pill at the top of the screen while a mini-game is running. Grip meters are filled by the runtime. */
export function PlayHud({ visual, onStop }: Props): JSX.Element | null {
  if (visual.playMode === 'none') return null
  const tug = visual.playMode === 'tug'
  return (
    <div className="play-hud" onPointerDown={(e) => e.stopPropagation()}>
      <div className="play-hud-row">
        <span className="play-title">{tug ? '🪢 Tug of war' : '🎾 Fetch'}</span>
        {tug && visual.tugRounds && (
          <span className="play-score">
            You <b>{visual.tugRounds.user}</b> · <b>{visual.tugRounds.pet}</b> {visual.name}
          </span>
        )}
        <button className="play-done" onClick={onStop} title="Escape also ends the game">
          Done
        </button>
      </div>
      {tug && (
        <div className="grips">
          <div className="grip grip-user">
            <span className="grip-label">your grip</span>
            <div className="grip-track">
              <div className="grip-fill" />
            </div>
          </div>
          <div className="grip grip-pet">
            <span className="grip-label">{visual.name}</span>
            <div className="grip-track">
              <div className="grip-fill" />
            </div>
          </div>
        </div>
      )}
      {visual.playMessage && <div className="play-message">{visual.playMessage}</div>}
    </div>
  )
}
