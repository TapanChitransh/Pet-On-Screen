import { useState } from 'react'
import type { PetSave } from '@models/Pet'
import { DEFAULT_NAMES, SPECIES_LIST, type SpeciesDefinition } from '@models/Species'
import { describePersonality } from '@models/Personality'
import { ITEMS } from '@models/Items'
import { PetSprite } from '../Pet/PetSprite'

interface Props {
  owned: PetSave[]
  onAdopted: () => void
}

/**
 * Phase 3/5 "marketplace": all six starter animals can be adopted for free right now.
 * Paid pets, accessories, skins and environments are listed on the Roadmap tab as planned work.
 */
export function AdoptPanel({ owned, onAdopted }: Props): JSX.Element {
  const [chosen, setChosen] = useState<SpeciesDefinition | null>(null)
  const [name, setName] = useState('')

  const start = (s: SpeciesDefinition): void => {
    setChosen(s)
    const names = DEFAULT_NAMES[s.id]
    setName(names[Math.floor(Math.random() * names.length)])
  }

  const adopt = (): void => {
    if (!chosen) return
    window.petApi.sendCommand({ type: 'adopt', speciesId: chosen.id, name: name.trim() || chosen.name })
    setChosen(null)
    onAdopted()
  }

  return (
    <section>
      <h1>Adopt a pet</h1>
      <p className="muted">
        {SPECIES_LIST.filter((s) => s.kind === 'animal').length} animals (including {SPECIES_LIST.filter((s) => s.emoji === '🐶').length + 1} dog breeds) and one tiny person, each with its own look, personality defaults, movement style, favorite foods and voice.
        Personalities are randomized a little, so no two are the same.
      </p>
      <div className="species-grid">
        {SPECIES_LIST.map((s) => {
          const count = owned.filter((p) => p.speciesId === s.id).length
          return (
            <div key={s.id} className={`card species-card${chosen?.id === s.id ? ' selected' : ''}`}>
              <div className="species-preview">
                <PetSprite look={s.look} visual={{ animation: 'idle', facing: 1, gait: s.movement.gait, faceViewer: false, hidden: false, moving: false, preview: true }} />
              </div>
              <h3>
                {s.emoji} {s.name} <span className="muted small">{s.breed}</span>
              </h3>
              <p className="muted small">{s.description}</p>
              <div className="tags">
                <span className="chip">{describePersonality(s.personality)}</span>
                <span className="chip">gait: {s.movement.gait}</span>
                <span className="chip">loves {s.favoriteFoods.map((f) => ITEMS[f]?.emoji).join(' ')}</span>
              </div>
              <div className="pet-card-actions">
                <button className="btn primary" onClick={() => start(s)}>
                  {s.kind === 'person' ? 'Invite · free' : 'Adopt · free'}
                </button>
                {count > 0 && <span className="muted small">you have {count}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {chosen && (
        <div className="modal-backdrop" onClick={() => setChosen(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {chosen.kind === 'person' ? 'Name your companion' : `Name your ${chosen.name.toLowerCase()}`} {chosen.emoji}
            </h2>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                adopt()
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder={chosen.name} />
              <button className="btn primary" type="submit">
                Adopt
              </button>
              <button className="btn ghost" type="button" onClick={() => setChosen(null)}>
                Cancel
              </button>
            </form>
            <p className="muted small">Your new pet replaces the current one on screen. The current pet keeps living in My Pets.</p>
          </div>
        </div>
      )}
    </section>
  )
}
