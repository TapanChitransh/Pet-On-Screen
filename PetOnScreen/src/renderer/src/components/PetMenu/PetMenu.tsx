import { Popover } from '../Pet/Popover'

export type MenuAction = 'roam' | 'pet' | 'feed' | 'play' | 'fetch' | 'tug' | 'stopPlay' | 'talk' | 'train' | 'inventory' | 'stats' | 'rename' | 'settings' | 'dashboard' | 'hide' | 'quit'

interface Props {
  x: number
  y: number
  petName: string
  playing?: boolean
  perched?: boolean
  onAction: (action: MenuAction) => void
  onClose: () => void
}

const ITEMS: { action: MenuAction; icon: string; label: string; hint?: string }[] = [
  { action: 'pet', icon: '🤚', label: 'Pet' },
  { action: 'feed', icon: '🥣', label: 'Feed', hint: 'kibble' },
  { action: 'play', icon: '🎉', label: 'Play', hint: 'quick' },
  { action: 'fetch', icon: '🎾', label: 'Play fetch', hint: 'throw the ball' },
  { action: 'tug', icon: '🪢', label: 'Tug of war', hint: 'hold & pull' },
  { action: 'talk', icon: '💬', label: 'Talk' },
  { action: 'train', icon: '🎓', label: 'Train', hint: 'voice commands' },
  { action: 'inventory', icon: '🎒', label: 'Inventory' },
  { action: 'stats', icon: '📊', label: 'Stats' },
  { action: 'rename', icon: '✏️', label: 'Rename' },
  { action: 'dashboard', icon: '🏠', label: 'Dashboard' },
  { action: 'settings', icon: '⚙️', label: 'Settings' },
  { action: 'hide', icon: '🙈', label: 'Hide pet', hint: 'tray to show' }
]

export function PetMenu({ x, y, petName, playing = false, perched = false, onAction, onClose }: Props): JSX.Element {
  return (
    <Popover x={x} y={y} width={228} className="menu">
      <div className="menu-title">
        <span>{petName}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {playing && (
        <>
          <button className="menu-item" onClick={() => onAction('stopPlay')}>
            <span className="menu-icon">⏹</span>
            <span className="menu-label">Stop playing</span>
            <span className="menu-hint">Esc</span>
          </button>
          <div className="menu-sep" />
        </>
      )}
      {perched && !playing && (
        <>
          <button className="menu-item" onClick={() => onAction('roam')}>
            <span className="menu-icon">🐾</span>
            <span className="menu-label">Let it roam</span>
            <span className="menu-hint">stays put now</span>
          </button>
          <div className="menu-sep" />
        </>
      )}
      {ITEMS.filter((item) => !(playing && (item.action === 'fetch' || item.action === 'tug'))).map((item) => (
        <button key={item.action} className="menu-item" onClick={() => onAction(item.action)}>
          <span className="menu-icon">{item.icon}</span>
          <span className="menu-label">{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
      <div className="menu-sep" />
      <button className="menu-item danger" onClick={() => onAction('quit')}>
        <span className="menu-icon">⏻</span>
        <span className="menu-label">Quit PetOnScreen</span>
      </button>
    </Popover>
  )
}
