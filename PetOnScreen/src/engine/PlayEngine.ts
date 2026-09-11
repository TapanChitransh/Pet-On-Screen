import type { BehaviorState } from '@models/Behavior'
import type { Personality } from '@models/Personality'
import type { PetStats } from '@models/PetStats'
import type { Rng } from './rng'
import type { Point } from './MovementEngine'

export type PlayMode = 'none' | 'fetch' | 'tug'

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  held: 'cursor' | 'pet' | 'free'
  resting: boolean
}

export type FetchPhase = 'wait' | 'react' | 'chase' | 'carry' | 'keep' | 'drop' | 'ignore' | 'tired'
export type TugPhase = 'idle' | 'pulling' | 'petWon' | 'userWon'

export interface TugState {
  phase: TugPhase
  /** the end the user holds (window coords) */
  handle: Point
  /** 0..1 how taut the rope is */
  tension: number
  userGrip: number
  petGrip: number
  rounds: { user: number; pet: number }
  holding: boolean
}

export interface PlayContext {
  dt: number
  t: number
  cursor: Point | null
  pet: { x: number; y: number; facing: 1 | -1; airborne: boolean }
  /** where a carried object attaches (mouth / hands) */
  mouth: Point
  width: number
  height: number
  floorY: number
  freeRoam: boolean
  scale: number
  personality: Personality
  stats: PetStats
  runSpeed: number
  walkSpeed: number
  jumpHeight: number
}

export type PlayEvent =
  | { type: 'speech'; text: string }
  | { type: 'sound'; name: 'happy' | 'jump' | 'voice' | 'annoyed' | 'notify' | 'land' }
  | { type: 'stats'; delta: Partial<PetStats> }
  | { type: 'game' }
  | { type: 'round'; winner: 'user' | 'pet' }
  | { type: 'fx'; fx: 'hearts' | 'sparkle' | 'exclaim' | 'question' | 'music' }

export interface PlayDirective {
  /** what the pet should be doing; null = leave the pet to its own behavior */
  state: BehaviorState | null
  /** run/walk towards this point (null = stand still) */
  target: Point | null
  speed: number
  /** face this x, if set */
  faceX: number | null
  jump: boolean
  /** horizontal displacement applied directly (being dragged in tug of war) */
  skidDx: number
  events: PlayEvent[]
}

export interface PlaySnapshot {
  mode: PlayMode
  phase: FetchPhase | TugPhase | null
  ball: { x: number; y: number; r: number; held: Ball['held'] } | null
  tug: { handle: Point; mouth: Point; tension: number; userGrip: number; petGrip: number; rounds: { user: number; pet: number }; holding: boolean } | null
  /** short hint shown in the HUD */
  message: string
}

const GRAVITY = 1900
/** flick speed (px/s of cursor) -> ball speed; a hard flick still crosses the screen but stays readable */
const THROW_SCALE = 0.6
const THROW_SPEED_CAP = 1500
const THROW_MIN = 150

/**
 * Mini-games that need real-time physics and pointer input: Fetch and Tug of War.
 * Pure TypeScript. PetEngine feeds it the cursor and pet position each tick and applies the
 * returned directive (state, movement target, skid) to the pet.
 */
export class PlayEngine {
  mode: PlayMode = 'none'
  ball: Ball | null = null
  tug: TugState | null = null

  private fetchPhase: FetchPhase = 'wait'
  private phaseUntil = 0
  private throws = 0
  private keepTarget: Point | null = null
  private message = ''
  private history: { x: number; y: number; t: number }[] = []
  private lastMouth: Point = { x: 0, y: 0 }
  private lastCursor: Point | null = null
  private cursorSpeed = 0
  private burstUntil = 0
  private nextBurstAt = 0
  private ropeLength = 130

  constructor(private rng: Rng) {}

  /* ------------------------------------------------------------- lifecycle */

