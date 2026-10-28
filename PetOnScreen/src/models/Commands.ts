import type { BehaviorState, MovementMode } from './Behavior'

/**
 * Commands a pet can be taught, by voice or by typing them into the talk bubble.
 * The pet does not obey because the command exists: it obeys with a probability that grows as the
 * command is trained (see engine/TrainingEngine).
 */
export type CommandId = 'sit' | 'stay' | 'come' | 'speak' | 'jump' | 'dance' | 'sleep' | 'fetch' | 'play'

export interface CommandDefinition {
  id: CommandId
  label: string
  emoji: string
  /** Ways people say it. Each is matched as the whole utterance after the pet's name and filler words are removed. */
  phrases: string[]
  /** What obeying looks like. */
  state: BehaviorState
  movement: MovementMode
  duration: [number, number]
  /** Needs energy: lazy or tired pets resist these more. */
  active: boolean
  /** Said while obeying (the species voice is mixed in). */
  obeySpeech: string[]
}

export const COMMANDS: Record<CommandId, CommandDefinition> = {
  sit: { id: 'sit', label: 'Sit', emoji: '🪑', phrases: ['sit', 'sit down', 'take a seat', 'sit sit'], state: 'SITTING', movement: 'none', duration: [4, 7], active: false, obeySpeech: ['*sits*', 'like this?', '*sits politely*'] },
  stay: { id: 'stay', label: 'Stay', emoji: '✋', phrases: ['stay', 'wait', 'stay there', 'stay put', 'hold on', 'freeze', 'stop there'], state: 'IDLE', movement: 'none', duration: [6, 9], active: false, obeySpeech: ['*stays*', '*does not move*', '...'] },
  come: { id: 'come', label: 'Come', emoji: '🏃', phrases: ['come', 'come here', 'come on', 'here', 'over here', 'come to me', 'heel', 'come come'], state: 'RUNNING', movement: 'toCursor', duration: [3.5, 5], active: true, obeySpeech: ['coming!', 'here I come', '*trots over*'] },
  speak: { id: 'speak', label: 'Speak', emoji: '🗣️', phrases: ['speak', 'talk', 'say something', 'bark', 'meow', 'sing', 'make a sound', 'woof'], state: 'HAPPY', movement: 'none', duration: [1.5, 2.5], active: false, obeySpeech: [] },
  jump: { id: 'jump', label: 'Jump', emoji: '⬆️', phrases: ['jump', 'hop', 'up', 'jump up', 'bounce', 'jump jump'], state: 'JUMPING', movement: 'none', duration: [0.9, 0.9], active: true, obeySpeech: ['boing!', '*hop*', 'wheee'] },
  dance: { id: 'dance', label: 'Dance', emoji: '💃', phrases: ['dance', 'boogie', 'shake it', 'dance dance', 'show me your moves'], state: 'DANCING', movement: 'none', duration: [4, 6], active: true, obeySpeech: ['*dances*', '🎶', '*wiggle wiggle*'] },
  sleep: { id: 'sleep', label: 'Sleep', emoji: '😴', phrases: ['sleep', 'go to sleep', 'bed', 'go to bed', 'nap', 'nap time', 'lie down', 'lay down', 'rest', 'bedtime'], state: 'SLEEPING', movement: 'none', duration: [25, 45], active: false, obeySpeech: ['*yawn* okay', 'zzz...', '*curls up*'] },
  fetch: { id: 'fetch', label: 'Fetch', emoji: '🎾', phrases: ['fetch', 'go fetch', 'get the ball', 'ball', 'get it', 'play fetch', 'fetch the ball'], state: 'EXCITED', movement: 'none', duration: [1.2, 1.6], active: true, obeySpeech: ['ball?! BALL!', 'throw it throw it', '*eyes widen*'] },
  play: { id: 'play', label: 'Play', emoji: '🎉', phrases: ['play', 'go play', 'playtime', 'play time', 'play with me'], state: 'PLAYING', movement: 'none', duration: [5, 8], active: true, obeySpeech: ['yes! play!', 'wheee!', '*zoom*'] }
}

export const COMMAND_IDS: CommandId[] = ['sit', 'stay', 'come', 'speak', 'jump', 'dance', 'sleep', 'fetch', 'play']

/* ------------------------------------------------------------------ training state */

export interface CommandSkill {
  /** 0..100: how well the pet knows the command. Drives the chance it obeys. */
  level: number
  /** times the command was given */
  heard: number
  /** times the pet obeyed */
  obeyed: number
  lastAt: number | null
}

/**
 * What the pet knows about its owner's voice: a running mean/variance of voice embeddings
 * (see services/Voiceprint). It is built from the utterances that were followed by a treat, so
 * whoever hands out the treats is the owner.
 */
export interface OwnerVoice {
  /** number of enrolled utterances */
  n: number
  mean: number[]
  /** sum of squared deviations per dimension (Welford) */
  m2: number[]
}

/** Who gave a command: the owner, somebody else, or nobody knows yet (typed input counts as the owner). */
export type Speaker = 'owner' | 'stranger' | 'unknown'

export interface TrainingState {
  commands: Partial<Record<CommandId, CommandSkill>>
  /** the most recent command the pet obeyed; praise or a treat shortly after reinforces it */
  lastObeyed: { id: CommandId; at: number } | null
  /** the most recent command the pet ignored; a scold shortly after teaches the boundary */
  lastRefused: { id: CommandId; at: number } | null
  /** total commands ever given */
  total: number
  /** treats handed out as rewards */
  treats: number
  /** the owner's voiceprint, or null before the first treat-rewarded voice command */
  owner: OwnerVoice | null
}

