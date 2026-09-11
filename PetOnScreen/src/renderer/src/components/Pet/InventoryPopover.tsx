import { useState } from 'react'
import type { PetRuntime } from '@renderer/runtime/PetRuntime'
import { ITEMS } from '@models/Items'
import { Popover } from './Popover'

interface Props {
  x: number
  y: number
  runtime: PetRuntime
  onClose: () => void
}

export function InventoryPopover({ x, y, runtime, onClose }: Props): JSX.Element {
  const [, force] = useState(0)
  const inv = runtime.engine.pet.inventory
  const species = runtime.engine.species
  const entries = Object.values(ITEMS)
    .filter((it) => it.infinite || (inv[it.id] ?? 0) > 0)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))

  const use = (id: string): void => {
    runtime.command({ type: 'useItem', itemId: id })
    force((n) => n + 1)
    if (ITEMS[id].kind !== 'treasure') onClose()
  }

  return (
    <Popover x={x} y={y} width={280} className="inventory">
      <div className="menu-title">
        <span>🎒 Inventory</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="inv-grid">
        {entries.map((it) => {
          const fav = species.favoriteFoods.includes(it.id) || species.favoriteToys.includes(it.id)
          return (
            <button key={it.id} className={`inv-item ${it.kind}`} onClick={() => use(it.id)} title={`${it.description}${fav ? ' Favorite!' : ''}`}>
              <span className="inv-emoji">{it.emoji}</span>
              <span className="inv-name">
                {it.name}
                {fav && <span className="fav">★</span>}
              </span>
              <span className="inv-count muted">{it.infinite ? '∞' : `×${inv[it.id]}`}</span>
            </button>
          )
        })}
      </div>
      <div className="muted small inv-hint">Food feeds, toys play, treasures are keepsakes your pet found. Your pet finds new items on its own over time.</div>
    </Popover>
  )
}