  startFetch(cursor: Point | null, pet: { x: number; y: number }, scale: number): void {
    this.mode = 'fetch'
    this.throws = 0
    this.fetchPhase = 'wait'
    const start = cursor ?? { x: pet.x, y: pet.y - 120 * scale }
    this.ball = { x: start.x, y: start.y, vx: 0, vy: 0, r: 9 * scale, held: cursor ? 'cursor' : 'free', resting: false }
    this.message = cursor ? 'Drag and flick to throw the ball' : 'Click the ball to pick it up'
  }

  startTug(pet: { x: number; y: number; facing: 1 | -1 }, floorY: number, scale: number): void {
    this.mode = 'tug'
    this.ropeLength = 130 * scale
    this.tug = {
      phase: 'idle',
      handle: { x: pet.x + pet.facing * this.ropeLength * 0.55, y: floorY - 8 * scale },
      tension: 0,
      userGrip: 1,
      petGrip: 1,
      rounds: { user: 0, pet: 0 },
      holding: false
    }
    this.message = 'Grab the rope end and pull away from your pet. Hold the mouse button!'
  }

  stop(): void {
    this.mode = 'none'
    this.ball = null
    this.tug = null
    this.history = []
    this.message = ''
  }

  /* --------------------------------------------------------------- pointer */

  /** Returns true when the pointer press was consumed by the game. */
  pointerDown(p: Point, t: number, tLive = t): boolean {
    if (this.mode === 'fetch' && this.ball) {
      if (this.ball.held === 'cursor') {
        this.history = [{ ...p, t: tLive }]
        return true
      }
      if (this.ball.held === 'free' && Math.hypot(this.ball.x - p.x, this.ball.y - p.y) < this.ball.r + 26) {
        this.ball.held = 'cursor'
        this.ball.vx = 0
        this.ball.vy = 0
        this.ball.resting = false
        this.history = [{ ...p, t: tLive }]
        if (this.fetchPhase === 'ignore' || this.fetchPhase === 'drop') this.fetchPhase = 'wait'
        this.message = 'Drag and flick to throw'
        return true
      }
      return false
    }
    if (this.mode === 'tug' && this.tug) {
      if (this.tug.phase === 'idle' && Math.hypot(this.tug.handle.x - p.x, this.tug.handle.y - p.y) < 44) {
        this.tug.phase = 'pulling'
        this.tug.holding = true
        this.tug.userGrip = 1
        this.tug.petGrip = 1
        this.tug.handle = { ...p }
        this.nextBurstAt = t + 0.6
        this.message = 'Pull! Keep the rope taut and move away from your pet.'
        return true
      }
      if (this.tug.phase === 'userWon') {
        this.tug.holding = true
        return true
      }
    }
    return false
  }

  pointerMove(p: Point, t: number, tLive = t): void {
    if (this.mode === 'fetch' && this.ball?.held === 'cursor') {
      this.ball.x = p.x
      this.ball.y = p.y
      this.history.push({ ...p, t: tLive })
      if (this.history.length > 12) this.history.shift()
    }
    if (this.mode === 'tug' && this.tug?.holding) this.tug.handle = { ...p }
  }

  pointerUp(p: Point, t: number, tLive = t): void {
    if (this.mode === 'fetch' && this.ball?.held === 'cursor') {
      // Flick velocity from the live clock (pointer events arrive between ticks).
      const recent = this.history.filter((h) => tLive - h.t < 0.09)
      const first = recent[0] ?? this.history[0]
      let vx = 0
      let vy = 0
      if (first && tLive - first.t > 0.004) {
        vx = (p.x - first.x) / (tLive - first.t)
        vy = (p.y - first.y) / (tLive - first.t)
      }
      vx *= THROW_SCALE
      vy *= THROW_SCALE
      const speed = Math.hypot(vx, vy)
      if (speed > THROW_SPEED_CAP) {
        vx *= THROW_SPEED_CAP / speed
        vy *= THROW_SPEED_CAP / speed
      }
      this.ball.held = 'free'
      this.ball.resting = false
      if (speed < THROW_MIN) {
        this.ball.vx = 0
        this.ball.vy = 0
      } else {
        this.ball.vx = vx
        this.ball.vy = vy
      }
      this.history = []
      this.onThrown(speed >= THROW_MIN, t)
    }
    if (this.mode === 'tug' && this.tug) {
      if (this.tug.phase === 'pulling') {
        this.tug.holding = false
        this.endRound('pet', t, true)
      } else this.tug.holding = false
    }
  }

