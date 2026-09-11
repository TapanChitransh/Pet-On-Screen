import type { BehaviorState, MovementMode } from '@models/Behavior'
import type { PetStats } from '@models/PetStats'
import type { Personality } from '@models/Personality'
import type { SpeciesDefinition } from '@models/Species'
import { ITEMS } from '@models/Items'
import type { Rng } from './rng'
import type { EventFx } from './EventEngine'

/** What the pet does in response to something the user did. */
export interface Reaction {
  state: BehaviorState
  movement: MovementMode
  duration: number
  speech: string | null
  fx: EventFx
  stats: Partial<PetStats>
  /** When true the current behavior simply continues (the pet ignores you). */
  ignore?: boolean
  /** Ask movement to jump */
  jump?: boolean
  faceViewer?: boolean
}

export interface InteractionContext {
  personality: Personality
  stats: PetStats
  species: SpeciesDefinition
  currentState: BehaviorState
  /** Seconds since the pet was adopted; new pets are shyer. */
  ageSeconds: number
}

/**
 * Turns clicks, petting, feeding and so on into varied, personality-aware reactions.
 * Nothing here is deterministic: repeated clicks never produce the exact same result.
 */
export class InteractionEngine {
  private clickTimes: number[] = []

  /** Current click streak inside a 10 second window. */
  clickStreak(nowSeconds: number): number {
    this.clickTimes = this.clickTimes.filter((t) => nowSeconds - t < 10)
    return this.clickTimes.length
  }

  hover(ctx: InteractionContext, rng: Rng): Reaction | null {
    if (ctx.currentState === 'SLEEPING' || ctx.currentState === 'DRAGGED') return null
    if (!rng.chance(0.25 + ctx.personality.curiosity * 0.5)) return null
    return {
      state: 'WATCHING',
      movement: 'none',
      duration: rng.range(1.5, 3.5),
      speech: null,
      fx: null,
      stats: {}
    }
  }

  click(ctx: InteractionContext, nowSeconds: number, rng: Rng): Reaction {
    this.clickTimes.push(nowSeconds)
    const streak = this.clickStreak(nowSeconds)
    const p = ctx.personality
    const voice = ctx.species.voice

    if (ctx.currentState === 'SLEEPING') {
      // Waking a sleeping pet: friendly ones stretch, grumpy ones complain.
      if (rng.chance(0.5 + p.laziness * 0.4)) {
        return { state: 'ANNOYED', movement: 'none', duration: 2.5, speech: rng.pick(['hmph.', '...five more minutes', 'I was sleeping!']), fx: null, stats: { happiness: -2 } }
      }
      return { state: 'STRETCHING', movement: 'none', duration: 3, speech: rng.pick(['*yawn*', 'mm? oh, hi']), fx: null, stats: {} }
    }

    type Option = { state: BehaviorState; weight: number; speech: string[]; fx: EventFx; stats: Partial<PetStats>; jump?: boolean; ignore?: boolean }
    const options: Option[] = [
      { state: 'HAPPY', weight: 3 + p.friendliness * 4, speech: [...voice, 'hehe', '💕'], fx: 'hearts', stats: { happiness: 1.5, affection: 0.5 } },
      { state: 'EXCITED', weight: 2 + p.playfulness * 4, speech: ['again! again!', 'yes!!', ...voice], fx: null, stats: { happiness: 1.5, energy: -1 } },
      { state: 'CURIOUS', weight: 1 + p.curiosity * 3, speech: ['hm?', 'what?', 'yes?'], fx: 'question', stats: {} },
      { state: 'JUMPING', weight: 1 + p.energy * 2, speech: ['boing!', '*hop*'], fx: null, stats: { energy: -1 }, jump: true },
      { state: 'PLAYING', weight: p.playfulness * 2, speech: ['play?', '*wiggle*'], fx: null, stats: { happiness: 2, energy: -1 } },
      // laziness / mischief -> the pet just ignores you sometimes
      { state: ctx.currentState, weight: p.laziness * 1.5 + p.mischief, speech: ['...', '*ignores you*', '*slow blink*'], fx: null, stats: {}, ignore: true }
    ]
    // Too much poking gets old fast.
    if (streak >= 4) {
      options.push({
        state: 'ANNOYED',
        weight: (streak - 3) * (2 + (1 - p.friendliness) * 4) * (ctx.species.behaviorBias.ANNOYED ?? 1),
        speech: ['stop that!', 'hey!', 'enough...', 'grr', '>:('],
        fx: 'exclaim',
        stats: { happiness: -2 }
      })
    }
    if (streak >= 9) {
      options.push({ state: 'HIDING', weight: 3 + p.mischief * 4, speech: ['bye.', '*hides*'], fx: null, stats: { happiness: -1 } })
      options.push({ state: 'SCARED', weight: 2, speech: ['!!!'], fx: 'exclaim', stats: { happiness: -1 } })
    }

    const chosen = rng.pickWeighted(options, (o) => o.weight) ?? options[0]
    const showSpeech = rng.chance(0.55)
    return {
      state: chosen.state,
      movement: 'none',
      duration: chosen.state === 'JUMPING' ? 0.9 : rng.range(1.8, 3.2),
      speech: showSpeech ? rng.pick(chosen.speech) : null,
      fx: chosen.fx,
      stats: chosen.stats,
      jump: chosen.jump,
      ignore: chosen.ignore
    }
  }

