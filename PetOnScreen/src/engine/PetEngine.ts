import {
  ANIMATION_FOR_STATE,
  BEHAVIOR_BY_STATE,
  type AnimationName,
  type BehaviorDefinition,
  type BehaviorState,
  type DecisionContext,
  type MovementMode
} from '@models/Behavior'
import { applyDrift, applyOfflineTime, clampStat, levelForExperience, moodFor, type Mood, type PetStats } from '@models/PetStats'
import { recordInteraction, rememberEvent, type InteractionType } from '@models/Memory'
import { addItem, hasItem, ITEMS, removeItem } from '@models/Items'
import { SPECIES, type SpeciesDefinition } from '@models/Species'
import { ageInDays, type PetSave } from '@models/Pet'
import { createRng, type Rng } from './rng'
import { BehaviorEngine } from './BehaviorEngine'
import { MovementEngine, type Point } from './MovementEngine'
import { PersonalityEngine } from './PersonalityEngine'
import { EventEngine, type EventFx, type TriggeredEvent } from './EventEngine'
import { InteractionEngine, type InteractionContext, type Reaction } from './InteractionEngine'
import { PlayEngine, type PlayDirective, type PlayEvent, type PlaySnapshot } from './PlayEngine'

export interface EngineEnvironment {
  width: number
  height: number
  freeRoam: boolean
  scale: number
  breakReminderMinutes: number
  ownerName: string
}

export type SoundName = 'voice' | 'happy' | 'eat' | 'sleep' | 'jump' | 'land' | 'notify' | 'annoyed' | 'step'

export type EngineEvent =
  | { type: 'sound'; name: SoundName }
  | { type: 'levelUp'; level: number }
  | { type: 'itemFound'; itemId: string; gift: boolean }
  | { type: 'save' }
  | { type: 'notify'; text: string }

export interface PetSnapshot {
  x: number
  y: number
  facing: 1 | -1
  state: BehaviorState
  animation: AnimationName
  animationKey: number
  moving: boolean
  speed: number
  airborne: boolean
  lookAt: { dx: number; dy: number } | null
  faceViewer: boolean
  speech: string | null
  speechKey: number
  fx: EventFx
  fxKey: number
  mood: Mood
  stats: PetStats
  level: number
  ageDays: number
  hidden: boolean
  heldItem: string | null
  name: string
  speciesId: string
  gait: SpeciesDefinition['movement']['gait']
  /** active mini-game, if any */
  play: PlaySnapshot | null
}

interface Activity {
  state: BehaviorState
  animation: AnimationName
  movement: MovementMode
  startedAt: number
  endsAt: number
  source: 'behavior' | 'event' | 'reaction' | 'system' | 'play'
  effects?: Partial<PetStats>
  onComplete?: Partial<PetStats>
  faceViewer: boolean
  item: string | null
  gift: boolean
  eventId?: string
}

/** Base sprite footprint at scale 1 (matches the SVG viewBox in PetSprite). */
export const SPRITE_WIDTH = 120
export const SPRITE_HEIGHT = 110

const HOVER_REACTION_INTERVAL = 8
const PERSONALITY_EVOLVE_INTERVAL = 600
const AUTOSAVE_INTERVAL = 10

/**
 * PetEngine is the pet's brain and body in one object. It owns the mutable pet state,
 * advances time, decides what to do next and produces a render-agnostic snapshot.
 * Nothing in here touches the DOM or Electron.
 */
export class PetEngine {
  pet: PetSave
  species: SpeciesDefinition
  readonly rng: Rng
  private env: EngineEnvironment
  private movement: MovementEngine
  private behavior: BehaviorEngine
  private personality = new PersonalityEngine()
  private events = new EventEngine()
  private interaction = new InteractionEngine()
  private games: PlayEngine

  private activity: Activity
  private previousState: BehaviorState = 'IDLE'
  private lastTickMs: number | null = null
  private t = 0
  private paused = false

  private cursor: Point | null = null
  private lastCursorMoveT = -Infinity
  private hovering = false
  private lastHoverReactionT = -Infinity
  private idleSeconds = 0
  private activeSeconds = 0
  private lastBreakReminderT = -Infinity
  private lastEvolveT = 0
  private lastSaveT = 0
  private dragging = false
  private dragStartY = 0
  private pendingDrop = false
  private level: number