  /* ----------------------------------------------------------------- update */

  update(ctx: PlayContext): PlayDirective {
    const d: PlayDirective = { state: null, target: null, speed: ctx.runSpeed, faceX: null, jump: false, skidDx: 0, events: [] }
    if (ctx.cursor && this.lastCursor) {
      this.cursorSpeed = Math.hypot(ctx.cursor.x - this.lastCursor.x, ctx.cursor.y - this.lastCursor.y) / Math.max(ctx.dt, 0.001)
    } else this.cursorSpeed = 0
    this.lastCursor = ctx.cursor ? { ...ctx.cursor } : null
    this.lastMouth = ctx.mouth
    if (this.mode === 'fetch' && this.ball) this.updateFetch(ctx, d)
    else if (this.mode === 'tug' && this.tug) this.updateTug(ctx, d)
    return d
  }

  snapshot(): PlaySnapshot {
    return {
      mode: this.mode,
      phase: this.mode === 'fetch' ? this.fetchPhase : this.mode === 'tug' ? this.tug?.phase ?? null : null,
      ball: this.ball ? { x: this.ball.x, y: this.ball.y, r: this.ball.r, held: this.ball.held } : null,
      tug: this.tug
        ? { handle: this.tug.handle, mouth: this.lastMouth, tension: this.tug.tension, userGrip: this.tug.userGrip, petGrip: this.tug.petGrip, rounds: this.tug.rounds, holding: this.tug.holding }
        : null,
      message: this.message
    }
  }

  /* ------------------------------------------------------------------ fetch */

  private onThrown(flicked: boolean, t: number): void {
    this.throws++
    this.message = flicked ? '' : 'Flick faster to throw further'
  }