  pet(ctx: InteractionContext, rng: Rng): Reaction {
    const p = ctx.personality
    if (ctx.currentState === 'SLEEPING' && rng.chance(0.5 - p.affection * 0.4)) {
      return { state: 'ANNOYED', movement: 'none', duration: 2, speech: '*grumble*', fx: null, stats: { happiness: -1 } }
    }
    const love = rng.pick(['*purrs*', '*leans in*', '*happy wiggle*', 'more please', '💕', ...ctx.species.voice])
    return {
      state: 'HAPPY',
      movement: 'none',
      duration: rng.range(3, 4.5),
      speech: rng.chance(0.8) ? love : null,
      fx: 'hearts',
      stats: { happiness: 6 + p.affection * 4, affection: 2 + p.affection * 2, experience: 2 }
    }
  }

  feed(ctx: InteractionContext, foodId: string, rng: Rng): Reaction {
    const item = ITEMS[foodId]
    if (!item || item.kind !== 'food') {
      return { state: 'CURIOUS', movement: 'none', duration: 2, speech: 'I can\'t eat that!', fx: 'question', stats: {} }
    }
    if (ctx.stats.hunger < 8) {
      return { state: 'CURIOUS', movement: 'none', duration: 2.5, speech: rng.pick(["I'm full!", 'maybe later', '*sniffs* not now']), fx: null, stats: {} }
    }
    const favorite = ctx.species.favoriteFoods.includes(foodId)
    const speech = favorite
      ? rng.pick(['MY FAVORITE!', 'yes yes yes', 'best. day. ever.'])
      : rng.pick(['nom nom', '*munch*', 'thank you!', 'yum'])
    return {
      state: 'EATING',
      movement: 'none',
      duration: rng.range(4.5, 6.5),
      speech,
      fx: favorite ? 'sparkle' : null,
      stats: {
        hunger: -item.power,
        happiness: favorite ? 10 : 4,
        affection: favorite ? 3 : 1.5,
        experience: 3
      }
    }
  }

  play(ctx: InteractionContext, rng: Rng): Reaction {
    if (ctx.stats.energy < 15) {
      return { state: 'TIRED', movement: 'none', duration: 3, speech: rng.pick(['too sleepy...', '*yawn* later?']), fx: 'zzz', stats: {} }
    }
    const p = ctx.personality
    return {
      state: 'PLAYING',
      movement: 'none',
      duration: rng.range(6, 9),
      speech: rng.pick(['wheee!', 'catch me!', 'yes! play!', '*zoom*']),
      fx: null,
      stats: { happiness: 10 + p.playfulness * 5, energy: -8, affection: 3, experience: 5 }
    }
  }

  toy(ctx: InteractionContext, toyId: string, rng: Rng): Reaction {
    const item = ITEMS[toyId]
    if (!item || item.kind !== 'toy') {
      return { state: 'CURIOUS', movement: 'none', duration: 2, speech: 'what is this for?', fx: 'question', stats: {} }
    }
    const favorite = ctx.species.favoriteToys.includes(toyId)
    return {
      state: favorite ? 'EXCITED' : 'PLAYING',
      movement: 'none',
      duration: rng.range(5, 8),
      speech: favorite ? rng.pick([`${item.emoji}!!!`, 'MINE!', 'the best toy']) : rng.pick([`ooh, a ${item.name.toLowerCase()}`, '*bats at it*']),
      fx: favorite ? 'sparkle' : null,
      stats: { happiness: item.power * (favorite ? 1.5 : 1), energy: -5, affection: 2, experience: 4 }
    }
  }

  talk(ctx: InteractionContext): Reaction {
    return {
      state: 'WATCHING',
      movement: 'none',
      duration: 6,
      speech: null,
      fx: null,
      stats: { affection: 0.5, happiness: 1, experience: 1 },
      faceViewer: true
    }
  }

  /** Reaction to being released after a drag. dropHeight is px above the floor at release. */
  dropped(ctx: InteractionContext, dropHeight: number, rng: Rng): Reaction {
    if (dropHeight > 200) {
      return { state: 'SCARED', movement: 'none', duration: 2.5, speech: rng.pick(['!!!', 'hey!!', 'careful!']), fx: 'exclaim', stats: { happiness: -2 } }
    }
    return { state: 'LOOKING_AROUND', movement: 'none', duration: rng.range(1.5, 3), speech: rng.chance(0.4) ? rng.pick(['*shakes off*', 'where am I?', 'hm.']) : null, fx: null, stats: {} }
  }
}