  private speech: string | null = null
  private speechUntil = 0
  private speechKey = 0
  private fx: EventFx = null
  private fxKey = 0
  private animationKey = 0

  private listeners = new Set<(e: EngineEvent) => void>()

  constructor(pet: PetSave, env: EngineEnvironment, position: Point | null, rng: Rng = createRng(), nowMs = Date.now()) {
    this.pet = { ...pet, stats: { ...pet.stats }, memory: { ...pet.memory }, inventory: { ...pet.inventory } }
    this.species = SPECIES[pet.speciesId]
    if (!this.species) throw new Error(`Unknown species ${pet.speciesId}`)
    this.rng = rng
    this.env = env
    this.games = new PlayEngine(rng)
    this.movement = new MovementEngine(this.species.movement)
    this.behavior = new BehaviorEngine(this.personality)
    this.level = levelForExperience(this.pet.stats.experience)
    this.t = nowMs / 1000

    // Time passed while the app was closed.
    const elapsed = (nowMs - (pet.lastSeenAt || nowMs)) / 1000
    if (elapsed > 60) this.pet.stats = applyOfflineTime(this.pet.stats, elapsed)

    this.applyBounds()
    if (position) this.movement.place(position.x, position.y)
    else this.movement.place(env.width * 0.5, this.movement.floorY())
    if (!env.freeRoam) this.movement.place(this.movement.x, this.movement.floorY())

    this.activity = this.makeActivity('LOOKING_AROUND', 'none', 3, 'system')
    if (elapsed > 1800) {
      this.say(this.rng.pick(['*stretches* oh, hello!', "you're back!", 'hi again 🐾', '*yawn* morning?']))
    }
  }

