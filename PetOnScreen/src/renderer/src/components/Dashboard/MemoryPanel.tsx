import type { PetSave } from '@models/Pet'
import { favoriteActivity, favoriteFood, memoryNotes, relationshipLevel } from '@models/Memory'
import { ITEMS } from '@models/Items'
import { PERSONALITY_KEYS } from '@models/Personality'

export function MemoryPanel({ pet, ownerName }: { pet: PetSave | null; ownerName: string }): JSX.Element {
  if (!pet) return <section><h1>Memory</h1><p className="muted">No active pet.</p></section>
  const m = pet.memory
  const notes = memoryNotes(m, pet.name)
  const fav = favoriteActivity(m)
  const food = favoriteFood(m)
  const events = [...m.events].reverse()
  return (
    <section>
      <h1>What {pet.name} remembers</h1>
      <div className="two-col">
        <div className="card">
          <h3>Relationship</h3>
          <dl className="kv">
            <dt>Owner</dt>
            <dd>{ownerName ? ownerName : <span className="muted">unknown, introduce yourself in chat or Settings</span>}</dd>
            <dt>Level</dt>
            <dd>{relationshipLevel(pet.stats.affection, m.totalInteractions)}</dd>
            <dt>Total interactions</dt>
            <dd>{m.totalInteractions}</dd>
            <dt>Favorite activity</dt>
            <dd>{fav ?? <span className="muted">still finding out</span>}</dd>
            <dt>Favorite food</dt>
            <dd>{food ? `${ITEMS[food]?.emoji ?? ''} ${ITEMS[food]?.name ?? food}` : <span className="muted">not yet</span>}</dd>
            <dt>Last interaction</dt>
            <dd>{m.lastInteractionAt ? `${m.lastInteractionType} · ${new Date(m.lastInteractionAt).toLocaleString()}` : <span className="muted">never</span>}</dd>
            <dt>Adopted</dt>
            <dd>{new Date(pet.createdAt).toLocaleDateString()}</dd>
          </dl>
          <h3>Interaction counts</h3>
          <div className="tags">
            {Object.entries(m.interactionCounts).map(([k, v]) => (
              <span key={k} className="chip">
                {k}: {v}
              </span>
            ))}
          </div>
          <h3>Personality</h3>
          <p className="muted small">Personality drifts slowly with how you treat your pet.</p>
          {PERSONALITY_KEYS.map((k) => (
            <div key={k} className="trait">
              <span className="trait-label">{k}</span>
              <div className="trait-track">
                <div className="trait-fill" style={{ width: `${Math.round(pet.personality[k] * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Notes</h3>
          {notes.length === 0 && <p className="muted small">Spend some time together and {pet.name} will start remembering things.</p>}
          <ul className="notes-list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <h3>Event log</h3>
          {events.length === 0 && <p className="muted small">Nothing yet.</p>}
          <ul className="event-log">
            {events.map((e, i) => (
              <li key={i}>
                <span className="muted small">{new Date(e.at).toLocaleString()}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
