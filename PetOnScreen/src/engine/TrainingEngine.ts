import type { Personality } from '@models/Personality'
import type { PetStats } from '@models/PetStats'
import type { BehaviorState } from '@models/Behavior'
import type { SpeciesDefinition } from '@models/Species'
import { COMMANDS, LEARNING_LEVEL, MASTERED_LEVEL, skillOf, type CommandId, type CommandSkill, type Speaker, type TrainingState } from '@models/Commands'
import { ownerConfidence } from './Voiceprint'
import type { Rng } from './rng'
import type { Reaction } from './InteractionEngine'

export interface TrainingContext {
  personality: Personality
  stats: PetStats
  species: SpeciesDefinition
  currentState: BehaviorState
  training: TrainingState
  nowMs: number
  /** the owner's name, if the pet knows it; used when it refuses a stranger */
  ownerName?: string
}

export type Milestone = 'learning' | 'learned' | null

export interface CommandResult {
  id: CommandId
  obeyed: boolean
  before: number
  after: number
  milestone: Milestone
  reaction: Reaction
  training: TrainingState
  /** true when a trained pet turned the command down because the voice was not its owner's */
  refusedStranger: boolean
}

export interface ReinforceResult {
  /** the command that was reinforced, or null when there was nothing recent to reinforce */
  id: CommandId | null
  before: number
  after: number
  milestone: Milestone
  reaction: Reaction | null
  training: TrainingState
}

/** Praise, a treat or a scold counts only this soon after the command. */
export const REINFORCE_WINDOW_S = 20

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function milestoneFor(before: number, after: number): Milestone {
  if (before < MASTERED_LEVEL && after >= MASTERED_LEVEL) return 'learned'
  if (before < LEARNING_LEVEL && after >= LEARNING_LEVEL) return 'learning'
  return null
}

function withSkill(training: TrainingState, id: CommandId, skill: CommandSkill): TrainingState {
  return { ...training, commands: { ...training.commands, [id]: skill } }
}

/**
 * How pets learn commands. Pure and deterministic given the rng.
 *
 * - Every command has a skill level 0..100. The chance to obey grows with it, shaped by personality
 *   (intelligence helps, mischief and laziness hurt), energy, and whether the species likes the
 *   behavior at all.
 * - Saying a command over and over teaches only a little. Treats are what really teach: a treat
 *   within 20 seconds of obeying is worth several repetitions, and praise ("good boy") sits in
 *   between. A scold shortly after ignoring a command teaches the boundary, at a small cost in
 *   happiness.
 * - Loyalty: as a command is mastered and the pet learns its owner's voice (from the utterances
 *   the owner rewarded with treats), it stops obeying that command from anyone else. Until then
 *   it listens to everybody, like any untrained puppy.
 */
export class TrainingEngine {
  /** 0..1: how strongly the pet insists on its owner for this command. */
  loyalty(ctx: TrainingContext, id: CommandId): number {
    const level = skillOf(ctx.training, id).level
    const trained = clamp((level - LEARNING_LEVEL) / (MASTERED_LEVEL - LEARNING_LEVEL), 0, 1)
    return trained * ownerConfidence(ctx.training.owner) * (0.85 + 0.15 * ctx.personality.affection)
  }

  obeyChance(ctx: TrainingContext, id: CommandId, speaker: Speaker = 'owner'): number {
    const def = COMMANDS[id]
    const p = ctx.personality
    const level = skillOf(ctx.training, id).level
    let chance = 0.1 + 0.8 * Math.pow(level / 100, 0.75)
    chance *= 0.75 + 0.5 * p.intelligence
    chance *= 1 - 0.35 * p.mischief
    if (def.active) {
      chance *= 1 - 0.3 * p.laziness
      if (ctx.stats.energy < 25) chance *= 0.45
    }
    chance *= 0.85 + 0.3 * (ctx.stats.affection / 100)
    if (ctx.currentState === 'SLEEPING') chance *= id === 'sleep' ? 1 : 0.35
    if (id === 'sleep' && ctx.stats.energy > 85) chance *= 0.5
    const bias = ctx.species.behaviorBias[def.state] ?? 1
    chance *= 0.8 + 0.2 * Math.min(2, bias)
    chance = clamp(chance, 0.04, 0.97)
    // Somebody else's voice: a loyal pet mostly waits for its owner.
    if (speaker === 'stranger') chance *= 1 - 0.97 * this.loyalty(ctx, id)
    return chance
  }