export function createTraining(): TrainingState {
  return { commands: {}, lastObeyed: null, lastRefused: null, total: 0, treats: 0, owner: null }
}

export function skillOf(training: TrainingState, id: CommandId): CommandSkill {
  return training.commands[id] ?? { level: 0, heard: 0, obeyed: 0, lastAt: null }
}

export type SkillLabel = 'new' | 'learning' | 'knows it' | 'mastered'

export function skillLabel(level: number): SkillLabel {
  if (level < 5) return 'new'
  if (level < 35) return 'learning'
  if (level < 75) return 'knows it'
  return 'mastered'
}

export const LEARNING_LEVEL = 35
export const MASTERED_LEVEL = 75

/** Validation for training data loaded from disk. Unknown commands and bad numbers are dropped. */
export function normalizeTraining(raw: unknown): TrainingState {
  const out = createTraining()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Partial<TrainingState>
  if (r.commands && typeof r.commands === 'object') {
    for (const id of COMMAND_IDS) {
      const s = r.commands[id]
      if (!s || typeof s !== 'object') continue
      const level = Number(s.level)
      out.commands[id] = {
        level: Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : 0,
        heard: Math.max(0, Math.floor(Number(s.heard) || 0)),
        obeyed: Math.max(0, Math.floor(Number(s.obeyed) || 0)),
        lastAt: typeof s.lastAt === 'number' ? s.lastAt : null
      }
    }
  }
  const ref = (v: unknown): { id: CommandId; at: number } | null => {
    const x = v as { id?: unknown; at?: unknown } | null
    return x && typeof x === 'object' && typeof x.id === 'string' && COMMAND_IDS.includes(x.id as CommandId) && typeof x.at === 'number' ? { id: x.id as CommandId, at: x.at } : null
  }
  out.lastObeyed = ref(r.lastObeyed)
  out.lastRefused = ref(r.lastRefused)
  out.total = Math.max(0, Math.floor(Number(r.total) || 0))
  out.treats = Math.max(0, Math.floor(Number(r.treats) || 0))
  out.owner = normalizeOwnerVoice(r.owner)
  return out
}

function normalizeOwnerVoice(raw: unknown): OwnerVoice | null {
  const o = raw as Partial<OwnerVoice> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.mean) || !Array.isArray(o.m2)) return null
  const n = Math.floor(Number(o.n) || 0)
  if (n <= 0 || o.mean.length === 0 || o.mean.length !== o.m2.length) return null
  const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
  if (!o.mean.every(finite) || !o.m2.every(finite)) return null
  return { n, mean: [...o.mean], m2: o.m2.map((v) => Math.max(0, v)) }
}

/* ------------------------------------------------------------------ parsing */

export type UtteranceKind = 'command' | 'praise' | 'scold' | 'treat' | 'none'

export interface ParsedUtterance {
  kind: UtteranceKind
  id?: CommandId
  /** the utterance after normalization, for showing "heard: ..." */
  text: string
}

/** Words that carry no meaning in a command: "sit down please" and "sit down" are the same. */
const FILLERS = new Set(['please', 'now', 'hey', 'okay', 'ok', 'buddy', 'boy', 'girl', 'right', 'then', 'and', 'a', 'the', 'to', 'me', 'you', 'can', 'go', 'lets', 'let', 's', 'oh', 'um', 'uh'])

const PRAISE = /^(good (boy|girl|dog|cat|pet|job|pup|puppy|one)|well done|yes|yes yes|nice|nice one|bravo|great|good|very good|attaboy|attagirl|yay|perfect|clever (boy|girl))$/
const SCOLD = /^(no|no no|bad|bad (boy|girl|dog|cat|pet)|stop|stop it|stop that|naughty|enough|hey|don t|do not)$/
const TREAT = /^(treat|treats|treat time|here is a treat|cookie|snack|want a treat|who wants a treat)$/

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function stripName(words: string[], petName: string): string[] {
  const name = new Set(tokens(petName))
  return name.size ? words.filter((w) => !name.has(w)) : words
}

function stripFillers(words: string[]): string[] {
  return words.filter((w) => !FILLERS.has(w))
}

const PHRASE_INDEX: { key: string; id: CommandId }[] = []
for (const id of COMMAND_IDS) {
  for (const p of COMMANDS[id].phrases) {
    const key = stripFillers(tokens(p)).join(' ')
    if (key && !PHRASE_INDEX.some((e) => e.key === key)) PHRASE_INDEX.push({ key, id })
  }
}

/**
 * Turns what the pet heard (or what was typed) into a command, praise, a scold, a treat offer, or
 * nothing. Matching is deliberately strict: "sit", "Max, sit!" and "sit down please" are the sit
 * command; "do you want to sit with me?" is conversation and is left alone.
 */
export function parseUtterance(raw: string, petName = ''): ParsedUtterance {
  const words = stripName(tokens(raw), petName)
  const plain = words.join(' ')
  if (!plain) return { kind: 'none', text: '' }
  if (PRAISE.test(plain)) return { kind: 'praise', text: plain }
  if (SCOLD.test(plain)) return { kind: 'scold', text: plain }
  if (TREAT.test(plain)) return { kind: 'treat', text: plain }
  const key = stripFillers(words).join(' ')
  if (key) {
    const hit = PHRASE_INDEX.find((e) => e.key === key)
    if (hit) return { kind: 'command', id: hit.id, text: plain }
  }
  // "good boy" with the pet's name in the middle, or praise after a filler, still counts.
  if (key && PRAISE.test(key)) return { kind: 'praise', text: plain }
  if (key && SCOLD.test(key)) return { kind: 'scold', text: plain }
  if (key && TREAT.test(key)) return { kind: 'treat', text: plain }
  return { kind: 'none', text: plain }
}
