import { useState } from 'react'
import type { LiveSnapshot } from '@shared/types'
import type { PetSave } from '@models/Pet'
import { SPECIES } from '@models/Species'
import { ANIMATION_FOR_STATE, type BehaviorState } from '@models/Behavior'
import { levelForExperience, moodFor } from '@models/PetStats'
import { describePersonality } from '@models/Personality'
import { relationshipLevel } from '@models/Memory'
import { PetSprite } from '../Pet/PetSprite'
import { StatBar } from '../PetStats/StatBar'

interface Props {
  pet: PetSave
  active: boolean
  live: LiveSnapshot | null
  canRelease: boolean
}

export function PetCard({ pet, active, live, canRelease }: Props): JSX.Element {
  const species = SPECIES[pet.speciesId]
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(pet.name)
  const [confirmRelease, setConfirmRelease] = useState(false)
  const stats = live?.stats ?? { ...pet.stats, level: levelForExperience(pet.stats.experience) }
  const level = live?.stats.level ?? levelForExperience(pet.stats.experience)
  const animation = live ? ANIMATION_FOR_STATE[live.state as BehaviorState] ?? 'idle' : 'idle'
  const cmd = window.petApi.sendCommand

  return (
    <div className={`card pet-card${active ? ' active' : ''}`}>
      <div className="pet-card-head">
        <div className="pet-preview">
          <PetSprite
            look={species.look}
            visual={{ animation, facing: 1, gait: species.movement.gait, faceViewer: false, hidden: false, moving: false, preview: true }}
          />
        </div>
        <div className="pet-card-title">
          {renaming ? (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) cmd({ type: 'rename', name: name.trim() })
                setRenaming(false)
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
              <button className="btn small" type="submit">
                Save
              </button>
            </form>
          ) : (
            <h2>
              {species.emoji} {pet.name}
              {active && <span className="badge">on screen</span>}
            </h2>
          )}
          <div className="muted">
            {species.breed} · Level {level} · {describePersonality(pet.personality)}
          </div>
          <div className="muted small">
            {live ? `${live.state.toLowerCase().replace(/_/g, ' ')} · feeling ${live.mood}` : `feeling ${moodFor(pet.stats)}`} · {relationshipLevel(pet.stats.affection, pet.memory.totalInteractions)}
          </div>
        </div>
      </div>
      <div className="pet-card-stats">
        <StatBar icon="❤️" label="Happiness" value={stats.happiness} color="#ff6b8a" />
        <StatBar icon="⚡" label="Energy" value={stats.energy} color="#ffd43b" />
        <StatBar icon="🍖" label="Hunger" value={stats.hunger} inverted color="#ffa94d" />
        <StatBar icon="💚" label="Health" value={stats.health} color="#69db7c" />
        <StatBar icon="🥰" label="Affection" value={stats.affection} color="#da77f2" />
      </div>
      <div className="pet-card-actions">
        {active ? (
          <>
            <button className="btn" onClick={() => cmd({ type: 'pet' })}>
              🤚 Pet
            </button>
            <button className="btn" onClick={() => cmd({ type: 'feed', foodId: 'kibble' })}>
              🥣 Feed
            </button>
            <button className="btn" onClick={() => cmd({ type: 'play' })}>
              🎾 Play
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => cmd({ type: 'switchPet', petId: pet.id })}>
            Bring to screen
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => setRenaming((r) => !r)}>
          ✏️ Rename
        </button>
        {canRelease &&
          (confirmRelease ? (
            <>
              <button
                className="btn danger small"
                onClick={() => {
                  cmd({ type: 'releasePet', petId: pet.id })
                  setConfirmRelease(false)
                }}
              >
                Yes, release {pet.name}
              </button>
              <button className="btn ghost small" onClick={() => setConfirmRelease(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setConfirmRelease(true)}>
              Release
            </button>
          ))}
      </div>
    </div>
  )
}
