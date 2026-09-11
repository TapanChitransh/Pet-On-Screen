export type InteractionType = 'pet' | 'feed' | 'play' | 'toy' | 'talk' | 'click' | 'drag'

export interface MemoryEvent {
  at: number
  type: string
  text: string
}

/** What the pet remembers about its life with the user. */
export interface PetMemory {
  interactionCounts: Record<InteractionType, number>
  foodCounts: Record<string, number>
  totalInteractions: number
  lastInteractionAt: number | null
  lastInteractionType: InteractionType | null
  events: MemoryEvent[]
  /** highest number of clicks in a 10s window - the pet remembers being poked */
  clickStreakRecord: number
  timesDropped: number
  gamesPlayed: number
  giftsGiven: number
  /** true once the pet has been told the owner's name */
  knowsOwner: boolean
}

export const MAX_EVENTS = 60

export function createMemory(): PetMemory {
  return {
    interactionCounts: { pet: 0, feed: 0, play: 0, toy: 0, talk: 0, click: 0, drag: 0 },
    foodCounts: {},
    totalInteractions: 0,
    lastInteractionAt: null,
    lastInteractionType: null,
    events: [],
    clickStreakRecord: 0,
    timesDropped: 0,
    gamesPlayed: 0,
    giftsGiven: 0,
    knowsOwner: false
  }
}

export function recordInteraction(memory: PetMemory, type: InteractionType, at: number): PetMemory {
  const counts = { ...memory.interactionCounts, [type]: (memory.interactionCounts[type] ?? 0) + 1 }
  return {
    ...memory,
    interactionCounts: counts,
    totalInteractions: memory.totalInteractions + 1,
    lastInteractionAt: at,
    lastInteractionType: type
  }
}

export function rememberEvent(memory: PetMemory, type: string, text: string, at: number): PetMemory {
  const events = [...memory.events, { at, type, text }]
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  return { ...memory, events }
}

export function favoriteActivity(memory: PetMemory): InteractionType | null {
  const candidates: InteractionType[] = ['pet', 'play', 'toy', 'talk', 'feed']
  let best: InteractionType | null = null
  let bestCount = 2 // needs at least a few repetitions to count as a favorite
  for (const c of candidates) {
    const n = memory.interactionCounts[c] ?? 0
    if (n > bestCount) {
      best = c
      bestCount = n
    }
  }
  return best
}

export function favoriteFood(memory: PetMemory): string | null {
  let best: string | null = null
  let bestCount = 1
  for (const [food, n] of Object.entries(memory.foodCounts)) {
    if (n > bestCount) {
      best = food
      bestCount = n
    }
  }
  return best
}

export type RelationshipLevel = 'stranger' | 'acquaintance' | 'friend' | 'close friend' | 'best friend' | 'soulmate'

export function relationshipLevel(affection: number, totalInteractions: number): RelationshipLevel {
  const score = affection * 0.7 + Math.min(100, totalInteractions / 3) * 0.3
  if (score < 15) return 'stranger'
  if (score < 30) return 'acquaintance'
  if (score < 50) return 'friend'
  if (score < 70) return 'close friend'
  if (score < 88) return 'best friend'
  return 'soulmate'
}

/** Human readable memory notes shown in the dashboard and used by the conversation system. */
export function memoryNotes(memory: PetMemory, petName: string): string[] {
  const notes: string[] = []
  const fav = favoriteActivity(memory)
  if (fav === 'pet') notes.push(`${petName} remembers that you like petting it.`)
  if (fav === 'play') notes.push(`${petName} knows you love to play together.`)
  if (fav === 'toy') notes.push(`${petName} remembers all the toys you gave it.`)
  if (fav === 'talk') notes.push(`${petName} loves your little chats.`)
  if (fav === 'feed') notes.push(`${petName} thinks of you as the snack provider.`)
  const food = favoriteFood(memory)
  if (food) notes.push(`Favorite food so far: ${food}.`)
  if (memory.clickStreakRecord >= 8) notes.push(`${petName} remembers being poked ${memory.clickStreakRecord} times in a row.`)
  if (memory.timesDropped >= 3) notes.push(`${petName} has been dropped ${memory.timesDropped} times and is a little wary of being picked up.`)
  if (memory.giftsGiven > 0) notes.push(`${petName} has brought you ${memory.giftsGiven} gift${memory.giftsGiven === 1 ? '' : 's'}.`)
  return notes
}
