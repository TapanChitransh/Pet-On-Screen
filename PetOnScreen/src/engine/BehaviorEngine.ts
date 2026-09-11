import { BEHAVIORS, type BehaviorDefinition, type BehaviorState, type DecisionContext } from '@models/Behavior'
import type { Rng } from './rng'
import { PersonalityEngine } from './PersonalityEngine'

/**
 * Weighted, cooldown-aware behavior selection. The engine never picks uniformly:
 * base weights come from the behavior catalogue and are multiplied by personality,
 * stats, mood and environment. Recently finished behaviors are on cooldown.
 */
export class BehaviorEngine {
  private lastEnded: Partial<Record<BehaviorState, number>> = {}

  constructor(private personality: PersonalityEngine) {}

  /** Register that a behavior finished so its cooldown starts. `now` in seconds. */
  markEnded(state: BehaviorState, now: number): void {
    this.lastEnded[state] = now
  }

  isOnCooldown(def: BehaviorDefinition, ctx: DecisionContext, now: number): boolean {
    const ended = this.lastEnded[def.state]
    if (ended === undefined || def.cooldown <= 0) return false
    // Urgent needs override cooldowns.
    if (def.state === 'SLEEPING' && ctx.stats.energy < 15) return false
    if (def.state === 'EATING' && ctx.stats.hunger > 85) return false
    return now - ended < def.cooldown
  }

  /** Returns every candidate and its effective weight - useful for debugging and tests. */
  weigh(ctx: DecisionContext, now: number): { def: BehaviorDefinition; weight: number }[] {
    return BEHAVIORS.map((def) => ({
      def,
      weight: this.isOnCooldown(def, ctx, now) ? 0 : this.personality.weightFor(def, ctx)
    }))
  }

  decide(ctx: DecisionContext, now: number, rng: Rng): BehaviorDefinition {
    const weighed = this.weigh(ctx, now)
    const picked = rng.pickWeighted(weighed, (w) => w.weight)
    return picked?.def ?? BEHAVIORS[0]
  }

  /** Duration in seconds for a fresh instance of a behavior, scaled a bit by personality. */
  durationFor(def: BehaviorDefinition, ctx: DecisionContext, rng: Rng): number {
    let d = rng.range(def.duration[0], def.duration[1])
    if (def.state === 'SLEEPING' || def.state === 'SITTING') d *= 0.7 + ctx.personality.laziness * 0.6
    if (def.state === 'PLAYING' || def.state === 'RUNNING') d *= 0.7 + ctx.personality.energy * 0.6
    return d
  }
}