  private updateFetch(ctx: PlayContext, d: PlayDirective): void {
    const ball = this.ball!
    const p = ctx.personality
    const s = ctx.scale

    // physics
    if (ball.held === 'pet') {
      ball.x = ctx.mouth.x
      ball.y = ctx.mouth.y
    } else if (ball.held === 'free') {
      this.stepBall(ball, ctx)
    }

    // decide what the pet does about a free ball
    if (ball.held === 'free' && this.fetchPhase === 'wait' && !ball.resting) {
      if (ctx.stats.energy < 15) {
        this.fetchPhase = 'tired'
        d.events.push({ type: 'speech', text: this.rng.pick(['too tired... *flops*', '*yawn* later?', 'no more running...']) })
        this.message = 'Your pet is too tired to play. Let it rest a while.'
      } else if (this.throws > 1 && this.rng.chance(p.laziness * 0.35)) {
        this.fetchPhase = 'ignore'
        d.events.push({ type: 'speech', text: this.rng.pick(['...you threw it, you get it.', '*watches it roll* nope.', 'hmm. no.', '*slow blink*']) })
        this.message = 'Not interested this time. Pick the ball up to try again.'
      } else {
        this.fetchPhase = 'react'
        this.phaseUntil = ctx.t + 0.12 + (1 - p.playfulness) * 0.5
        if (this.rng.chance(0.5)) d.events.push({ type: 'speech', text: this.rng.pick(['ball!!', '!!!', 'mine!', '*eyes lock on*']) })
        d.events.push({ type: 'sound', name: 'voice' })
      }
    }

    switch (this.fetchPhase) {
      case 'wait':
        d.state = 'WATCHING'
        d.faceX = ball.x
        if (ball.held === 'free' && ball.resting && !this.message) this.message = 'Click the ball to pick it up'
        break
      case 'react':
        d.state = 'EXCITED'
        d.faceX = ball.x
        if (ctx.t >= this.phaseUntil) this.fetchPhase = 'chase'
        break
      case 'chase': {
        d.state = 'FETCHING'
        // Aim so the mouth (not the feet) lands on the ball: stop a little short on the approach side,
        // and in free roam hover with the feet below the ball.
        const side = ball.x >= ctx.pet.x ? 1 : -1
        d.target = { x: ball.x - side * 26 * s, y: ctx.freeRoam ? ball.y + 48 * s : ball.y }
        d.speed = ctx.runSpeed * (0.8 + p.playfulness * 0.45)
        d.faceX = ball.x
        // leap for a ball passing overhead
        const dx = ball.x - ctx.pet.x
        const above = ctx.pet.y - ball.y
        if (!ctx.pet.airborne && !ctx.freeRoam && Math.abs(dx) < 34 * s && above > 55 * s && above < 60 * s + ctx.jumpHeight * s * 1.1 && ball.vy > -200) {
          d.jump = true
        }
        const reachCenter = { x: ctx.pet.x, y: ctx.pet.y - 40 * s }
        const near = Math.hypot(ball.x - ctx.mouth.x, ball.y - ctx.mouth.y) < 42 * s || Math.hypot(ball.x - reachCenter.x, ball.y - reachCenter.y) < 48 * s
        if (near) {
          ball.held = 'pet'
          ball.vx = 0
          ball.vy = 0
          d.events.push({ type: 'sound', name: 'happy' })
          if (this.rng.chance(0.4)) d.events.push({ type: 'speech', text: this.rng.pick(['got it!', '*chomp*', 'yes!', 'hehe']) })
          if (this.rng.chance(p.mischief * 0.3)) {
            this.fetchPhase = 'keep'
            const far = this.rng.chance(0.5) ? 60 * s : ctx.width - 60 * s
            this.keepTarget = { x: far, y: ctx.freeRoam ? this.rng.range(ctx.height * 0.3, ctx.floorY) : ctx.floorY }
            this.phaseUntil = ctx.t + 3.5
            d.events.push({ type: 'speech', text: this.rng.pick(["it's mine now", 'hehe, catch me!', 'nope, keeping it']) })
            this.message = 'Uh oh, your pet is keeping it. Click the ball when it drops.'
          } else this.fetchPhase = 'carry'
        }
        break
      }
      case 'carry': {
        d.state = 'CARRYING'
        d.faceX = ctx.cursor?.x ?? null
        if (!ctx.cursor) {
          d.target = null
          break
        }
        d.target = { x: ctx.cursor.x, y: ctx.cursor.y }
        d.speed = ctx.runSpeed * 0.7
        const dist = Math.abs(ctx.cursor.x - ctx.pet.x)
        const vertical = ctx.freeRoam ? Math.abs(ctx.cursor.y - ctx.pet.y) : 0
        if (dist < 75 * s && vertical < 90 * s) this.dropBall(ctx, d, true)
        break
      }
      case 'keep': {
        d.state = 'ZOOMIES'
        d.target = this.keepTarget
        d.speed = ctx.runSpeed * 1.1
        if (ctx.t >= this.phaseUntil || (this.keepTarget && Math.abs(this.keepTarget.x - ctx.pet.x) < 12)) this.dropBall(ctx, d, false)
        break
      }
      case 'drop':
        d.state = 'HAPPY'
        d.faceX = ctx.cursor?.x ?? null
        if (ctx.t >= this.phaseUntil) this.fetchPhase = 'wait'
        break
      case 'ignore':
        d.state = 'SITTING'
        d.faceX = ball.x
        break
      case 'tired':
        d.state = 'TIRED'
        if (ctx.stats.energy > 25) this.fetchPhase = 'wait'
        break
    }
  }

