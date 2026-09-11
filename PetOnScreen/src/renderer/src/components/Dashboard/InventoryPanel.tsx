import type { PetSave } from '@models/Pet'
import { ITEMS } from '@models/Items'
import { SPECIES } from '@models/Species'

export function InventoryPanel({ pet }: { pet: PetSave | null }): JSX.Element {
  if (!pet) return <section><h1>Inventory</h1><p className="muted">No active pet.</p></section>
  const species = SPECIES[pet.speciesId]
  const entries = Object.values(ITEMS).filter((it) => it.infinite || (pet.inventory[it.id] ?? 0) > 0)
  const groups: Record<string, typeof entries> = { food: [], toy: [], treasure: [] }
  for (const e of entries) groups[e.kind].push(e)
  return (
    <section>
      <h1>{pet.name}'s inventory</h1>
      <p className="muted">Use items straight from here. Your pet also finds objects and brings you gifts on its own, keep an eye on the speech bubbles.</p>
      {(['food', 'toy', 'treasure'] as const).map((kind) => (
        <div key={kind} className="inv-section">
          <h3>{{ food: '🍽️ Food', toy: '🎾 Toys', treasure: '💎 Treasures' }[kind]}</h3>
          {groups[kind].length === 0 && <p className="muted small">Nothing here yet.</p>}
          <div className="inv-cards">
            {groups[kind].map((it) => {
              const fav = species.favoriteFoods.includes(it.id) || species.favoriteToys.includes(it.id)
              return (
                <div key={it.id} className="card inv-card">
                  <div className="inv-card-emoji">{it.emoji}</div>
                  <div className="inv-card-body">
                    <div>
                      <strong>{it.name}</strong> {fav && <span className="fav">★ favorite</span>}
                      <span className="muted"> · {it.infinite ? 'unlimited' : `×${pet.inventory[it.id]}`}</span>
                    </div>
                    <div className="muted small">{it.description}</div>
                  </div>
                  {kind !== 'treasure' && (
                    <button className="btn small" onClick={() => window.petApi.sendCommand({ type: 'useItem', itemId: it.id })}>
                      {kind === 'food' ? 'Feed' : 'Give'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
