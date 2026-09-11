import type { Personality } from './Personality'
import type { BehaviorState } from './Behavior'

/**
 * Visual recipe for the procedural sprite. Three body archetypes share one animation system:
 *  - quadruped: four legs, tail, head at the front (dog, cat, deer, dragon...)
 *  - upright:   bird-like body standing tall, wings as arms (penguin, owl, duck, swan)
 *  - human:     a small person with arms, legs, hair and an outfit
 */
export type Archetype = 'quadruped' | 'upright' | 'human'

export interface SpeciesLook {
  archetype: Archetype
  body: string
  belly: string
  accent: string
  /** quadruped ears */
  ear: 'pointy' | 'floppy' | 'long' | 'round' | 'small' | 'tuft' | 'none'
  /** quadruped tails */
  tail: 'curly' | 'long' | 'bushy' | 'ringed' | 'puff' | 'stub' | 'short' | 'spade' | 'flowing' | 'tassel' | 'thin' | 'none'
  /** face style */
  snout: 'dog' | 'cat' | 'bunny' | 'fox' | 'panda' | 'redpanda' | 'deer' | 'unicorn' | 'dragon' | 'hamster' | 'lion' | 'wolf' | 'pug' | 'beak' | 'owl' | 'duck' | 'swan' | 'face'
  /** eye patches (panda) / mask (red panda) / eye ring color */
  mask?: string
  bodyWidth: number
  bodyHeight: number
  /** extra leg length for tall quadrupeds (deer) */
  legLength?: number
  antlers?: boolean
  horn?: boolean
  /** mane color (unicorn) */
  mane?: string
  /** wing color (dragon, birds) */
  wings?: string
  spots?: boolean
  /** eye iris color (husky blue, wolf amber) */
  iris?: string
  /** color of a big mane ring around the head (lion) */
  lionMane?: string
  /** light face mask over the muzzle/eyes area (husky, shiba) */
  faceMask?: string
  /** color of body spots; defaults to the belly color */
  spotColor?: string
  /** floppy ear color; defaults to the accent color */
  earColor?: string
  /** human only */
  hair?: 'short' | 'long' | 'bun' | 'curly'
  hairColor?: string
  skin?: string
  outfit?: string
  pants?: string
  glasses?: boolean
}

export interface MovementStyle {
  walkSpeed: number
  runSpeed: number
  /** vertical height of a jump in px at scale 1 */
  jumpHeight: number
  /** rabbit/penguin hop instead of trotting */
  gait: 'trot' | 'hop' | 'waddle' | 'prowl'
}

export type VoiceKind = 'bark' | 'meow' | 'squeak' | 'chirp' | 'grunt' | 'hoot' | 'quack' | 'honk' | 'neigh' | 'roar' | 'hum' | 'howl'

export interface SpeciesDefinition {
  id: string
  name: string
  emoji: string
  breed: string
  description: string
  /** a person is a companion, not a pet: changes a few labels and the conversation prompt */
  kind: 'animal' | 'person'
  personality: Personality
  movement: MovementStyle
  look: SpeciesLook
  behaviorBias: Partial<Record<BehaviorState, number>>
  favoriteFoods: string[]
  favoriteToys: string[]
  /** short noises / expressions used in speech bubbles */
  voice: string[]
  /** synthesized sound recipe (pitch in Hz) */
  sound: { pitch: number; kind: VoiceKind }
}