  private dropBall(ctx: PlayContext, d: PlayDirective, returned: boolean): void {
    const ball = this.ball!
    ball.held = 'free'
    ball.x = ctx.mouth.x
    ball.y = ctx.mouth.y
    // A returned ball is tossed gently towards the cursor so it lands at your feet.
    const towards = returned && ctx.cursor ? Math.max(-260, Math.min(260, (ctx.cursor.x - ctx.mouth.x) * 1.6)) : ctx.pet.facing * 90
    ball.vx = towards
    ball.vy = -160
    ball.resting = false
    this.fetchPhase = 'drop'
    this.phaseUntil = ctx.t + 1.3
    if (returned) {
      const p = ctx.personality
      d.events.push({ type: 'speech', text: this.rng.pick(['again?', 'throw it!', '*drops ball* again again', 'that was a good one']) })
      d.events.push({ type: 'stats', delta: { happiness: 6 + p.playfulness * 4, energy: -4, affection: 1.5, experience: 4 } })
      d.events.push({ type: 'game' })
      d.events.push({ type: 'fx', fx: 'hearts' })
      this.message = 'Pick the ball up and throw again'
    } else {
      d.events.push({ type: 'speech', text: 'hehe' })
      this.message = 'Click the ball to pick it up'
    }
  }

  private stepBall(ball: Ball, ctx: PlayContext): void {
    if (ball.resting) return
    const dt = ctx.dt
    ball.vy += GRAVITY * dt
    ball.x += ball.vx * dt
    ball.y += ball.vy * dt
    const floor = ctx.floorY - ball.r
    if (ball.y > floor) {
      ball.y = floor
      if (Math.abs(ball.vy) > 90) ball.vy = -ball.vy * 0.45
      else ball.vy = 0
      ball.vx *= 0.8
    }
    if (ball.y === floor && ball.vy === 0) {
      ball.vx *= Math.max(0, 1 - 3 * dt)
      if (Math.abs(ball.vx) < 8) {
        ball.vx = 0
        ball.resting = true
      }
    }
    if (ball.x < ball.r) {
      ball.x = ball.r
      ball.vx = Math.abs(ball.vx) * 0.45
    } else if (ball.x > ctx.width - ball.r) {
      ball.x = ctx.width - ball.r
      ball.vx = -Math.abs(ball.vx) * 0.45
    }
    if (ball.y < ball.r) {
      ball.y = ball.r
      ball.vy = Math.abs(ball.vy) * 0.4
    }
  }

  /* -------------------------------------------------------------------- tug */

  private petStrength(ctx: PlayContext): number {
    return 0.3 + ctx.personality.energy * 0.4 + (ctx.stats.energy / 100) * 0.3
  }

