/** Personality attributes, each in 0..1. They bias behavior probabilities. */
export interface Personality {
  playfulness: number
  laziness: number
  curiosity: number
  friendliness: number
  energy: number
  intelligence: number
  affection: number
  mischief: number
}

export const PERSONALITY_KEYS: (keyof Personality)[] = [
  'playfulness',
  'laziness',
  'curiosity',
  'friendliness',
  'energy',
  'intelligence',
  'affection',
  'mischief'
]

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Adds a little randomness so two pets of the same species are never identical. */
export function jitterPersonality(base: Personality, rand: () => number, spread = 0.15): Personality {
  const out = { ...base }
  for (const k of PERSONALITY_KEYS) {
    out[k] = clamp01(base[k] + (rand() * 2 - 1) * spread)
  }
  return out
}

/** Human readable label for the dominant traits, used in the dashboard. */
export function describePersonality(p: Personality): string {
  const labels: string[] = []
  if (p.playfulness > 0.65) labels.push('playful')
  if (p.laziness > 0.65) labels.push('lazy')
  if (p.curiosity > 0.65) labels.push('curious')
  if (p.friendliness > 0.65) labels.push('friendly')
  if (p.energy > 0.65) labels.push('energetic')
  if (p.intelligence > 0.65) labels.push('clever')
  if (p.affection > 0.65) labels.push('affectionate')
  if (p.mischief > 0.65) labels.push('mischievous')
  if (labels.length === 0) {
    if (p.laziness < 0.35 && p.energy < 0.35) labels.push('calm')
    else labels.push('easygoing')
  }
  return labels.slice(0, 3).join(', ')
}
