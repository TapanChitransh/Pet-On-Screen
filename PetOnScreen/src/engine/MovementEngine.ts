import type { MovementMode } from '@models/Behavior'
import type { MovementStyle } from '@models/Species'
import type { Rng } from './rng'

export interface Point {
  x: number
  y: number
}

export interface MovementBounds {
  width: number
  height: number
  /** Half the pet's rendered width, so it never leaves the screen. */
  halfWidth: number
  /** Rendered height, used as the top margin in free roam. */
  petHeight: number
  freeRoam: boolean
}

export interface MovementSnapshot {
  x: number
  y: number
  facing: 1 | -1
  moving: boolean
  airborne: boolean
  /** current horizontal speed in px/s (abs) */
  speed: number
}

const GRAVITY = 1800
const EDGE_MARGIN = 12

/**
 * Handles where the pet is and how it gets somewhere. Uses simple kinematics with
 * a floor (bottom of the work area), gravity for drops/jumps and destination seeking.
 */
export class MovementEngine {
  x = 200
  y = 0
  vx = 0
  vy = 0
  facing: 1 | -1 = 1
  airborne = false
  private target: Point | null = null
  private pauseUntil = 0
  private speed = 0
  private bounds: MovementBounds = { width: 1280, height: 720, halfWidth: 40, petHeight: 80, freeRoam: false }
  private mode: MovementMode = 'none'
  private chaseHops = 0

  constructor(private style: MovementStyle) {}

  setStyle(style: MovementStyle): void {
    this.style = style
  }

  setBounds(b: MovementBounds): void {
    const wasFloor = this.isOnFloor()
    this.bounds = b
    this.clampToBounds()
    if (!b.freeRoam && wasFloor) this.y = this.floorY()
    if (!b.freeRoam && this.y > this.floorY()) this.y = this.floorY()
  }

  floorY(): number {
    return this.bounds.height
  }

  minX(): number {
    return this.bounds.halfWidth + EDGE_MARGIN
  }

  maxX(): number {
    return this.bounds.width - this.bounds.halfWidth - EDGE_MARGIN
  }

  minY(): number {
    return this.bounds.freeRoam ? this.bounds.petHeight + EDGE_MARGIN : this.floorY()
  }

  isOnFloor(): boolean {
    return Math.abs(this.y - this.floorY()) < 1
  }

  /** Place the pet somewhere explicitly (initial load / drag). */
  place(x: number, y: number): void {
    this.x = x
    this.y = y
    this.vx = 0
    this.vy = 0
    this.target = null
    this.clampToBounds()
  }

  /** Keep the pet inside the window. The floor is enforced by gravity, not here, so drags can lift the pet. */
  clampToBounds(): void {
    this.x = Math.max(this.minX(), Math.min(this.maxX(), this.x))
    this.y = Math.max(this.bounds.petHeight * 0.5, Math.min(this.floorY(), this.y))
  }

  private pointTarget: Point | null = null

  /** Start a fresh movement behavior. `speed` overrides the mode's default speed (px/s). */
  begin(mode: MovementMode, rng: Rng, cursor: Point | null, speed?: number): void {
    this.mode = mode
    this.target = null
    this.pauseUntil = 0
    this.chaseHops = mode === 'chase' ? rng.int(3, 6) : 0
    if (mode === 'none') {
      this.vx = 0
      return
    }
    this.pickSpeed(mode, rng)
    if (speed !== undefined) this.speed = speed
    this.pickTarget(mode, rng, cursor)
  }

  /** For 'toPoint' mode: where to go (updated every tick by the caller). */
  setPointTarget(p: Point | null, speed?: number): void {
    this.pointTarget = p
    if (speed !== undefined) this.speed = speed
    if (this.mode === 'toPoint') this.target = p ? this.clampPoint(p) : null
  }

  private clampPoint(p: Point): Point {
    return {
      x: Math.max(this.minX(), Math.min(this.maxX(), p.x)),
      y: this.bounds.freeRoam ? Math.max(this.minY(), Math.min(this.floorY(), p.y)) : this.floorY()
    }
  }

  stop(): void {
    this.mode = 'none'
    this.target = null
    this.vx = 0
  }

  /** Launch the pet upward. Height in px at scale 1. */
  jump(rng: Rng, heightScale = 1): void {
    if (this.airborne) return
    const h = this.style.jumpHeight * heightScale * rng.range(0.8, 1.2)
    this.vy = -Math.sqrt(2 * GRAVITY * h)
    this.airborne = true
  }

  /** Called when the user releases the pet after dragging. */
  drop(): void {
    if (this.bounds.freeRoam) return
    if (this.y < this.floorY() - 1) {
      this.airborne = true
      this.vy = 0
      this.vx = 0
    }
  }

