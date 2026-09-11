import type { Personality } from './Personality'
import type { PetStats, Mood } from './PetStats'
import type { PetMemory } from './Memory'

/** Every state the pet can be in. Behaviors are what the pet *decides*; a few are imposed by physics/user. */
export type BehaviorState =
  | 'IDLE'
  | 'WALKING'
  | 'RUNNING'
  | 'SITTING'
  | 'SLEEPING'
  | 'EATING'
  | 'DRINKING'
  | 'PLAYING'
  | 'LOOKING_AROUND'
  | 'STRETCHING'
  | 'JUMPING'
  | 'HAPPY'
  | 'SAD'
  | 'CURIOUS'
  | 'EXCITED'
  | 'TIRED'
  | 'BATHING'
  | 'GROOMING'
  | 'ANNOYED'
  | 'SCARED'
  | 'DANCING'
  | 'HIDING'
  | 'ZOOMIES'
  | 'CHASING'
  | 'CELEBRATING'
  | 'WATCHING'
  | 'DRAGGED'
  | 'FALLING'
  | 'FETCHING'
  | 'CARRYING'
  | 'TUGGING'

/** Visual animation clips. Several behaviors share a clip. */
export type AnimationName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sit'
  | 'sleep'
  | 'eat'
  | 'drink'
  | 'play'
  | 'jump'
  | 'stretch'
  | 'happy'
  | 'sad'
  | 'curious'
  | 'angry'
  | 'excited'
  | 'scared'
  | 'dance'
  | 'groom'
  | 'bathe'
  | 'tired'
  | 'hide'
  | 'watch'
  | 'dragged'
  | 'fall'
  | 'tug'

export type MovementMode = 'none' | 'walk' | 'run' | 'toCursor' | 'zoom' | 'chase' | 'toPoint'

/** Everything the behavior engine may look at when weighing options. */
export interface DecisionContext {
  personality: Personality
  stats: PetStats
  mood: Mood
  memory: PetMemory
  previousState: BehaviorState
  /** seconds since the user last touched keyboard/mouse */
  idleSeconds: number
  /** seconds of continuous user activity */
  activeSeconds: number
  cursorOnDisplay: boolean
  /** cursor moved within the last ~2 seconds */
  cursorMoving: boolean
  /** cursor within ~250px of the pet */
  cursorNear: boolean
  /** seconds since the user last interacted with the pet (Infinity if never) */
  sinceInteraction: number
  hourOfDay: number
  /** species specific multipliers */
  speciesBias: Partial<Record<BehaviorState, number>>
  /** free roam mode allows vertical destinations */
  freeRoam: boolean
}

export interface BehaviorDefinition {
  state: BehaviorState
  animation: AnimationName
  movement: MovementMode
  /** Relative frequency before modifiers. Roughly matches the product spec percentages. */
  baseWeight: number
  /** [min, max] seconds */
  duration: [number, number]
  /** seconds before the same behavior can be picked again */
  cooldown: number
  /** stat deltas per second while active */
  effects?: Partial<PetStats>
  /** Returns a multiplier (0 disables). */
  modifier: (ctx: DecisionContext) => number
  /** Optional short thoughts the pet may show when the behavior starts (low probability). */
  thoughts?: string[]
  /** Stats applied once when the behavior finishes naturally. */
  onComplete?: Partial<PetStats>
}

export const ANIMATION_FOR_STATE: Record<BehaviorState, AnimationName> = {
  IDLE: 'idle',
  WALKING: 'walk',
  RUNNING: 'run',
  SITTING: 'sit',
  SLEEPING: 'sleep',
  EATING: 'eat',
  DRINKING: 'drink',
  PLAYING: 'play',
  LOOKING_AROUND: 'curious',
  STRETCHING: 'stretch',
  JUMPING: 'jump',
  HAPPY: 'happy',
  SAD: 'sad',
  CURIOUS: 'curious',
  EXCITED: 'excited',
  TIRED: 'tired',
  BATHING: 'bathe',
  GROOMING: 'groom',
  ANNOYED: 'angry',
  SCARED: 'scared',
  DANCING: 'dance',
  HIDING: 'hide',
  ZOOMIES: 'run',
  CHASING: 'run',
  CELEBRATING: 'excited',
  WATCHING: 'watch',
  DRAGGED: 'dragged',
  FALLING: 'fall',
  FETCHING: 'run',
  CARRYING: 'run',
  TUGGING: 'tug'
}

