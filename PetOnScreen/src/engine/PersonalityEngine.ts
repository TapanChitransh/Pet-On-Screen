import { clamp01, type Personality } from '@models/Personality'
import type { PetMemory, InteractionType } from '@models/Memory'
import type { BehaviorDefinition, DecisionContext } from '@models/Behavior'

/**
 * PersonalityEngine has two jobs:
 *  1. turn personality + species into a multiplier for each candidate behavior
 *  2. let personality slowly evolve with how the pet is treated, so it behaves differently over time
 */
export class PersonalityEngine {
  private lastCounts: Record<InteractionType, number> | null = null

  /** Final weight multiplier for a behavior. Combines behavior-specific modifier and species bias. */
  weightFor(def: BehaviorDefinition, ctx: DecisionContext): number {
    const modifier = def.modifier(ctx)
    if (modifier <= 0) return 0
    const bias = ctx.speciesBias[def.state] ?? 1
    let w = def.baseWeight * modifier * bias
    // Avoid doing the exact same thing twice in a row.
    if (ctx.previousState === def.state) w *= 0.3
    return w
  }

  /**
   * Nudge traits based on interactions since the last call. Changes are tiny (<= 0.01 per call)
   * and this is only invoked every few minutes, so a personality takes days to visibly shift.
   */
  evolve(personality: Personality, memory: PetMemory): Personality {
    const counts = memory.interactionCounts
    if (!this.lastCounts) {
      this.lastCounts = { ...counts }
      return personality
    }
    const delta = (k: InteractionType): number => Math.max(0, (counts[k] ?? 0) - (this.lastCounts![k] ?? 0))
    const p = { ...personality }
    const step = 0.002
    p.affection = clamp01(p.affection + Math.min(5, delta('pet')) * step)
    p.playfulness = clamp01(p.playfulness + Math.min(5, delta('play') + delta('toy')) * step)
    p.friendliness = clamp01(p.friendliness + Math.min(5, delta('talk')) * step)
    // Being poked relentlessly makes a pet a little less friendly and a little more mischievous.
    if (delta('click') > 15) {
      p.friendliness = clamp01(p.friendliness - step * 2)
      p.mischief = clamp01(p.mischief + step)
    }
    // A pet that is never played with drifts toward laziness.
    if (delta('play') + delta('toy') === 0) p.laziness = clamp01(p.laziness + step * 0.5)
    else p.laziness = clamp01(p.laziness - step * 0.5)
    this.lastCounts = { ...counts }
    return p
  }
}