  private pickSpeed(mode: MovementMode, rng: Rng): void {
    switch (mode) {
      case 'walk':
        this.speed = this.style.walkSpeed * rng.range(0.75, 1.25)
        break
      case 'run':
      case 'chase':
        this.speed = this.style.runSpeed * rng.range(0.8, 1.1)
        break
      case 'zoom':
        this.speed = this.style.runSpeed * rng.range(1.2, 1.5)
        break
      case 'toCursor':
        this.speed = this.style.walkSpeed * rng.range(1.1, 1.6)
        break
      case 'toPoint':
        this.speed = this.style.runSpeed
        break
      default:
        this.speed = 0
    }
  }

  private randomX(rng: Rng, minDistance: number): number {
    const lo = this.minX()
    const hi = this.maxX()
    for (let i = 0; i < 8; i++) {
      const x = rng.range(lo, hi)
      if (Math.abs(x - this.x) >= minDistance) return x
    }
    return this.x < (lo + hi) / 2 ? hi - rng.range(0, 60) : lo + rng.range(0, 60)
  }

  private randomY(rng: Rng): number {
    if (!this.bounds.freeRoam) return this.floorY()
    return rng.range(this.minY(), this.floorY())
  }

  private pickTarget(mode: MovementMode, rng: Rng, cursor: Point | null): void {
    switch (mode) {
      case 'walk':
        this.target = { x: this.randomX(rng, 80), y: this.randomY(rng) }
        break
      case 'run':
      case 'zoom':
        this.target = { x: this.randomX(rng, 250), y: this.randomY(rng) }
        break
      case 'chase': {
        // chase an imaginary bug: short erratic hops
        const dir = rng.chance(0.5) ? 1 : -1
        const x = Math.max(this.minX(), Math.min(this.maxX(), this.x + dir * rng.range(80, 220)))
        this.target = { x, y: this.randomY(rng) }
        break
      }
      case 'toCursor':
        if (cursor) {
          this.target = {
            x: Math.max(this.minX(), Math.min(this.maxX(), cursor.x)),
            y: this.bounds.freeRoam ? Math.max(this.minY(), Math.min(this.floorY(), cursor.y)) : this.floorY()
          }
        } else this.target = null
        break
      case 'toPoint':
        this.target = this.pointTarget ? this.clampPoint(this.pointTarget) : null
        break
      default:
        this.target = null
    }
  }

  /**
   * Advance by dt seconds. Returns true when the current destination was reached
   * (so the behavior engine may end the behavior early or pick a new destination).
   */
  update(dt: number, rng: Rng, cursor: Point | null, nowSeconds: number): { arrived: boolean } {
    let arrived = false

    // Vertical physics (jumps / drops) - only on floor mode.
    if (this.airborne) {
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      if (this.y >= this.floorY()) {
        this.y = this.floorY()
        this.vy = 0
        this.airborne = false
      }
    }

    if (this.mode === 'none' || !this.target) {
      this.vx = 0
      return { arrived: false }
    }

    if (nowSeconds < this.pauseUntil) {
      this.vx = 0
      return { arrived: false }
    }

    // Keep following the cursor while approaching it.
    if (this.mode === 'toCursor') {
      if (cursor) this.pickTarget('toCursor', rng, cursor)
      else return { arrived: true }
    }

    const dx = this.target.x - this.x
    const dy = this.target.y - this.y
    const dist = Math.hypot(dx, dy)
    const stopDistance = this.mode === 'toCursor' ? 48 : this.mode === 'toPoint' ? 4 : 6

    if (dist <= stopDistance) {
      arrived = true
      this.vx = 0
      if (this.mode === 'chase' && this.chaseHops > 0) {
        this.chaseHops--
        this.pauseUntil = nowSeconds + rng.range(0.15, 0.5)
        this.pickTarget('chase', rng, cursor)
        arrived = false
      } else if (this.mode === 'zoom') {
        this.pickTarget('zoom', rng, cursor)
        arrived = false
      } else if (this.mode === 'walk' && rng.chance(0.5)) {
        // stop for a moment, then wander somewhere else
        this.pauseUntil = nowSeconds + rng.range(0.6, 2)
        this.pickTarget('walk', rng, cursor)
        arrived = false
      }
      return { arrived }
    }

    // Occasional brief stops mid-walk for a natural feel.
    if (this.mode === 'walk' && rng.chance(0.004)) {
      this.pauseUntil = nowSeconds + rng.range(0.4, 1.2)
    }

    const step = Math.min(dist, this.speed * dt)
    this.x += (dx / dist) * step
    if (!this.airborne) this.y += (dy / dist) * step
    this.vx = (dx / dist) * this.speed
    if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1
    this.clampToBounds()
    return { arrived }
  }

  faceToward(x: number): void {
    if (Math.abs(x - this.x) > 4) this.facing = x > this.x ? 1 : -1
  }

  /** Shove the pet horizontally (tug of war skid), staying inside the window. */
  nudge(dx: number): void {
    this.x = Math.max(this.minX(), Math.min(this.maxX(), this.x + dx))
  }

  snapshot(): MovementSnapshot {
    return {
      x: this.x,
      y: this.y,
      facing: this.facing,
      moving: this.mode !== 'none' && Math.abs(this.vx) > 1,
      airborne: this.airborne,
      speed: Math.abs(this.vx)
    }
  }
}
