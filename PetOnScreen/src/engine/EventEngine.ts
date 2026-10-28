import type { BehaviorState, DecisionContext, MovementMode } from '@models/Behavior'
import type { PetStats } from '@models/PetStats'
import type { Rng } from './rng'

export type EventFx = 'sparkle' | 'hearts' | 'zzz' | 'question' | 'exclaim' | 'music' | 'gift' | null

export interface SpontaneousEvent {
  id: string
  /** relative rarity - the lower, the more surprising */
  weight: number
  /** minimum seconds between two occurrences */
  minInterval: number
  state: BehaviorState
  movement: MovementMode
  duration: [number, number]
  speech?: string[]
  fx?: EventFx
  /** one-off stat change */
  stats?: Partial<PetStats>
  /** item id pool the pet may find / bring */
  items?: string[]
  /** extra eligibility */
  when?: (ctx: DecisionContext) => boolean
  /** true = the pet looks straight at the viewer */
  faceViewer?: boolean
}

export const EVENTS: SpontaneousEvent[] = [
  {
    id: 'chase_something',
    weight: 10,
    minInterval: 240,
    state: 'CHASING',
    movement: 'chase',
    duration: [4, 8],
    speech: ['!!', 'gotcha... almost!', '*spots a bug*'],
    fx: 'exclaim',
    when: (c) => c.stats.energy > 30
  },
  {
    id: 'sudden_sleep',
    weight: 6,
    minInterval: 900,
    state: 'SLEEPING',
    movement: 'none',
    duration: [30, 90],
    speech: ['...zzz', '*flop*'],
    fx: 'zzz',
    when: (c) => c.stats.energy < 70
  },
  {
    id: 'find_object',
    weight: 4,
    minInterval: 1800,
    state: 'CURIOUS',
    movement: 'walk',
    duration: [5, 8],
    speech: ['ooh, what is this?', 'found something!', '*digs*'],
    fx: 'question',
    items: ['shiny', 'leaf', 'sock', 'flower', 'treat', 'treat'],
    stats: { happiness: 4, experience: 4 }
  },
  {
    id: 'scared',
    weight: 4,
    minInterval: 900,
    state: 'SCARED',
    movement: 'none',
    duration: [2, 4],
    speech: ['!!!', 'eek!', 'what was that?!'],
    fx: 'exclaim'
  },
  {
    id: 'celebrate',
    weight: 3,
    minInterval: 1800,
    state: 'CELEBRATING',
    movement: 'none',
    duration: [3, 5],
    speech: ['yay!', 'hooray!', 'best day ever'],
    fx: 'sparkle',
    stats: { happiness: 5 },
    when: (c) => c.mood !== 'sad' && c.mood !== 'sick'
  },
  {
    id: 'bring_gift',
    weight: 2,
    minInterval: 3600,
    state: 'EXCITED',
    movement: 'toCursor',
    duration: [5, 7],
    speech: ['for you 🎁', 'I brought you something!', 'a present!'],
    fx: 'gift',
    items: ['flower', 'shiny', 'leaf'],
    stats: { affection: 3, experience: 6 },
    when: (c) => c.stats.affection > 30 && c.cursorOnDisplay
  },
  {
    id: 'dance',
    weight: 3,
    minInterval: 1500,
    state: 'DANCING',
    movement: 'none',
    duration: [4, 7],
    speech: ['♪ ♫', 'dance break!'],
    fx: 'music',
    stats: { happiness: 4 },
    when: (c) => c.stats.energy > 40
  },
  {
    id: 'zoomies',
    weight: 6,
    minInterval: 600,
    state: 'ZOOMIES',
    movement: 'zoom',
    duration: [3, 6],
    speech: ['ZOOM', '*zoomies*', 'wheeee'],
    stats: { energy: -8, happiness: 5 },
    when: (c) => c.stats.energy > 50 && c.personality.playfulness + c.personality.energy > 0.9
  },
  {
    id: 'watch_cursor',
    weight: 8,
    minInterval: 180,
    state: 'WATCHING',
    movement: 'none',
    duration: [4, 8],
    when: (c) => c.cursorOnDisplay && c.cursorMoving
  },
  {
    id: 'stare_at_you',
    weight: 5,
    minInterval: 600,
    state: 'WATCHING',
    movement: 'none',
    duration: [3, 6],
    speech: ['...', '👀', 'hi.'],
    faceViewer: true
  },
  {
    id: 'bored_wants_play',
    weight: 6,
    minInterval: 1200,
    state: 'SAD',
    movement: 'toCursor',
    duration: [5, 8],
    speech: ['play with me?', 'so bored...', 'hey. hey. play?'],
    fx: 'question',
    when: (c) => c.stats.happiness < 55 && c.sinceInteraction > 20 * 60 && c.idleSeconds < 30
  },
  {
    id: 'discover_toy',
    weight: 2,
    minInterval: 5400,
    state: 'EXCITED',
    movement: 'none',
    duration: [3, 5],
    speech: ['a new toy!', 'look what I found!'],
    fx: 'sparkle',
    items: ['ball', 'yarn', 'stick', 'feather', 'snowball'],
    stats: { happiness: 8, experience: 8 }
  },
  {
    id: 'hide',
    weight: 3,
    minInterval: 1800,
    state: 'HIDING',
    movement: 'none',
    duration: [8, 15],
    speech: ['*hides*', "can't see me"],
    when: (c) => c.personality.mischief > 0.4
  },
  {
    id: 'rare_sparkle',
    weight: 0.4,
    minInterval: 7200,
    state: 'DANCING',
    movement: 'none',
    duration: [6, 8],
    speech: ['✨ ✨ ✨', 'a very special moment'],
    fx: 'sparkle',
    stats: { happiness: 10, experience: 20 }
  }
]

export interface TriggeredEvent {
  event: SpontaneousEvent
  duration: number
  speech: string | null
  item: string | null
}

/**
 * Rolls for rare spontaneous events at behavior decision points. Roughly 5% of decisions
 * become an event (personality nudges this), and each event has its own rarity and interval.
 */
export class EventEngine {
  private lastFired: Record<string, number> = {}

  roll(ctx: DecisionContext, nowSeconds: number, rng: Rng): TriggeredEvent | null {
    const chance = 0.05 * (0.7 + ctx.personality.mischief * 0.3 + ctx.personality.curiosity * 0.3)
    if (!rng.chance(chance)) return null
    return this.fire(ctx, nowSeconds, rng)
  }

  /** Force an event pick (used by tests and by the "surprise me" debug path). */
  fire(ctx: DecisionContext, nowSeconds: number, rng: Rng): TriggeredEvent | null {
    const eligible = EVENTS.filter((e) => {
      const last = this.lastFired[e.id]
      if (last !== undefined && nowSeconds - last < e.minInterval) return false
      return e.when ? e.when(ctx) : true
    })
    const event = rng.pickWeighted(eligible, (e) => e.weight * (ctx.speciesBias[e.state] ?? 1))
    if (!event) return null
    this.lastFired[event.id] = nowSeconds
    return {
      event,
      duration: rng.range(event.duration[0], event.duration[1]),
      speech: event.speech ? rng.pick(event.speech) : null,
      item: event.items ? rng.pick(event.items) : null
    }
  }
}