  /* ------------------------------------------------------------------ events */

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e)
  }

  /* ------------------------------------------------------------ environment */

  setEnvironment(patch: Partial<EngineEnvironment>): void {
    const freeRoamChanged = patch.freeRoam !== undefined && patch.freeRoam !== this.env.freeRoam
    this.env = { ...this.env, ...patch }
    this.applyBounds()
    if (freeRoamChanged && !this.env.freeRoam && !this.movement.isOnFloor()) {
      this.movement.drop()
      this.startActivity(this.makeActivity('FALLING', 'none', 5, 'system'))
    }
  }

  private applyBounds(): void {
    this.movement.setBounds({
      width: this.env.width,
      height: this.env.height,
      halfWidth: (SPRITE_WIDTH / 2) * this.env.scale * 0.7,
      petHeight: SPRITE_HEIGHT * this.env.scale,
      freeRoam: this.env.freeRoam
    })
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) this.lastTickMs = null
  }

  /** Cursor position relative to the pet window, or null when it is on another display. */
  setCursor(cursor: Point | null): void {
    if (cursor && this.cursor && (Math.abs(cursor.x - this.cursor.x) > 2 || Math.abs(cursor.y - this.cursor.y) > 2)) {
      this.lastCursorMoveT = this.t
    } else if (cursor && !this.cursor) this.lastCursorMoveT = this.t
    this.cursor = cursor
  }

  setUserActivity(idleSeconds: number, activeSeconds: number, returned: boolean): void {
    this.idleSeconds = idleSeconds
    this.activeSeconds = activeSeconds
    if (returned) this.onUserReturned()
  }

  /* ------------------------------------------------------------------ input */

  hoverEnter(): void {
    this.hovering = true
    if (this.dragging || this.paused) return
    if (this.t - this.lastHoverReactionT < HOVER_REACTION_INTERVAL) return
    if (this.activity.source !== 'behavior') return
    if (!['IDLE', 'SITTING', 'LOOKING_AROUND', 'WALKING', 'GROOMING'].includes(this.activity.state)) return
    const reaction = this.interaction.hover(this.interactionContext(), this.rng)
    if (reaction) {
      this.lastHoverReactionT = this.t
      this.applyReaction(reaction)
    }
  }

  hoverLeave(): void {
    this.hovering = false
  }

  click(): void {
    if (this.dragging || this.paused) return
    const nowSec = this.t
    const reaction = this.interaction.click(this.interactionContext(), nowSec, this.rng)
    const streak = this.interaction.clickStreak(nowSec)
    this.pet.memory = recordInteraction(this.pet.memory, 'click', Date.now())
    if (streak > this.pet.memory.clickStreakRecord) this.pet.memory.clickStreakRecord = streak
    this.emit({ type: 'sound', name: reaction.state === 'ANNOYED' ? 'annoyed' : reaction.state === 'JUMPING' ? 'jump' : 'voice' })
    this.applyReaction(reaction)
  }

  petIt(): void {
    this.interact('pet', this.interaction.pet(this.interactionContext(), this.rng))
    this.emit({ type: 'sound', name: 'happy' })
  }

  feed(foodId = 'kibble'): boolean {
    if (!hasItem(this.pet.inventory, foodId)) return false
    const reaction = this.interaction.feed(this.interactionContext(), foodId, this.rng)
    if (reaction.state === 'EATING') {
      this.pet.inventory = removeItem(this.pet.inventory, foodId)
      this.pet.memory.foodCounts = { ...this.pet.memory.foodCounts, [foodId]: (this.pet.memory.foodCounts[foodId] ?? 0) + 1 }
      this.emit({ type: 'sound', name: 'eat' })
    }
    this.interact('feed', reaction)
    return true
  }

  play(): void {
    const reaction = this.interaction.play(this.interactionContext(), this.rng)
    if (reaction.state === 'PLAYING') {
      this.pet.memory.gamesPlayed++
      this.emit({ type: 'sound', name: 'happy' })
    }
    this.interact('play', reaction)
  }

  giveToy(toyId: string): boolean {
    if (!hasItem(this.pet.inventory, toyId)) return false
    this.interact('toy', this.interaction.toy(this.interactionContext(), toyId, this.rng))
    this.emit({ type: 'sound', name: 'happy' })
    return true
  }

  /** The user said something. The reply itself comes from the conversation service via say(). */
  talk(): void {
    this.interact('talk', this.interaction.talk(this.interactionContext()))
  }

  rename(name: string): void {
    const clean = name.trim().slice(0, 24)
    if (!clean) return
    this.pet.name = clean
    this.pet.memory = rememberEvent(this.pet.memory, 'rename', `Got the name ${clean}`, Date.now())
    this.say(this.rng.pick([`${clean}! I like it`, `I'm ${clean} now!`, `${clean}... ${clean}. yes.`]))
    this.emit({ type: 'save' })
  }

  setOwnerName(name: string): void {
    this.env.ownerName = name.trim()
    if (this.env.ownerName && !this.pet.memory.knowsOwner) {
      this.pet.memory.knowsOwner = true
      this.pet.memory = rememberEvent(this.pet.memory, 'owner', `Learned the owner's name: ${this.env.ownerName}`, Date.now())
      this.say(`${this.env.ownerName}! nice to meet you 🐾`)
    }
    this.emit({ type: 'save' })
  }

  useItem(itemId: string): boolean {
    const def = ITEMS[itemId]
    if (!def) return false
    if (def.kind === 'food') return this.feed(itemId)
    if (def.kind === 'toy') return this.giveToy(itemId)
    // treasures: the pet shows it off
    this.applyReaction({ state: 'HAPPY', movement: 'none', duration: 3, speech: `my ${def.name.toLowerCase()}!`, fx: 'sparkle', stats: { happiness: 2 } })
    return true
  }

  /* ------------------------------------------------------------- mini-games */

  get playMode(): PlaySnapshot['mode'] {
    return this.games.mode
  }

  startFetch(): void {
    if (this.paused) return
    this.games.startFetch(this.cursor, { x: this.movement.x, y: this.movement.y }, this.env.scale)
    this.say(this.rng.pick(['ball?! BALL!', 'ooh, the ball!', '*eyes widen*', 'throw it throw it']))
    this.emit({ type: 'sound', name: 'voice' })
    this.pet.memory = rememberEvent(this.pet.memory, 'play', 'Played fetch', Date.now())
    this.applyPlayDirective({ state: 'WATCHING', target: null, speed: 0, faceX: this.cursor?.x ?? null, jump: false, skidDx: 0, events: [] })
  }

  startTug(): void {
    if (this.paused) return
    this.games.startTug({ x: this.movement.x, y: this.movement.y, facing: this.movement.facing }, this.movement.floorY(), this.env.scale)
    this.say(this.rng.pick(['tug of war? you are on.', '*grabs rope* grrr', 'I will not lose.', '*plants paws*']))
    this.emit({ type: 'sound', name: 'voice' })
    this.pet.memory = rememberEvent(this.pet.memory, 'play', 'Played tug of war', Date.now())
    this.applyPlayDirective({ state: 'TUGGING', target: null, speed: 0, faceX: null, jump: false, skidDx: 0, events: [] })
  }

  stopPlay(): void {
    if (this.games.mode === 'none') return
    this.games.stop()
    if (this.activity.source === 'play') {
      this.behavior.markEnded(this.activity.state, this.t)
      this.movement.stop()
      if (this.rng.chance(0.7)) this.say(this.rng.pick(['that was fun!', '*pant pant*', 'again later?', 'good game']))
      this.decideNext()
    }
    this.emit({ type: 'save' })
  }

  /** Game timing uses the engine clock; flick velocity uses a live clock because pointer events arrive between ticks. */
  playPointerDown(x: number, y: number, nowMs = Date.now()): boolean {
    return this.games.pointerDown({ x, y }, this.t, nowMs / 1000)
  }

  playPointerMove(x: number, y: number, nowMs = Date.now()): void {
    this.games.pointerMove({ x, y }, this.t, nowMs / 1000)
  }

  playPointerUp(x: number, y: number, nowMs = Date.now()): void {
    this.games.pointerUp({ x, y }, this.t, nowMs / 1000)
  }

  /** Where a carried object attaches, per body archetype. */
  private mouthPoint(): Point {
    const s = this.env.scale
    const f = this.movement.facing
    switch (this.species.look.archetype) {
      case 'upright':
        return { x: this.movement.x + f * 22 * s, y: this.movement.y - 62 * s }
      case 'human':
        return { x: this.movement.x + f * 22 * s, y: this.movement.y - 30 * s }
      default:
        return { x: this.movement.x + f * 32 * s, y: this.movement.y - 50 * s }
    }
  }

  private updatePlay(dt: number): void {
    const d = this.games.update({
      dt,
      t: this.t,
      cursor: this.cursor,
      pet: { x: this.movement.x, y: this.movement.y, facing: this.movement.facing, airborne: this.movement.airborne },
      mouth: this.mouthPoint(),
      width: this.env.width,
      height: this.env.height,
      floorY: this.movement.floorY(),
      freeRoam: this.env.freeRoam,
      scale: this.env.scale,
      personality: this.pet.personality,
      stats: this.pet.stats,
      runSpeed: this.species.movement.runSpeed,
      walkSpeed: this.species.movement.walkSpeed,
      jumpHeight: this.species.movement.jumpHeight
    })
    const events = [...this.games.pendingEvents.splice(0), ...d.events]
    this.applyPlayDirective(d)
    for (const e of events) this.handlePlayEvent(e)
  }

  private applyPlayDirective(d: PlayDirective): void {
    if (d.state && (this.activity.state !== d.state || this.activity.source !== 'play')) {
      const act = this.makeActivity(d.state, 'toPoint', Infinity, 'play')
      this.startActivity(act)
    }
    if (this.activity.source === 'play') this.movement.setPointTarget(d.target, d.speed)
    if (d.faceX !== null) this.movement.faceToward(d.faceX)
    if (d.jump) {
      this.movement.jump(this.rng, 1)
      this.emit({ type: 'sound', name: 'jump' })
    }
    if (d.skidDx) this.movement.nudge(d.skidDx)
  }

  private handlePlayEvent(e: PlayEvent): void {
    switch (e.type) {
      case 'speech':
        this.say(e.text)
        break
      case 'sound':
        this.emit({ type: 'sound', name: e.name })
        break
      case 'stats':
        this.pet.stats = this.applyStatDelta(this.pet.stats, e.delta)
        this.checkLevel()
        break
      case 'game':
        this.pet.memory.gamesPlayed++
        this.pet.memory = recordInteraction(this.pet.memory, 'play', Date.now())
        this.emit({ type: 'save' })
        break
      case 'round':
        this.pet.memory = rememberEvent(this.pet.memory, 'tug', e.winner === 'pet' ? 'Won a round of tug of war' : 'Lost a round of tug of war (you won!)', Date.now())
        break
      case 'fx':
        this.fx = e.fx
        this.fxKey++
        break
    }
  }

  /** Show a speech bubble for a moment. Used by reactions and the conversation service. */
  say(text: string, seconds?: number): void {
    this.speech = text
    this.speechKey++
    this.speechUntil = this.t + (seconds ?? Math.min(7, 2.5 + text.length * 0.05))
  }

  dragStart(): void {
    this.dragging = true
    this.pendingDrop = false
    this.dragStartY = this.movement.y
    this.movement.stop()
    this.behavior.markEnded(this.activity.state, this.t)
    this.previousState = this.activity.state
    this.activity = this.makeActivity('DRAGGED', 'none', Infinity, 'system')
    this.speech = null
  }

  dragMove(x: number, y: number): void {
    if (!this.dragging) return
    const halfW = (SPRITE_WIDTH / 2) * this.env.scale * 0.7
    const cx = Math.max(halfW, Math.min(this.env.width - halfW, x))
    const cy = Math.max(SPRITE_HEIGHT * this.env.scale * 0.5, Math.min(this.movement.floorY(), y))
    this.movement.place(cx, cy)
  }

  dragEnd(): void {
    if (!this.dragging) return
    this.dragging = false
    this.pet.memory = recordInteraction(this.pet.memory, 'drag', Date.now())
    const dropHeight = this.movement.floorY() - this.movement.y
    if (!this.env.freeRoam && dropHeight > 1) {
      this.movement.drop()
      this.pendingDrop = true
      this.activity = this.makeActivity('FALLING', 'none', Infinity, 'system')
    } else {
      this.applyReaction(this.interaction.dropped(this.interactionContext(), 0, this.rng))
    }
    this.emit({ type: 'save' })
  }

  /* ---------------------------------------------------------------- ticking */

  tick(nowMs: number): PetSnapshot {
    if (this.paused) return this.snapshot()
    if (this.lastTickMs === null) this.lastTickMs = nowMs
    const dt = Math.max(0, Math.min(0.25, (nowMs - this.lastTickMs) / 1000))
    this.lastTickMs = nowMs
    this.t = nowMs / 1000

    const sleeping = this.activity.state === 'SLEEPING'
    let stats = applyDrift(this.pet.stats, dt, sleeping)
    if (this.activity.effects) stats = this.applyStatDelta(stats, this.activity.effects, dt)
    this.pet.stats = stats
    this.checkLevel()

    if (!this.dragging && this.games.mode !== 'none') this.updatePlay(dt)

    if (!this.dragging) {
      const cursorForMovement = this.activity.movement === 'toCursor' ? this.cursor : null
      const { arrived } = this.movement.update(dt, this.rng, cursorForMovement, this.t)
      this.afterMovement(arrived)
      if (this.activity.faceViewer === false && this.shouldFaceCursor() && this.cursor) this.movement.faceToward(this.cursor.x)
      if (this.t >= this.activity.endsAt) this.completeActivity()
    }

    this.checkSystemTriggers(nowMs)

    if (this.speech && this.t > this.speechUntil) this.speech = null
    if (this.fx && this.t > this.activity.startedAt + 3) this.fx = null

    if (this.t - this.lastSaveT > AUTOSAVE_INTERVAL) {
      this.lastSaveT = this.t
      this.emit({ type: 'save' })
    }
    return this.snapshot()
  }

  /** Apply a long absence (window hidden or app paused) in one step. */
  applyElapsed(seconds: number): void {
    if (seconds <= 0) return
    this.pet.stats = applyOfflineTime(this.pet.stats, seconds)
    this.lastTickMs = null
  }

  private afterMovement(arrived: boolean): void {
    const a = this.activity
    if (a.state === 'FALLING' && !this.movement.airborne && this.pendingDrop) {
      this.pendingDrop = false
      const dropHeight = this.movement.floorY() - this.dragStartY
      if (dropHeight > 200) this.pet.memory.timesDropped++
      this.emit({ type: 'sound', name: 'land' })
      this.applyReaction(this.interaction.dropped(this.interactionContext(), dropHeight, this.rng))
      return
    }
    if (a.state === 'FALLING' && !this.movement.airborne && !this.pendingDrop) {
      this.activity.endsAt = this.t
      return
    }
    if (a.state === 'JUMPING' && !this.movement.airborne && this.t > a.startedAt + 0.3) {
      this.emit({ type: 'sound', name: 'land' })
      a.endsAt = Math.min(a.endsAt, this.t)
    }
    if (!arrived) return
    if (a.movement === 'toCursor') {
      // arrived next to the cursor: linger a little, then move on
      this.movement.stop()
      a.movement = 'none'
      a.endsAt = Math.min(a.endsAt, this.t + this.rng.range(1, 2.5))
    } else if (a.movement === 'walk' || a.movement === 'run' || a.movement === 'chase') {
      a.endsAt = Math.min(a.endsAt, this.t + 0.2)
    }
  }

  private applyStatDelta(stats: PetStats, delta: Partial<PetStats>, factor = 1): PetStats {
    const s = { ...stats }
    for (const key of Object.keys(delta) as (keyof PetStats)[]) {
      const v = delta[key]
      if (v === undefined) continue
      if (key === 'experience') s.experience = Math.max(0, s.experience + v * factor)
      else s[key] = clampStat(s[key] + v * factor)
    }
    return s
  }

  private checkLevel(): void {
    const lvl = levelForExperience(this.pet.stats.experience)
    if (lvl > this.level) {
      this.level = lvl
      this.pet.memory = rememberEvent(this.pet.memory, 'levelUp', `Reached level ${lvl}`, Date.now())
      this.applyReaction({ state: 'CELEBRATING', movement: 'none', duration: 4, speech: `Level ${lvl}! 🎉`, fx: 'sparkle', stats: { happiness: 5 } })
      this.emit({ type: 'levelUp', level: lvl })
      this.emit({ type: 'sound', name: 'notify' })
    }
  }

  private checkSystemTriggers(nowMs: number): void {
    if (this.t - this.lastEvolveT > PERSONALITY_EVOLVE_INTERVAL) {
      this.lastEvolveT = this.t
      this.pet.personality = this.personality.evolve(this.pet.personality, this.pet.memory)
    }
    const minutes = this.env.breakReminderMinutes
    if (minutes > 0 && this.activeSeconds >= minutes * 60 && this.t - this.lastBreakReminderT > 45 * 60 && this.activity.source === 'behavior' && this.idleSeconds < 10) {
      this.lastBreakReminderT = this.t
      const owner = this.env.ownerName
      const text = owner ? `${owner}, take a break with me? 🐾` : 'Take a break with me? 🐾'
      const act = this.makeActivity('CURIOUS', this.cursor ? 'toCursor' : 'none', 8, 'system')
      this.startActivity(act)
      this.say(text, 8)
      this.emit({ type: 'sound', name: 'notify' })
      this.emit({ type: 'notify', text })
      this.pet.memory = rememberEvent(this.pet.memory, 'break', 'Suggested a break', nowMs)
    }
  }

  private onUserReturned(): void {
    if (this.paused || this.dragging) return
    const p = this.pet.personality
    if (!this.rng.chance(0.35 + p.friendliness * 0.6)) return
    const owner = this.env.ownerName
    const greetings = ["you're back!", 'missed you!', 'hi hi hi', '*happy wiggle*', owner ? `${owner}! hi!` : 'hello again']
    if (this.activity.state === 'SLEEPING') {
      this.applyReaction({ state: 'STRETCHING', movement: 'none', duration: 3, speech: 'oh! hi', fx: null, stats: {} })
    } else {
      this.applyReaction({ state: 'EXCITED', movement: 'none', duration: 3.5, speech: this.rng.pick(greetings), fx: 'hearts', stats: { happiness: 2 } })
    }
    this.emit({ type: 'sound', name: 'voice' })
  }

  /* ------------------------------------------------------------- decisions */

  private buildContext(): DecisionContext {
    const last = this.pet.memory.lastInteractionAt
    const cursorNear = Boolean(this.cursor && Math.hypot(this.cursor.x - this.movement.x, this.cursor.y - this.movement.y) < 250)
    return {
      personality: this.pet.personality,
      stats: this.pet.stats,
      mood: moodFor(this.pet.stats),
      memory: this.pet.memory,
      previousState: this.previousState,
      idleSeconds: this.idleSeconds,
      activeSeconds: this.activeSeconds,
      cursorOnDisplay: this.cursor !== null,
      cursorMoving: this.t - this.lastCursorMoveT < 2,
      cursorNear,
      sinceInteraction: last ? (Date.now() - last) / 1000 : Infinity,
      hourOfDay: new Date(this.t * 1000).getHours(),
      speciesBias: this.species.behaviorBias,
      freeRoam: this.env.freeRoam
    }
  }

  private interactionContext(): InteractionContext {
    return {
      personality: this.pet.personality,
      stats: this.pet.stats,
      species: this.species,
      currentState: this.activity.state,
      ageSeconds: (Date.now() - this.pet.createdAt) / 1000
    }
  }

  private makeActivity(state: BehaviorState, movement: MovementMode, duration: number, source: Activity['source']): Activity {
    return {
      state,
      animation: ANIMATION_FOR_STATE[state],
      movement,
      startedAt: this.t,
      endsAt: this.t + duration,
      source,
      faceViewer: false,
      item: null,
      gift: false
    }
  }

  private startActivity(act: Activity): void {
    if (this.activity.state !== act.state) this.behavior.markEnded(this.activity.state, this.t)
    this.previousState = this.activity.state
    this.activity = act
    this.animationKey++
    this.movement.begin(act.movement, this.rng, this.cursor)
    if (act.state === 'JUMPING') {
      this.movement.jump(this.rng)
      this.emit({ type: 'sound', name: 'jump' })
    }
    if (act.state === 'SLEEPING') this.emit({ type: 'sound', name: 'sleep' })
  }

  private completeActivity(): void {
    const a = this.activity
    if (a.onComplete) this.pet.stats = this.applyStatDelta(this.pet.stats, a.onComplete)
    if (a.item) {
      this.pet.inventory = addItem(this.pet.inventory, a.item)
      const def = ITEMS[a.item]
      if (a.gift) {
        this.pet.memory.giftsGiven++
        this.pet.memory = rememberEvent(this.pet.memory, 'gift', `Brought you a ${def?.name ?? a.item}`, Date.now())
      } else {
        this.pet.memory = rememberEvent(this.pet.memory, 'found', `Found a ${def?.name ?? a.item}`, Date.now())
      }
      this.emit({ type: 'itemFound', itemId: a.item, gift: a.gift })
      this.emit({ type: 'save' })
    }
    this.behavior.markEnded(a.state, this.t)
    this.decideNext()
  }

  private decideNext(): void {
    const ctx = this.buildContext()
    const event = this.events.roll(ctx, this.t, this.rng)
    if (event) this.startEvent(event)
    else this.startBehavior(this.behavior.decide(ctx, this.t, this.rng), ctx)
  }

  private startBehavior(def: BehaviorDefinition, ctx: DecisionContext): void {
    const duration = this.behavior.durationFor(def, ctx, this.rng)
    const act = this.makeActivity(def.state, def.movement, duration, 'behavior')
    act.effects = def.effects
    act.onComplete = def.onComplete
    this.startActivity(act)
    if (def.thoughts && this.rng.chance(0.15)) this.say(this.rng.pick(def.thoughts))
    if (def.state === 'SAD' && this.rng.chance(0.3)) this.say(this.rng.pick(def.thoughts ?? ['...']))
  }

  private startEvent(ev: TriggeredEvent): void {
    const act = this.makeActivity(ev.event.state, ev.event.movement, ev.duration, 'event')
    act.eventId = ev.event.id
    act.faceViewer = Boolean(ev.event.faceViewer)
    act.item = ev.item
    act.gift = ev.event.id === 'bring_gift'
    this.startActivity(act)
    if (ev.event.stats) this.pet.stats = this.applyStatDelta(this.pet.stats, ev.event.stats)
    if (ev.speech) this.say(ev.speech)
    if (ev.event.fx) {
      this.fx = ev.event.fx
      this.fxKey++
    }
    if (ev.event.id === 'sudden_sleep') this.emit({ type: 'sound', name: 'sleep' })
    if (ev.event.id === 'scared') this.emit({ type: 'sound', name: 'voice' })
    this.pet.memory = rememberEvent(this.pet.memory, 'event', `Event: ${ev.event.id.replace(/_/g, ' ')}`, Date.now())
  }

  private interact(type: InteractionType, reaction: Reaction): void {
    if (this.paused) return
    this.pet.memory = recordInteraction(this.pet.memory, type, Date.now())
    this.applyReaction(reaction)
    this.emit({ type: 'save' })
  }

  private applyReaction(r: Reaction): void {
    this.pet.stats = this.applyStatDelta(this.pet.stats, r.stats)
    if (r.speech) this.say(r.speech)
    if (r.fx) {
      this.fx = r.fx
      this.fxKey++
    }
    if (r.ignore) return
    if (this.dragging) return
    // During a mini-game the game directs the body; reactions only add speech, effects and stats.
    if (this.games.mode !== 'none' && this.activity.source === 'play') return
    const act = this.makeActivity(r.state, r.movement, r.duration, 'reaction')
    act.faceViewer = Boolean(r.faceViewer)
    // Reactions replace whatever the pet was doing, but the cursor is where the action is.
    this.startActivity(act)
    if (r.jump && r.state !== 'JUMPING') this.movement.jump(this.rng, 0.6)
    if (this.cursor && !act.faceViewer) this.movement.faceToward(this.cursor.x)
    this.checkLevel()
  }

  private shouldFaceCursor(): boolean {
    if (!this.cursor) return false
    if (this.activity.source === 'play') return false
    if (this.hovering) return true
    const s = this.activity.state
    return s === 'WATCHING' || s === 'CURIOUS'
  }

  /* -------------------------------------------------------------- snapshot */

  private lookAt(): { dx: number; dy: number } | null {
    if (!this.cursor) return null
    const s = this.activity.state
    if (this.games.mode === 'fetch' && this.games.ball) {
      // eyes on the ball
      const headX = this.movement.x
      const headY = this.movement.y - SPRITE_HEIGHT * this.env.scale * 0.7
      return { dx: Math.max(-1, Math.min(1, (this.games.ball.x - headX) / 300)) * this.movement.facing, dy: Math.max(-1, Math.min(1, (this.games.ball.y - headY) / 300)) }
    }
    const watching = this.hovering || s === 'WATCHING' || s === 'CURIOUS' || s === 'CHASING'
    const glance = this.t - this.lastCursorMoveT < 1.5 && Math.hypot(this.cursor.x - this.movement.x, this.cursor.y - this.movement.y) < 260
    if (!watching && !glance) return null
    if (this.activity.faceViewer) return null
    const headX = this.movement.x
    const headY = this.movement.y - SPRITE_HEIGHT * this.env.scale * 0.7
    const dx = Math.max(-1, Math.min(1, (this.cursor.x - headX) / 300))
    const dy = Math.max(-1, Math.min(1, (this.cursor.y - headY) / 300))
    return { dx: dx * this.movement.facing, dy }
  }

  snapshot(): PetSnapshot {
    const m = this.movement.snapshot()
    return {
      x: m.x,
      y: m.y,
      facing: m.facing,
      state: this.activity.state,
      animation: this.activity.animation,
      animationKey: this.animationKey,
      moving: m.moving,
      speed: m.speed,
      airborne: m.airborne,
      lookAt: this.lookAt(),
      faceViewer: this.activity.faceViewer,
      speech: this.speech,
      speechKey: this.speechKey,
      fx: this.fx,
      fxKey: this.fxKey,
      mood: moodFor(this.pet.stats),
      stats: this.pet.stats,
      level: this.level,
      ageDays: ageInDays(this.pet),
      hidden: this.activity.state === 'HIDING',
      heldItem: this.activity.item && this.activity.gift ? ITEMS[this.activity.item]?.emoji ?? null : null,
      name: this.pet.name,
      speciesId: this.pet.speciesId,
      gait: this.species.movement.gait,
      play: this.games.mode === 'none' ? null : this.games.snapshot()
    }
  }

  /** Serializable pet for persistence. */
  toSave(): PetSave {
    return { ...this.pet, stats: { ...this.pet.stats }, memory: { ...this.pet.memory }, inventory: { ...this.pet.inventory }, lastSeenAt: Date.now() }
  }

  /** Position as a fraction of the window, for persistence across resolutions. */
  positionFraction(): { fx: number; fy: number } {
    return { fx: this.movement.x / this.env.width, fy: this.movement.y / this.env.height }
  }

  /** Debug helper: force the next decision to be a spontaneous event. */
  surprise(): void {
    const ev = this.events.fire(this.buildContext(), this.t, this.rng)
    if (ev) this.startEvent(ev)
  }

  currentState(): BehaviorState {
    return this.activity.state
  }

  /** Exposed for tests. */
  debugWeights(): { state: BehaviorState; weight: number }[] {
    return this.behavior.weigh(this.buildContext(), this.t).map((w) => ({ state: w.def.state, weight: w.weight }))
  }
}

export { BEHAVIOR_BY_STATE }
