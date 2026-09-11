import { jitterPersonality, type Personality } from './Personality'
import { DEFAULT_STATS, type PetStats } from './PetStats'
import { createMemory, type PetMemory } from './Memory'
import { STARTER_INVENTORY, type Inventory } from './Items'
import { SPECIES } from './Species'

/** Serializable pet record. This is what gets persisted. */
export interface PetSave {
  id: string
  name: string
  speciesId: string
  personality: Personality
  stats: PetStats
  memory: PetMemory
  inventory: Inventory
  createdAt: number
  lastSeenAt: number
}

export function createPet(speciesId: string, name: string, rand: () => number, now = Date.now()): PetSave {
  const species = SPECIES[speciesId]
  if (!species) throw new Error(`Unknown species: ${speciesId}`)
  return {
    id: `${speciesId}-${now.toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`,
    name,
    speciesId,
    personality: jitterPersonality(species.personality, rand),
    stats: { ...DEFAULT_STATS },
    memory: createMemory(),
    inventory: { ...STARTER_INVENTORY },
    createdAt: now,
    lastSeenAt: now
  }
}

export function ageInDays(pet: PetSave, now = Date.now()): number {
  return Math.max(0, (now - pet.createdAt) / 86_400_000)
}

/** Basic validation for data loaded from disk. Fills in missing fields from older saves. */
export function normalizePet(raw: Partial<PetSave>): PetSave | null {
  if (!raw || typeof raw !== 'object' || !raw.id || !raw.speciesId || !SPECIES[raw.speciesId]) return null
  const base = createPet(raw.speciesId, raw.name || SPECIES[raw.speciesId].name, Math.random, raw.createdAt ?? Date.now())
  const memory = { ...base.memory, ...(raw.memory ?? {}) }
  memory.interactionCounts = { ...base.memory.interactionCounts, ...(raw.memory?.interactionCounts ?? {}) }
  return {
    ...base,
    ...raw,
    id: raw.id,
    personality: { ...base.personality, ...(raw.personality ?? {}) },
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    memory,
    inventory: { ...(raw.inventory ?? base.inventory) }
  }
}
