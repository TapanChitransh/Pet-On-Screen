/**
 * Persistent pet statistics. All values except experience are 0..100.
 * Hunger: 0 = full, 100 = starving.
 */
export interface PetStats {
  happiness: number
  hunger: number
  energy: number
  health: number
  affection: number
  experience: number
}

export const DEFAULT_STATS: PetStats = {
  happiness: 75,
  hunger: 25,
  energy: 85,
  health: 100,
  affection: 20,
  experience: 0
}

export function clampStat(v: number): number {
  return Math.max(0, Math.min(100, v))
}

export function levelForExperience(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1
}

export function experienceForLevel(level: number): number {
  return Math.pow(level - 1, 2) * 40
}

/**
 * Passive drift applied every tick. Tuned so the pet is relaxing to keep:
 * hunger takes ~6h of runtime to reach "hungry" and the pet will feed itself
 * when nobody is around (see BehaviorEngine), health never collapses.
 */
export const DRIFT_PER_SECOND = {
  hunger: 100 / (6 * 3600),
  energyAwake: -100 / (5 * 3600),
  energySleeping: 100 / (40 * 60),
  /** happiness drifts toward a comfortable baseline instead of zero */
  happinessBaseline: 60,
  happinessRate: 1 / 600,
  affection: -100 / (72 * 3600)
}

export function applyDrift(stats: PetStats, dt: number, sleeping: boolean): PetStats {
  const s = { ...stats }
  s.hunger = clampStat(s.hunger + DRIFT_PER_SECOND.hunger * dt)
  s.energy = clampStat(
    s.energy + (sleeping ? DRIFT_PER_SECOND.energySleeping : DRIFT_PER_SECOND.energyAwake) * dt
  )
  const target = DRIFT_PER_SECOND.happinessBaseline
  s.happiness = clampStat(s.happiness + (target - s.happiness) * DRIFT_PER_SECOND.happinessRate * dt)
  s.affection = clampStat(s.affection + DRIFT_PER_SECOND.affection * dt)
  // Health only suffers when the pet is left starving or exhausted, and never below 40.
  if (s.hunger > 90 || s.energy < 5) s.health = Math.max(40, s.health - dt / 120)
  else if (s.health < 100) s.health = clampStat(s.health + dt / 60)
  return s
}

/** Simulate time the app was closed. Capped so a long absence never feels punishing. */
export function applyOfflineTime(stats: PetStats, elapsedSeconds: number): PetStats {
  const capped = Math.min(Math.max(0, elapsedSeconds), 8 * 3600)
  let s = { ...stats }
  // While we are away the pet mostly sleeps, so it wakes rested but a bit hungry.
  s = applyDrift(s, capped, true)
  s.hunger = Math.min(s.hunger, 70)
  return s
}

export type Mood = 'ecstatic' | 'happy' | 'content' | 'bored' | 'hungry' | 'tired' | 'sad' | 'sick'

export function moodFor(stats: PetStats): Mood {
  if (stats.health < 60) return 'sick'
  if (stats.energy < 20) return 'tired'
  if (stats.hunger > 75) return 'hungry'
  if (stats.happiness < 30) return 'sad'
  if (stats.happiness < 50) return 'bored'
  if (stats.happiness > 90 && stats.affection > 60) return 'ecstatic'
  if (stats.happiness > 75) return 'happy'
  return 'content'
}