  command(ctx: TrainingContext, id: CommandId, rng: Rng, speaker: Speaker = 'owner'): CommandResult {
    const def = COMMANDS[id]
    const p = ctx.personality
    const skill = skillOf(ctx.training, id)
    const before = skill.level
    const obeyed = rng.chance(this.obeyChance(ctx, id, speaker))
    const stranger = speaker === 'stranger'
    const refusedStranger = !obeyed && stranger && this.loyalty(ctx, id) > 0.2
    // Repetition alone is slow going; treats and praise do the heavy lifting (see reward/praise).
    let gain = obeyed ? (1 + 2 * p.intelligence) * Math.pow(1 - before / 100, 0.6) + 0.3 : 0.3 + 0.5 * p.intelligence
    if (stranger) gain *= 0.5
    if (refusedStranger) gain = 0
    const after = clamp(before + gain, 0, 100)
    const next: CommandSkill = { level: after, heard: skill.heard + 1, obeyed: skill.obeyed + (obeyed ? 1 : 0), lastAt: ctx.nowMs }
    let training = withSkill(ctx.training, id, next)
    training = {
      ...training,
      total: training.total + 1,
      // Only the owner's successes can be reinforced: a stranger cannot train the pet with treats.
      lastObeyed: obeyed && !stranger ? { id, at: ctx.nowMs } : training.lastObeyed,
      lastRefused: obeyed || refusedStranger ? training.lastRefused : { id, at: ctx.nowMs }
    }
    const reaction = obeyed ? this.obeyReaction(ctx, id, rng) : refusedStranger ? this.strangerReaction(ctx, rng) : this.refuseReaction(ctx, id, rng)
    return { id, obeyed, before, after, milestone: milestoneFor(before, after), reaction, training, refusedStranger }
  }

  /** "Good boy": reinforces the last obeyed command if it was recent. */
  praise(ctx: TrainingContext, rng: Rng): ReinforceResult {
    const p = ctx.personality
    const recent = this.recent(ctx.training.lastObeyed, ctx.nowMs)
    const love = rng.pick(['*happy wiggle*', '*proud*', '💕', ...ctx.species.voice])
    if (!recent) {
      return {
        id: null,
        before: 0,
        after: 0,
        milestone: null,
        reaction: { state: 'HAPPY', movement: 'none', duration: 2.5, speech: rng.chance(0.7) ? love : null, fx: 'hearts', stats: { happiness: 2, affection: 0.5 } },
        training: ctx.training
      }
    }
    const skill = skillOf(ctx.training, recent.id)
    const before = skill.level
    const after = clamp(before + (2 + 2 * p.affection) * Math.pow(1 - before / 100, 0.5) + 0.5, 0, 100)
    const training: TrainingState = { ...withSkill(ctx.training, recent.id, { ...skill, level: after }), lastObeyed: null }
    return {
      id: recent.id,
      before,
      after,
      milestone: milestoneFor(before, after),
      reaction: { state: 'HAPPY', movement: 'none', duration: 3, speech: rng.pick(['I did good?', love, 'again! again!', '*tail goes wild*']), fx: 'hearts', stats: { happiness: 4 + 2 * p.affection, affection: 1.5, experience: 2 }, faceViewer: true },
      training
    }
  }

  /** A treat right after obeying is the strongest reinforcement. Returns id null when nothing was recent. */
  reward(ctx: TrainingContext): ReinforceResult {
    const recent = this.recent(ctx.training.lastObeyed, ctx.nowMs)
    if (!recent) return { id: null, before: 0, after: 0, milestone: null, reaction: null, training: ctx.training }
    const skill = skillOf(ctx.training, recent.id)
    const before = skill.level
    const after = clamp(before + (7 + 4 * ctx.personality.intelligence) * Math.pow(1 - before / 100, 0.5) + 2, 0, 100)
    const training: TrainingState = { ...withSkill(ctx.training, recent.id, { ...skill, level: after }), lastObeyed: null, treats: ctx.training.treats + 1 }
    return { id: recent.id, before, after, milestone: milestoneFor(before, after), reaction: null, training }
  }

