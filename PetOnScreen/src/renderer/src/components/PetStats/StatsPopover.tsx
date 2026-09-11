import { useEffect, useState } from 'react'
import type { PetRuntime } from '@renderer/runtime/PetRuntime'
import { experienceForLevel, levelForExperience, moodFor } from '@models/PetStats'
import { memoryNotes, relationshipLevel } from '@models/Memory'
import { describePersonality } from '@models/Personality'
import { Popover } from '../Pet/Popover'
import { StatBar } from './StatBar'

interface Props {
  x: number
  y: number
  runtime: PetRuntime
  onClose: () => void
}

export function StatsPopover({ x, y, runtime, onClose }: Props): JSX.Element {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const pet = runtime.engine.pet
  const species = runtime.engine.species
  const s = pet.stats
  const level = levelForExperience(s.experience)
  const cur = experienceForLevel(level)
  const next = experienceForLevel(level + 1)
  const xpPct = Math.round(((s.experience - cur) / (next - cur)) * 100)
  const ageDays = (Date.now() - pet.createdAt) / 86_400_000
  const age = ageDays < 1 ? `${Math.max(1, Math.floor(ageDays * 24))}h` : `${Math.floor(ageDays)}d`
  const notes = memoryNotes(pet.memory, pet.name)

  return (
    <Popover x={x} y={y} width={270} className="stats">
      <div className="menu-title">
        <span>
          {species.emoji} {pet.name} <span className="muted">· {species.breed}</span>
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="stats-row">
        <span className="chip">Level {level}</span>
        <span className="chip">{moodFor(s)}</span>
        <span className="chip">🎂 {age}</span>
      </div>
      <div className="xp">
        <div className="xp-track">
          <div className="xp-fill" style={{ width: `${xpPct}%` }} />
        </div>
        <span className="muted small">
          ⭐ {Math.floor(s.experience)} / {next} XP
        </span>
      </div>
      <StatBar icon="❤️" label="Happiness" value={s.happiness} color="#ff6b8a" />
      <StatBar icon="🍖" label="Hunger" value={s.hunger} inverted color="#ffa94d" />
      <StatBar icon="⚡" label="Energy" value={s.energy} color="#ffd43b" />
      <StatBar icon="💚" label="Health" value={s.health} color="#69db7c" />
      <StatBar icon="🥰" label="Affection" value={s.affection} color="#da77f2" />
      <div className="muted small stats-meta">
        {describePersonality(pet.personality)} · {relationshipLevel(s.affection, pet.memory.totalInteractions)} · {pet.memory.totalInteractions} interactions
      </div>
      {notes.length > 0 && (
        <ul className="notes">
          {notes.slice(0, 3).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <button className="link-btn" onClick={() => window.petApi.openDashboard('pets')}>
        Open dashboard →
      </button>
    </Popover>
  )
}