export const SPECIES: Record<string, SpeciesDefinition> = {
  dog: {
    id: 'dog',
    name: 'Dog',
    emoji: '🐕',
    breed: 'Golden Retriever',
    description: 'Loyal, playful and always excited to see you. Brings you things.',
    kind: 'animal',
    personality: { playfulness: 0.85, laziness: 0.25, curiosity: 0.6, friendliness: 0.9, energy: 0.8, intelligence: 0.6, affection: 0.85, mischief: 0.4 },
    movement: { walkSpeed: 55, runSpeed: 170, jumpHeight: 60, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#d9a05b', belly: '#f2d3a3', accent: '#8a5a2b', ear: 'floppy', tail: 'curly', snout: 'dog', bodyWidth: 64, bodyHeight: 40 },
    behaviorBias: { PLAYING: 1.4, RUNNING: 1.5, GROOMING: 0.4, BATHING: 0.5, EXCITED: 1.5, ZOOMIES: 1.6 },
    favoriteFoods: ['bone', 'treat'],
    favoriteToys: ['ball', 'stick'],
    voice: ['woof!', 'arf', 'bork', '*tail wag*', 'woof woof'],
    sound: { pitch: 220, kind: 'bark' }
  },
  cat: {
    id: 'cat',
    name: 'Cat',
    emoji: '🐈',
    breed: 'Grey Tabby',
    description: 'Independent and elegant. Sleeps a lot, grooms often, and ignores you on purpose.',
    kind: 'animal',
    personality: { playfulness: 0.5, laziness: 0.8, curiosity: 0.7, friendliness: 0.4, energy: 0.45, intelligence: 0.75, affection: 0.5, mischief: 0.7 },
    movement: { walkSpeed: 45, runSpeed: 190, jumpHeight: 90, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#8b8f9a', belly: '#d8dae0', accent: '#5a5e68', ear: 'pointy', tail: 'long', snout: 'cat', bodyWidth: 58, bodyHeight: 34 },
    behaviorBias: { SLEEPING: 1.6, GROOMING: 2.2, STRETCHING: 1.5, BATHING: 0.1, EXCITED: 0.6, JUMPING: 1.4, HIDING: 1.5, ANNOYED: 1.5 },
    favoriteFoods: ['fish', 'treat'],
    favoriteToys: ['yarn', 'feather'],
    voice: ['meow', 'mrrp', '*purr*', 'mew', '...'],
    sound: { pitch: 520, kind: 'meow' }
  },
  rabbit: {
    id: 'rabbit',
    name: 'Rabbit',
    emoji: '🐇',
    breed: 'Holland Lop',
    description: 'Gentle and a little shy. Hops around, nibbles constantly, and startles easily.',
    kind: 'animal',
    personality: { playfulness: 0.6, laziness: 0.4, curiosity: 0.65, friendliness: 0.6, energy: 0.7, intelligence: 0.5, affection: 0.6, mischief: 0.3 },
    movement: { walkSpeed: 60, runSpeed: 210, jumpHeight: 70, gait: 'hop' },
    look: { archetype: 'quadruped', body: '#c9b8a8', belly: '#f4ece4', accent: '#8f7a68', ear: 'long', tail: 'puff', snout: 'bunny', bodyWidth: 50, bodyHeight: 36 },
    behaviorBias: { EATING: 1.6, SCARED: 2, JUMPING: 1.8, RUNNING: 1.3, GROOMING: 1.3, DANCING: 0.8 },
    favoriteFoods: ['carrot', 'berries'],
    favoriteToys: ['ball'],
    voice: ['*nibble*', '*hop*', 'squeak', '*nose twitch*'],
    sound: { pitch: 800, kind: 'squeak' }
  },
  fox: {
    id: 'fox',
    name: 'Fox',
    emoji: '🦊',
    breed: 'Red Fox',
    description: 'Clever and mischievous. Investigates everything and hides things.',
    kind: 'animal',
    personality: { playfulness: 0.7, laziness: 0.3, curiosity: 0.95, friendliness: 0.55, energy: 0.75, intelligence: 0.9, affection: 0.5, mischief: 0.9 },
    movement: { walkSpeed: 60, runSpeed: 200, jumpHeight: 75, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#e0742a', belly: '#f7e6d3', accent: '#3b2a20', ear: 'pointy', tail: 'bushy', snout: 'fox', bodyWidth: 60, bodyHeight: 34 },
    behaviorBias: { CURIOUS: 1.8, LOOKING_AROUND: 1.5, HIDING: 2.5, WATCHING: 1.5, DANCING: 1.3, CHASING: 1.5 },
    favoriteFoods: ['berries', 'treat'],
    favoriteToys: ['feather', 'stick'],
    voice: ['*chitter*', 'yip!', '*sniff sniff*', 'hehe'],
    sound: { pitch: 420, kind: 'chirp' }
  },
  panda: {
    id: 'panda',
    name: 'Panda',
    emoji: '🐼',
    breed: 'Giant Panda',
    description: 'Round, slow and endlessly hungry. Falls over sometimes. Deeply relaxing to watch.',
    kind: 'animal',
    personality: { playfulness: 0.5, laziness: 0.85, curiosity: 0.4, friendliness: 0.75, energy: 0.3, intelligence: 0.5, affection: 0.7, mischief: 0.35 },
    movement: { walkSpeed: 35, runSpeed: 110, jumpHeight: 35, gait: 'waddle' },
    look: { archetype: 'quadruped', body: '#f3f3f3', belly: '#ffffff', accent: '#222222', ear: 'round', tail: 'stub', snout: 'panda', mask: '#222222', bodyWidth: 66, bodyHeight: 46 },
    behaviorBias: { EATING: 2.2, SLEEPING: 1.5, SITTING: 1.6, RUNNING: 0.4, JUMPING: 0.4, STRETCHING: 1.2, DANCING: 1.2 },
    favoriteFoods: ['bamboo', 'berries'],
    favoriteToys: ['ball'],
    voice: ['*munch*', '*roll*', 'mmm', '*sleepy blink*'],
    sound: { pitch: 160, kind: 'grunt' }
  },
  penguin: {
    id: 'penguin',
    name: 'Penguin',
    emoji: '🐧',
    breed: 'Emperor Penguin',
    description: 'Waddles with purpose. Loves sliding, bathing and looking very serious.',
    kind: 'animal',
    personality: { playfulness: 0.65, laziness: 0.35, curiosity: 0.55, friendliness: 0.7, energy: 0.6, intelligence: 0.6, affection: 0.65, mischief: 0.45 },
    movement: { walkSpeed: 40, runSpeed: 140, jumpHeight: 30, gait: 'waddle' },
    look: { archetype: 'upright', body: '#2b2f3a', belly: '#f7f7f7', accent: '#f5a623', ear: 'none', tail: 'none', snout: 'beak', bodyWidth: 46, bodyHeight: 54 },
    behaviorBias: { BATHING: 4, DANCING: 1.6, WATCHING: 1.4, GROOMING: 1.2, JUMPING: 0.6, RUNNING: 0.9 },
    favoriteFoods: ['fish'],
    favoriteToys: ['snowball', 'ball'],
    voice: ['*honk*', '*waddle*', 'squawk', '*flap flap*'],
    sound: { pitch: 600, kind: 'chirp' }
  },

  /* ------------------------------------------------------------- new characters */

  redpanda: {
    id: 'redpanda',
    name: 'Red Panda',
    emoji: '🦝',
    breed: 'Himalayan Red Panda',
    description: 'Fluffy, rust-coloured and quietly graceful. Loves climbing, napping in the sun and bamboo.',
    kind: 'animal',
    personality: { playfulness: 0.6, laziness: 0.65, curiosity: 0.7, friendliness: 0.65, energy: 0.5, intelligence: 0.65, affection: 0.7, mischief: 0.5 },
    movement: { walkSpeed: 45, runSpeed: 150, jumpHeight: 75, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#c8582a', belly: '#3b2a24', accent: '#f6e9dc', ear: 'round', tail: 'ringed', snout: 'redpanda', mask: '#3b2a24', bodyWidth: 60, bodyHeight: 38 },
    behaviorBias: { SLEEPING: 1.4, EATING: 1.5, STRETCHING: 1.4, JUMPING: 1.3, GROOMING: 1.3, CURIOUS: 1.2 },
    favoriteFoods: ['bamboo', 'apple'],
    favoriteToys: ['ball', 'stick'],
    voice: ['*chirp*', '*huff*', '*stretches*', 'mrr'],
    sound: { pitch: 600, kind: 'chirp' }
  },
  deer: {
    id: 'deer',
    name: 'Deer',
    emoji: '🦌',
    breed: 'Spotted Fawn',
    description: 'Slender, calm and watchful. Moves like it is always walking through a quiet forest.',
    kind: 'animal',
    personality: { playfulness: 0.45, laziness: 0.4, curiosity: 0.7, friendliness: 0.55, energy: 0.65, intelligence: 0.6, affection: 0.6, mischief: 0.2 },
    movement: { walkSpeed: 50, runSpeed: 230, jumpHeight: 95, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#c9955a', belly: '#f4e6d2', accent: '#6b4a2d', ear: 'pointy', tail: 'short', snout: 'deer', bodyWidth: 54, bodyHeight: 30, legLength: 12, antlers: true, spots: true },
    behaviorBias: { LOOKING_AROUND: 1.8, WATCHING: 1.5, SCARED: 1.6, RUNNING: 1.2, JUMPING: 1.4, GROOMING: 0.6, DANCING: 0.4, ZOOMIES: 0.6 },
    favoriteFoods: ['apple', 'carrot'],
    favoriteToys: ['ball'],
    voice: ['*ear flick*', '*soft snort*', '*graceful step*', '...'],
    sound: { pitch: 700, kind: 'squeak' }
  },
  owl: {
    id: 'owl',
    name: 'Owl',
    emoji: '🦉',
    breed: 'Tawny Owl',
    description: 'Wise, wide-eyed and unbothered. Watches everything and is livelier at night.',
    kind: 'animal',
    personality: { playfulness: 0.35, laziness: 0.6, curiosity: 0.9, friendliness: 0.5, energy: 0.45, intelligence: 0.95, affection: 0.55, mischief: 0.3 },
    movement: { walkSpeed: 30, runSpeed: 120, jumpHeight: 55, gait: 'hop' },
    look: { archetype: 'upright', body: '#8a6543', belly: '#e9d4b3', accent: '#f0b030', ear: 'tuft', tail: 'none', snout: 'owl', wings: '#6e4d31', bodyWidth: 48, bodyHeight: 56 },
    behaviorBias: { WATCHING: 2.5, LOOKING_AROUND: 1.6, SLEEPING: 1.4, CURIOUS: 1.3, RUNNING: 0.5, ZOOMIES: 0.3, PLAYING: 0.6, BATHING: 0.8 },
    favoriteFoods: ['berries', 'nuts'],
    favoriteToys: ['feather'],
    voice: ['hoo', 'hoo-hoo', '*blink*', '*head turn*'],
    sound: { pitch: 300, kind: 'hoot' }
  },
  swan: {
    id: 'swan',
    name: 'Swan',
    emoji: '🦢',
    breed: 'Mute Swan',
    description: 'Serene and poised. Glides more than it walks, preens often, and does not do zoomies.',
    kind: 'animal',
    personality: { playfulness: 0.3, laziness: 0.55, curiosity: 0.5, friendliness: 0.5, energy: 0.4, intelligence: 0.6, affection: 0.6, mischief: 0.25 },
    movement: { walkSpeed: 35, runSpeed: 110, jumpHeight: 25, gait: 'waddle' },
    look: { archetype: 'upright', body: '#fbfbfb', belly: '#f1f1f4', accent: '#ef8a2a', ear: 'none', tail: 'none', snout: 'swan', wings: '#ffffff', mask: '#222', bodyWidth: 56, bodyHeight: 40 },
    behaviorBias: { GROOMING: 2.4, BATHING: 3, WATCHING: 1.3, STRETCHING: 1.4, RUNNING: 0.4, ZOOMIES: 0.1, JUMPING: 0.3, DANCING: 1.2 },
    favoriteFoods: ['seeds', 'berries'],
    favoriteToys: ['bubbles'],
    voice: ['*preens*', '*glides*', '*gentle honk*', '*ruffles*'],
    sound: { pitch: 350, kind: 'honk' }
  },
  unicorn: {
    id: 'unicorn',
    name: 'Unicorn',
    emoji: '🦄',
    breed: 'Pastel Unicorn',
    description: 'Sparkly, sweet and a little dramatic. Prances, dances and shows off its mane.',
    kind: 'animal',
    personality: { playfulness: 0.75, laziness: 0.3, curiosity: 0.6, friendliness: 0.85, energy: 0.75, intelligence: 0.65, affection: 0.9, mischief: 0.4 },
    movement: { walkSpeed: 55, runSpeed: 200, jumpHeight: 85, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#fbf6ff', belly: '#f3e8ff', accent: '#e9b6ff', ear: 'pointy', tail: 'flowing', snout: 'unicorn', bodyWidth: 60, bodyHeight: 36, legLength: 6, horn: true, mane: '#d8a7ff' },
    behaviorBias: { DANCING: 2.2, HAPPY: 1.6, JUMPING: 1.5, CELEBRATING: 1.6, GROOMING: 1.2, HIDING: 0.3, SAD: 0.7 },
    favoriteFoods: ['apple', 'cake'],
    favoriteToys: ['bubbles', 'ball'],
    voice: ['✨', '*sparkle*', '*prance*', 'neigh~', '*mane flip*'],
    sound: { pitch: 450, kind: 'neigh' }
  },
  dragon: {
    id: 'dragon',
    name: 'Dragon',
    emoji: '🐉',
    breed: 'Pocket Dragon',
    description: 'Small, proud and warm to the touch. Hoards shiny things and naps on them.',
    kind: 'animal',
    personality: { playfulness: 0.6, laziness: 0.45, curiosity: 0.7, friendliness: 0.5, energy: 0.65, intelligence: 0.8, affection: 0.55, mischief: 0.75 },
    movement: { walkSpeed: 45, runSpeed: 180, jumpHeight: 90, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#3fa38a', belly: '#c9f0d8', accent: '#1f5f52', ear: 'tuft', tail: 'spade', snout: 'dragon', bodyWidth: 62, bodyHeight: 38, wings: '#7ed3b8' },
    behaviorBias: { HIDING: 1.6, CELEBRATING: 1.3, JUMPING: 1.5, WATCHING: 1.2, BATHING: 0.3, EXCITED: 1.2, CURIOUS: 1.3 },
    favoriteFoods: ['fish', 'cake'],
    favoriteToys: ['kite', 'ball'],
    voice: ['*puff of smoke*', 'rawr', '*wing flutter*', '*hoards*', 'hrrm'],
    sound: { pitch: 120, kind: 'roar' }
  },
  hamster: {
    id: 'hamster',
    name: 'Hamster',
    emoji: '🐹',
    breed: 'Golden Hamster',
    description: 'Tiny, round and busy. Stuffs its cheeks, sprints in bursts and naps in a heap.',
    kind: 'animal',
    personality: { playfulness: 0.7, laziness: 0.5, curiosity: 0.8, friendliness: 0.7, energy: 0.8, intelligence: 0.45, affection: 0.65, mischief: 0.5 },
    movement: { walkSpeed: 70, runSpeed: 190, jumpHeight: 35, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#e8b880', belly: '#fff3e0', accent: '#c68a4a', ear: 'small', tail: 'stub', snout: 'hamster', bodyWidth: 54, bodyHeight: 44 },
    behaviorBias: { EATING: 2, ZOOMIES: 1.6, SLEEPING: 1.3, GROOMING: 1.4, RUNNING: 1.3, JUMPING: 0.6, BATHING: 0.2 },
    favoriteFoods: ['nuts', 'seeds'],
    favoriteToys: ['ball', 'yarn'],
    voice: ['*stuffs cheeks*', 'squeak!', '*nibble nibble*', '*zoom*'],
    sound: { pitch: 900, kind: 'squeak' }
  },
  duck: {
    id: 'duck',
    name: 'Duck',
    emoji: '🦆',
    breed: 'Yellow Duckling',
    description: 'Cheerful and a bit chaotic. Waddles, splashes, and quacks at nothing in particular.',
    kind: 'animal',
    personality: { playfulness: 0.75, laziness: 0.35, curiosity: 0.7, friendliness: 0.8, energy: 0.7, intelligence: 0.4, affection: 0.7, mischief: 0.6 },
    movement: { walkSpeed: 40, runSpeed: 130, jumpHeight: 30, gait: 'waddle' },
    look: { archetype: 'upright', body: '#f9d84a', belly: '#fff0a6', accent: '#f58a1f', ear: 'none', tail: 'none', snout: 'duck', wings: '#f2c531', bodyWidth: 46, bodyHeight: 46 },
    behaviorBias: { BATHING: 3.5, DANCING: 1.5, PLAYING: 1.3, EXCITED: 1.4, SCARED: 1.2, GROOMING: 1.1 },
    favoriteFoods: ['seeds', 'berries'],
    favoriteToys: ['bubbles', 'ball'],
    voice: ['quack!', 'quack quack', '*splash*', '*waddle waddle*'],
    sound: { pitch: 500, kind: 'quack' }
  },
  person: {
    id: 'person',
    name: 'Companion',
    emoji: '🧑',
    breed: 'Desk Buddy',
    description: 'A tiny person who keeps you company. Sips coffee, reads, dances a little and reminds you to take breaks.',
    kind: 'person',
    personality: { playfulness: 0.55, laziness: 0.35, curiosity: 0.7, friendliness: 0.9, energy: 0.6, intelligence: 0.85, affection: 0.75, mischief: 0.35 },
    movement: { walkSpeed: 50, runSpeed: 160, jumpHeight: 45, gait: 'trot' },
    look: { archetype: 'human', body: '#4f7cff', belly: '#4f7cff', accent: '#2e3a5c', ear: 'none', tail: 'none', snout: 'face', bodyWidth: 40, bodyHeight: 50, hair: 'short', hairColor: '#3a2a24', skin: '#f2c7a5', outfit: '#4f7cff', pants: '#2e3a5c', glasses: true },
    behaviorBias: { GROOMING: 0, BATHING: 0, DRINKING: 2.2, EATING: 1.2, WATCHING: 1.4, DANCING: 1.4, SITTING: 1.3, HIDING: 0.4, ZOOMIES: 0.3, CHASING: 0.4 },
    favoriteFoods: ['coffee', 'sandwich'],
    favoriteToys: ['book', 'kite'],
    voice: ['hey!', 'hmm...', '*sips coffee*', '*waves*', 'ooh', '*stretches*'],
    sound: { pitch: 330, kind: 'hum' }
  },

  /* ------------------------------------------------------------- wild canids & cats */

  lion: {
    id: 'lion',
    name: 'Lion',
    emoji: '🦁',
    breed: 'Savanna Lion',
    description: 'Majestic and deeply lazy. Sleeps most of the day, then stretches like it owns the place.',
    kind: 'animal',
    personality: { playfulness: 0.35, laziness: 0.9, curiosity: 0.45, friendliness: 0.5, energy: 0.4, intelligence: 0.6, affection: 0.55, mischief: 0.3 },
    movement: { walkSpeed: 40, runSpeed: 210, jumpHeight: 80, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#d9a45c', belly: '#f1d7a8', accent: '#7a4a22', ear: 'round', tail: 'tassel', snout: 'lion', bodyWidth: 66, bodyHeight: 40, legLength: 3, lionMane: '#9c5a24', iris: '#c99a3a' },
    behaviorBias: { SLEEPING: 2.1, STRETCHING: 1.6, GROOMING: 1.5, SITTING: 1.5, RUNNING: 0.6, ZOOMIES: 0.2, JUMPING: 0.6, CELEBRATING: 1.3, WATCHING: 1.3 },
    favoriteFoods: ['bone', 'fish'],
    favoriteToys: ['ball'],
    voice: ['*yawns hugely*', 'rrrr', '*regal stare*', '*flops*', 'ROAR'],
    sound: { pitch: 95, kind: 'roar' }
  },
  wolf: {
    id: 'wolf',
    name: 'Wolf',
    emoji: '🐺',
    breed: 'Grey Wolf',
    description: 'Watchful, loyal and a little wild. Patrols the screen, stares at the horizon, howls now and then.',
    kind: 'animal',
    personality: { playfulness: 0.45, laziness: 0.3, curiosity: 0.85, friendliness: 0.5, energy: 0.8, intelligence: 0.85, affection: 0.6, mischief: 0.4 },
    movement: { walkSpeed: 50, runSpeed: 230, jumpHeight: 80, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#8d949e', belly: '#e6e9ee', accent: '#4a5059', ear: 'pointy', tail: 'bushy', snout: 'wolf', bodyWidth: 62, bodyHeight: 36, legLength: 6, iris: '#e0b23a' },
    behaviorBias: { LOOKING_AROUND: 1.6, WATCHING: 1.6, RUNNING: 1.4, HIDING: 1.2, PLAYING: 0.7, GROOMING: 0.6, BATHING: 0.3, CHASING: 1.4 },
    favoriteFoods: ['bone', 'fish'],
    favoriteToys: ['stick', 'ball'],
    voice: ['*howls softly*', 'awooo', '*ears prick up*', '*sniffs the air*', 'grr?'],
    sound: { pitch: 260, kind: 'howl' }
  },

  /* ------------------------------------------------------------------ dog breeds */

  husky: {
    id: 'husky',
    name: 'Husky',
    emoji: '🐶',
    breed: 'Siberian Husky',
    description: 'Blue-eyed, dramatic and never tired. Zoomies, howling, and strong opinions about everything.',
    kind: 'animal',
    personality: { playfulness: 0.8, laziness: 0.15, curiosity: 0.7, friendliness: 0.75, energy: 0.95, intelligence: 0.6, affection: 0.7, mischief: 0.75 },
    movement: { walkSpeed: 60, runSpeed: 220, jumpHeight: 70, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#6f7681', belly: '#f4f5f7', accent: '#3d434c', ear: 'pointy', tail: 'bushy', snout: 'wolf', bodyWidth: 62, bodyHeight: 38, legLength: 4, iris: '#6fb7ff', faceMask: '#f4f5f7' },
    behaviorBias: { ZOOMIES: 2, RUNNING: 1.7, DANCING: 1.3, SLEEPING: 0.7, SITTING: 0.7, ANNOYED: 1.3, HIDING: 0.5 },
    favoriteFoods: ['bone', 'fish'],
    favoriteToys: ['ball', 'snowball'],
    voice: ['AWOOOO', '*dramatic sigh*', 'woo woo woo', '*zoomies*', 'nooo'],
    sound: { pitch: 300, kind: 'howl' }
  },
  corgi: {
    id: 'corgi',
    name: 'Corgi',
    emoji: '🐶',
    breed: 'Pembroke Welsh Corgi',
    description: 'Long body, tiny legs, enormous personality. Sploots, wiggles and hops after everything.',
    kind: 'animal',
    personality: { playfulness: 0.85, laziness: 0.35, curiosity: 0.6, friendliness: 0.9, energy: 0.7, intelligence: 0.65, affection: 0.85, mischief: 0.5 },
    movement: { walkSpeed: 50, runSpeed: 150, jumpHeight: 32, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#e39a4a', belly: '#fff2df', accent: '#b9702a', ear: 'pointy', tail: 'stub', snout: 'dog', bodyWidth: 70, bodyHeight: 36, legLength: -7, faceMask: '#fff2df' },
    behaviorBias: { PLAYING: 1.4, EXCITED: 1.5, JUMPING: 0.7, SITTING: 1.4, DANCING: 1.2, EATING: 1.3 },
    favoriteFoods: ['bone', 'treat'],
    favoriteToys: ['ball', 'stick'],
    voice: ['*sploot*', 'borf!', '*wiggle wiggle*', 'yip', '*tiny hop*'],
    sound: { pitch: 330, kind: 'bark' }
  },
  dalmatian: {
    id: 'dalmatian',
    name: 'Dalmatian',
    emoji: '🐶',
    breed: 'Dalmatian',
    description: 'Spotted, sleek and built to run. Sprints for the joy of it and grins the whole time.',
    kind: 'animal',
    personality: { playfulness: 0.8, laziness: 0.2, curiosity: 0.7, friendliness: 0.8, energy: 0.9, intelligence: 0.6, affection: 0.75, mischief: 0.45 },
    movement: { walkSpeed: 60, runSpeed: 215, jumpHeight: 75, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#f7f7f5', belly: '#ffffff', accent: '#1f1f24', ear: 'floppy', tail: 'thin', snout: 'dog', bodyWidth: 64, bodyHeight: 36, legLength: 6, spots: true, spotColor: '#1f1f24' },
    behaviorBias: { RUNNING: 1.7, ZOOMIES: 1.5, PLAYING: 1.3, JUMPING: 1.3, SLEEPING: 0.8 },
    favoriteFoods: ['bone', 'treat'],
    favoriteToys: ['ball', 'kite'],
    voice: ['woof!', '*sprints*', 'arf arf', '*happy pant*'],
    sound: { pitch: 250, kind: 'bark' }
  },
  pug: {
    id: 'pug',
    name: 'Pug',
    emoji: '🐶',
    breed: 'Pug',
    description: 'Round, snorty and devoted. Sleeps, snacks, sits on your feet, repeat.',
    kind: 'animal',
    personality: { playfulness: 0.5, laziness: 0.75, curiosity: 0.5, friendliness: 0.9, energy: 0.3, intelligence: 0.4, affection: 0.95, mischief: 0.35 },
    movement: { walkSpeed: 40, runSpeed: 115, jumpHeight: 22, gait: 'waddle' },
    look: { archetype: 'quadruped', body: '#dcbf95', belly: '#f3e6d0', accent: '#3a2e28', ear: 'small', tail: 'curly', snout: 'pug', mask: '#3a2e28', bodyWidth: 56, bodyHeight: 40, legLength: -3 },
    behaviorBias: { SLEEPING: 1.7, EATING: 1.8, SITTING: 1.5, RUNNING: 0.5, ZOOMIES: 0.4, JUMPING: 0.4, HAPPY: 1.3, TIRED: 1.4 },
    favoriteFoods: ['treat', 'cake'],
    favoriteToys: ['ball'],
    voice: ['*snort*', '*snuffle*', 'hrmph', '*heavy sigh*', '*snore*'],
    sound: { pitch: 170, kind: 'grunt' }
  },
  dachshund: {
    id: 'dachshund',
    name: 'Dachshund',
    emoji: '🐶',
    breed: 'Miniature Dachshund',
    description: 'A very long dog with a nose for everything. Investigates, digs and burrows under blankets.',
    kind: 'animal',
    personality: { playfulness: 0.65, laziness: 0.4, curiosity: 0.9, friendliness: 0.75, energy: 0.6, intelligence: 0.6, affection: 0.8, mischief: 0.55 },
    movement: { walkSpeed: 45, runSpeed: 140, jumpHeight: 26, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#8a4e2a', belly: '#c9905a', accent: '#5a2f16', ear: 'floppy', tail: 'thin', snout: 'dog', bodyWidth: 82, bodyHeight: 30, legLength: -8, earColor: '#5a2f16' },
    behaviorBias: { LOOKING_AROUND: 1.5, CURIOUS: 1.5, HIDING: 1.3, JUMPING: 0.4, EATING: 1.2 },
    favoriteFoods: ['bone', 'treat'],
    favoriteToys: ['stick', 'ball'],
    voice: ['*sniff sniff sniff*', 'bork', '*burrows*', 'hm?', '*wags whole body*'],
    sound: { pitch: 310, kind: 'bark' }
  },
  shiba: {
    id: 'shiba',
    name: 'Shiba Inu',
    emoji: '🐶',
    breed: 'Shiba Inu',
    description: 'Fox-like, fastidious and very much its own dog. Affection on its terms, side-eye on yours.',
    kind: 'animal',
    personality: { playfulness: 0.55, laziness: 0.45, curiosity: 0.7, friendliness: 0.45, energy: 0.65, intelligence: 0.7, affection: 0.45, mischief: 0.8 },
    movement: { walkSpeed: 50, runSpeed: 190, jumpHeight: 70, gait: 'prowl' },
    look: { archetype: 'quadruped', body: '#e8944a', belly: '#fff4e6', accent: '#b8642a', ear: 'pointy', tail: 'curly', snout: 'dog', bodyWidth: 58, bodyHeight: 36, faceMask: '#fff4e6' },
    behaviorBias: { ANNOYED: 1.6, GROOMING: 1.5, HIDING: 1.3, WATCHING: 1.3, EXCITED: 0.7, SITTING: 1.2 },
    favoriteFoods: ['fish', 'treat'],
    favoriteToys: ['ball', 'yarn'],
    voice: ['*side-eye*', 'hmph', '*shiba scream*', '...', '*ignores you*'],
    sound: { pitch: 380, kind: 'bark' }
  },
  collie: {
    id: 'collie',
    name: 'Border Collie',
    emoji: '🐶',
    breed: 'Border Collie',
    description: 'The genius of the dog world. Watches, herds your cursor, and needs a job at all times.',
    kind: 'animal',
    personality: { playfulness: 0.8, laziness: 0.1, curiosity: 0.85, friendliness: 0.8, energy: 0.95, intelligence: 0.98, affection: 0.8, mischief: 0.4 },
    movement: { walkSpeed: 60, runSpeed: 225, jumpHeight: 85, gait: 'trot' },
    look: { archetype: 'quadruped', body: '#2b2b30', belly: '#f7f7f7', accent: '#f7f7f7', ear: 'floppy', tail: 'bushy', snout: 'dog', bodyWidth: 62, bodyHeight: 36, legLength: 5, earColor: '#2b2b30', faceMask: '#f7f7f7' },
    behaviorBias: { CHASING: 2, WATCHING: 1.6, CURIOUS: 1.5, RUNNING: 1.5, PLAYING: 1.3, SLEEPING: 0.7, SITTING: 0.8 },
    favoriteFoods: ['bone', 'treat'],
    favoriteToys: ['kite', 'ball'],
    voice: ['*intense stare*', '*herds you*', 'what now? what now?', 'woof', '*crouches*'],
    sound: { pitch: 240, kind: 'bark' }
  }
}

export const SPECIES_LIST: SpeciesDefinition[] = Object.values(SPECIES)

export const DEFAULT_NAMES: Record<string, string[]> = {
  dog: ['Max', 'Biscuit', 'Luna', 'Cooper'],
  cat: ['Mochi', 'Nala', 'Pixel', 'Sesame'],
  rabbit: ['Clover', 'Thumper', 'Hazel', 'Pip'],
  fox: ['Rusty', 'Ember', 'Finn', 'Sage'],
  panda: ['Bao', 'Pudding', 'Momo', 'Tofu'],
  penguin: ['Pebble', 'Waddles', 'Tux', 'Skipper'],
  redpanda: ['Maple', 'Juniper', 'Cinnamon', 'Rue'],
  deer: ['Fawn', 'Willow', 'Bramble', 'Aster'],
  owl: ['Athena', 'Merlin', 'Olive', 'Hoot'],
  swan: ['Odette', 'Pearl', 'Cygnus', 'Ivory'],
  unicorn: ['Stella', 'Aurora', 'Nova', 'Sprinkle'],
  dragon: ['Blaze', 'Onyx', 'Saffron', 'Zephyr'],
  hamster: ['Peanut', 'Nibbles', 'Poppy', 'Chip'],
  duck: ['Puddles', 'Quackers', 'Dot', 'Mallory'],
  person: ['Sam', 'Alex', 'Riley', 'Jo'],
  lion: ['Leo', 'Zuri', 'Aslan', 'Kiara'],
  wolf: ['Ghost', 'Ash', 'Storm', 'Kira'],
  husky: ['Koda', 'Mishka', 'Sky', 'Balto'],
  corgi: ['Waffles', 'Ein', 'Butter', 'Pancake'],
  dalmatian: ['Pongo', 'Dottie', 'Domino', 'Pepper'],
  pug: ['Doug', 'Gizmo', 'Bean', 'Winston'],
  dachshund: ['Oscar', 'Noodle', 'Slinky', 'Pretzel'],
  shiba: ['Kabosu', 'Yuki', 'Hachi', 'Maru'],
  collie: ['Bandit', 'Jess', 'Scout', 'Fly']
}