  private updateTug(ctx: PlayContext, d: PlayDirective): void {
    const tug = this.tug!
    const s = ctx.scale
    const L = this.ropeLength
    d.state = 'TUGGING'
    d.faceX = tug.handle.x

    switch (tug.phase) {
      case 'idle': {
        // rope end lies in front of the pet
        tug.handle = { x: ctx.pet.x + ctx.pet.facing * L * 0.55, y: ctx.floorY - 8 * s }
        tug.tension = 0
        break
      }
      case 'pulling': {
        const dx = tug.handle.x - ctx.mouth.x
        const dy = tug.handle.y - ctx.mouth.y
        const dist = Math.hypot(dx, dy)
        tug.tension = Math.max(0, Math.min(1, (dist - L) / (70 * s)))
        const strength = this.petStrength(ctx)
        const dir = Math.sign(dx) || 1
        // The pet tugs in bursts, stepping back away from you.
        if (ctx.t >= this.nextBurstAt) {
          this.burstUntil = ctx.t + this.rng.range(0.35, 0.7)
          this.nextBurstAt = this.burstUntil + this.rng.range(0.5, 1.4)
          if (this.rng.chance(0.3)) d.events.push({ type: 'speech', text: this.rng.pick(['grrr', '*pulls*', 'mine!', 'hnng!']) })
        }
        const bursting = ctx.t < this.burstUntil
        if (bursting) {
          if (dist < L + 40 * s) {
            // room to pull: step back
            const step = 95 * strength * ctx.dt
            const nx = ctx.pet.x - dir * step
            if (nx > 30 * s && nx < ctx.width - 30 * s) d.skidDx -= dir * step
          } else {
            // rope taut and the user is not giving: drain their grip
            tug.userGrip -= ctx.dt * 0.55 * strength * (this.cursorSpeed > 60 ? 0.4 : 1)
          }
        }
        // The user pulling away drags the pet and wears its grip down.
        if (tug.tension > 0) {
          const pullingAway = this.cursorSpeed > 40 && (ctx.cursor ? Math.sign(ctx.cursor.x - ctx.pet.x) === dir : true)
          const skid = tug.tension * 150 * (1 - strength * 0.55) * ctx.dt
          d.skidDx += dir * skid
          tug.petGrip -= ctx.dt * tug.tension * (0.3 + (pullingAway ? Math.min(1, this.cursorSpeed / 500) * 0.6 : 0)) * (1.3 - strength)
          if (!bursting) tug.userGrip -= ctx.dt * 0.08 * tug.tension
        } else {
          tug.petGrip = Math.min(1, tug.petGrip + ctx.dt * 0.12)
          tug.userGrip = Math.min(1, tug.userGrip + ctx.dt * 0.2)
        }
        tug.userGrip = Math.max(0, tug.userGrip)
        tug.petGrip = Math.max(0, tug.petGrip)
        if (tug.petGrip <= 0) this.endRound('user', ctx.t, false, d)
        else if (tug.userGrip <= 0) this.endRound('pet', ctx.t, false, d)
        break
      }
      case 'petWon': {
        d.state = 'CELEBRATING'
        d.faceX = null
        tug.handle = { x: ctx.mouth.x + ctx.pet.facing * 14 * s, y: ctx.mouth.y + 6 * s }
        tug.tension = 0
        if (ctx.t >= this.phaseUntil) {
          tug.phase = 'idle'
          this.message = 'Grab the rope end for another round'
        }
        break
      }
      case 'userWon': {
        d.state = ctx.personality.friendliness < 0.45 && ctx.personality.mischief > 0.5 ? 'ANNOYED' : 'HAPPY'
        tug.tension = 0
        if (!tug.holding) {
          // dropped rope falls to the floor
          tug.handle = { x: tug.handle.x, y: Math.min(ctx.floorY - 8 * s, tug.handle.y + 900 * ctx.dt) }
        }
        if (ctx.t >= this.phaseUntil) {
          tug.phase = 'idle'
          this.message = 'Grab the rope end for another round'
        }
        break
      }
    }
  }

  private endRound(winner: 'user' | 'pet', t: number, letGo: boolean, d?: PlayDirective): void {
    const tug = this.tug!
    tug.rounds[winner]++
    tug.phase = winner === 'pet' ? 'petWon' : 'userWon'
    this.phaseUntil = t + 2.6
    tug.tension = 0
    const events: PlayEvent[] = []
    if (winner === 'pet') {
      events.push({ type: 'speech', text: letGo ? this.rng.pick(['hehe, mine!', 'you let go!', 'too easy']) : this.rng.pick(['MINE!', 'I win!', '*victory shake*', 'hehehe']) })
      events.push({ type: 'sound', name: 'happy' }, { type: 'fx', fx: 'sparkle' })
      events.push({ type: 'stats', delta: { happiness: 9, energy: -6, affection: 2, experience: 5 } })
      this.message = letGo ? 'You let go! Your pet wins the round.' : 'Your pet out-pulled you!'
    } else {
      events.push({ type: 'speech', text: this.rng.pick(['okay okay, you win', '*pant pant* again!', 'strong human!', 'fine. rematch.']) })
      events.push({ type: 'sound', name: 'voice' }, { type: 'fx', fx: 'hearts' })
      events.push({ type: 'stats', delta: { happiness: 7, energy: -7, affection: 2.5, experience: 6 } })
      this.message = 'You won the round!'
    }
    events.push({ type: 'game' }, { type: 'round', winner })
    if (d) d.events.push(...events)
    else this.pendingEvents.push(...events)
  }

  /** Events raised from pointer handlers (outside update) are delivered on the next update. */
  pendingEvents: PlayEvent[] = []
}