  /** "No", "bad dog": a scold right after a refusal teaches the boundary; otherwise it just stings. */
  scold(ctx: TrainingContext, rng: Rng): ReinforceResult {
    const p = ctx.personality
    const recent = this.recent(ctx.training.lastRefused, ctx.nowMs)
    const sad = rng.pick(['*ears down*', '...sorry', '*whimper*', '*looks away*'])
    const defiant = rng.pick(['hmph.', '*ignores you*', '>:(', '*slow blink*'])
    const speech = p.mischief > 0.6 && rng.chance(0.5) ? defiant : sad
    const reaction: Reaction = { state: speech === defiant ? 'ANNOYED' : 'SAD', movement: 'none', duration: 2.5, speech, fx: null, stats: { happiness: -1.5 } }
    if (!recent) return { id: null, before: 0, after: 0, milestone: null, reaction, training: ctx.training }
    const skill = skillOf(ctx.training, recent.id)
    const before = skill.level
    const after = clamp(before + 1.5 + 0.5 * p.intelligence, 0, 100)
    const training: TrainingState = { ...withSkill(ctx.training, recent.id, { ...skill, level: after }), lastRefused: null }
    return { id: recent.id, before, after, milestone: milestoneFor(before, after), reaction, training }
  }

  private recent(ref: { id: CommandId; at: number } | null, nowMs: number): { id: CommandId; at: number } | null {
    return ref && nowMs - ref.at <= REINFORCE_WINDOW_S * 1000 ? ref : null
  }

  private obeyReaction(ctx: TrainingContext, id: CommandId, rng: Rng): Reaction {
    const def = COMMANDS[id]
    const voice = ctx.species.voice
    const lines = id === 'speak' ? [voice[0], `${voice[0]} ${voice[0]}!`, ...voice] : [...def.obeySpeech, ...voice]
    const stats: Partial<PetStats> = { happiness: 2, affection: 1, experience: 3 }
    if (def.active) stats.energy = -2
    return {
      state: def.state,
      movement: def.movement,
      duration: rng.range(def.duration[0], def.duration[1]),
      speech: rng.chance(id === 'speak' ? 1 : 0.8) ? rng.pick(lines) : null,
      fx: id === 'speak' ? 'music' : null,
      stats,
      jump: id === 'jump',
      faceViewer: id === 'stay' || id === 'sit' || id === 'speak'
    }
  }

  private refuseReaction(ctx: TrainingContext, id: CommandId, rng: Rng): Reaction {
    const p = ctx.personality
    const level = skillOf(ctx.training, id).level
    type Option = { state: BehaviorState; weight: number; speech: string[]; ignore?: boolean; fx: Reaction['fx'] }
    const options: Option[] = [
      { state: 'CURIOUS', weight: 2 + (1 - level / 100) * 3, speech: ['hm?', '*tilts head*', 'what?', '...?'], fx: 'question' },
      { state: 'LOOKING_AROUND', weight: 1 + p.mischief * 3, speech: ['*pretends not to hear*', '*looks elsewhere*', 'did you say something?'], fx: null },
      { state: ctx.currentState, weight: 0.5 + p.laziness * 3, speech: ['*slow blink*', 'maybe later', '...'], fx: null, ignore: true },
      { state: 'WATCHING', weight: 1, speech: ['*stares*', 'why though', '*considers it*'], fx: null }
    ]
    if (ctx.currentState === 'SLEEPING') options.push({ state: 'SLEEPING', weight: 6, speech: ['zzz', '*snore*'], fx: null, ignore: true })
    const chosen = rng.pickWeighted(options, (o) => o.weight) ?? options[0]
    return {
      state: chosen.state,
      movement: 'none',
      duration: rng.range(1.5, 2.5),
      speech: rng.chance(0.75) ? rng.pick(chosen.speech) : null,
      fx: chosen.fx,
      stats: {},
      ignore: chosen.ignore,
      faceViewer: !chosen.ignore
    }
  }

  /** A trained pet hearing a voice that is not its owner's: it looks, but it waits for its person. */
  private strangerReaction(ctx: TrainingContext, rng: Rng): Reaction {
    const owner = ctx.ownerName?.trim()
    const lines = owner
      ? [`*looks around for ${owner}*`, `you're not ${owner}`, `only ${owner} says that`, 'who are you?', '*waits for my human*']
      : ["you're not my human", 'who are you?', '*waits for my human*', '*sniffs* ...no.', 'I only listen to my person']
    const suspicious = ctx.personality.friendliness < 0.5 && rng.chance(0.4)
    return {
      state: suspicious ? 'ANNOYED' : 'WATCHING',
      movement: 'none',
      duration: rng.range(2, 3),
      speech: rng.chance(0.85) ? rng.pick(lines) : null,
      fx: 'question',
      stats: {},
      faceViewer: true
    }
  }
}