const energyFactor = (s: PetStats, floor = 0.15): number => Math.max(floor, s.energy / 100)

/**
 * The behavior catalogue. Base weights follow the product spec
 * (IDLE 30, WALK 20, LOOK 10, SIT 10, SLEEP 8, PLAY 5, STRETCH 5, GROOM 4, JUMP 3)
 * and personality/stats/environment multiply them.
 */
export const BEHAVIORS: BehaviorDefinition[] = [
  {
    state: 'IDLE',
    animation: 'idle',
    movement: 'none',
    baseWeight: 30,
    duration: [3, 9],
    cooldown: 0,
    modifier: (c) => 1 + c.personality.laziness * 0.3
  },
  {
    state: 'WALKING',
    animation: 'walk',
    movement: 'walk',
    baseWeight: 20,
    duration: [3, 10],
    cooldown: 0,
    effects: { energy: -0.01 },
    modifier: (c) => (0.5 + c.personality.energy) * (1 - c.personality.laziness * 0.5) * (0.3 + energyFactor(c.stats))
  },
  {
    state: 'RUNNING',
    animation: 'run',
    movement: 'run',
    baseWeight: 3,
    duration: [2, 5],
    cooldown: 60,
    effects: { energy: -0.08, happiness: 0.05 },
    modifier: (c) => (c.personality.playfulness + c.personality.energy) * (c.stats.energy > 40 ? 1 : 0.1)
  },
  {
    state: 'LOOKING_AROUND',
    animation: 'curious',
    movement: 'none',
    baseWeight: 10,
    duration: [2, 5],
    cooldown: 20,
    modifier: (c) => 0.5 + c.personality.curiosity
  },
  {
    state: 'SITTING',
    animation: 'sit',
    movement: 'none',
    baseWeight: 10,
    duration: [6, 20],
    cooldown: 30,
    effects: { energy: 0.01 },
    modifier: (c) => (0.6 + c.personality.laziness) * (c.previousState === 'RUNNING' ? 2 : 1)
  },
  {
    state: 'SLEEPING',
    animation: 'sleep',
    movement: 'none',
    baseWeight: 8,
    duration: [40, 180],
    cooldown: 600,
    modifier: (c) => {
      let m = 0.5 + c.personality.laziness
      if (c.stats.energy < 30) m *= 4
      else if (c.stats.energy > 80) m *= 0.3
      if (c.hourOfDay >= 23 || c.hourOfDay < 6) m *= 1.6
      if (c.idleSeconds > 600) m *= 2
      return m
    },
    thoughts: ['*yawn*', 'zzz...', 'nap time 😴']
  },
  {
    state: 'EATING',
    animation: 'eat',
    movement: 'none',
    baseWeight: 6,
    duration: [5, 9],
    cooldown: 300,
    effects: { hunger: -3 },
    modifier: (c) => (c.stats.hunger < 30 ? 0 : c.stats.hunger > 80 ? 8 : Math.pow(c.stats.hunger / 100, 2) * 3),
    thoughts: ['snack time!', 'nom nom nom']
  },
  {
    state: 'DRINKING',
    animation: 'drink',
    movement: 'none',
    baseWeight: 2,
    duration: [3, 5],
    cooldown: 240,
    modifier: (c) => (c.previousState === 'RUNNING' || c.previousState === 'PLAYING' || c.previousState === 'ZOOMIES' ? 3 : 1)
  },
  {
    state: 'PLAYING',
    animation: 'play',
    movement: 'none',
    baseWeight: 5,
    duration: [4, 9],
    cooldown: 120,
    effects: { energy: -0.1, happiness: 0.15 },
    modifier: (c) => (0.3 + c.personality.playfulness * 1.5) * energyFactor(c.stats),
    thoughts: ['wheee!', 'play play play']
  },
  {
    state: 'STRETCHING',
    animation: 'stretch',
    movement: 'none',
    baseWeight: 5,
    duration: [2.5, 4],
    cooldown: 90,
    modifier: (c) => (c.previousState === 'SLEEPING' || c.previousState === 'SITTING' ? 2.5 : 1)
  },
  {
    state: 'GROOMING',
    animation: 'groom',
    movement: 'none',
    baseWeight: 4,
    duration: [4, 8],
    cooldown: 120,
    modifier: (c) => 0.5 + c.personality.laziness
  },
  {
    state: 'BATHING',
    animation: 'bathe',
    movement: 'none',
    baseWeight: 1,
    duration: [4, 7],
    cooldown: 600,
    effects: { happiness: 0.05 },
    modifier: () => 1
  },
  {
    state: 'JUMPING',
    animation: 'jump',
    movement: 'none',
    baseWeight: 3,
    duration: [0.9, 0.9],
    cooldown: 45,
    effects: { energy: -0.3 },
    modifier: (c) => (0.3 + c.personality.playfulness + c.personality.energy) * energyFactor(c.stats, 0)
  },
  {
    state: 'CURIOUS',
    animation: 'curious',
    movement: 'toCursor',
    baseWeight: 4,
    duration: [4, 8],
    cooldown: 60,
    modifier: (c) => {
      if (!c.cursorOnDisplay || c.idleSeconds > 20) return 0
      return c.personality.curiosity * (c.cursorMoving ? 2 : 0.5) * (0.5 + c.personality.friendliness)
    },
    thoughts: ['what is that?', 'hmm?', '👀']
  },
  {
    state: 'WATCHING',
    animation: 'watch',
    movement: 'none',
    baseWeight: 3,
    duration: [3, 7],
    cooldown: 40,
    modifier: (c) => (c.cursorOnDisplay && c.cursorMoving ? 0.5 + c.personality.curiosity : 0)
  },
  {
    state: 'HAPPY',
    animation: 'happy',
    movement: 'none',
    baseWeight: 3,
    duration: [2, 4],
    cooldown: 30,
    modifier: (c) => (c.mood === 'ecstatic' ? 2 : c.mood === 'happy' ? 1 : 0)
  },
  {
    state: 'SAD',
    animation: 'sad',
    movement: 'none',
    baseWeight: 3,
    duration: [4, 8],
    cooldown: 60,
    modifier: (c) => (c.mood === 'sad' ? 2 : c.mood === 'bored' ? 0.7 : 0),
    thoughts: ['...', 'sigh', 'anyone there?']
  },
  {
    state: 'EXCITED',
    animation: 'excited',
    movement: 'none',
    baseWeight: 3,
    duration: [2, 4],
    cooldown: 45,
    modifier: (c) => (c.sinceInteraction < 60 ? 0.5 + c.personality.playfulness : 0)
  },
  {
    state: 'TIRED',
    animation: 'tired',
    movement: 'none',
    baseWeight: 4,
    duration: [4, 8],
    cooldown: 60,
    modifier: (c) => (c.stats.energy < 25 ? 2 : 0),
    thoughts: ['so sleepy...', '*yawn*']
  },
  {
    state: 'DANCING',
    animation: 'dance',
    movement: 'none',
    baseWeight: 0.6,
    duration: [4, 7],
    cooldown: 900,
    effects: { happiness: 0.2, energy: -0.1 },
    modifier: (c) => c.personality.playfulness * (0.5 + c.personality.mischief) * (c.mood === 'sad' ? 0 : 1),
    thoughts: ['♪♫', 'dance party!']
  },
  {
    state: 'HIDING',
    animation: 'hide',
    movement: 'none',
    baseWeight: 0.5,
    duration: [6, 12],
    cooldown: 1200,
    modifier: (c) => 0.3 + c.personality.mischief,
    thoughts: ["you can't see me", 'shh...']
  }
]

export const BEHAVIOR_BY_STATE: Record<string, BehaviorDefinition> = Object.fromEntries(
  BEHAVIORS.map((b) => [b.state, b])
)
