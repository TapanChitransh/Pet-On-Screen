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
  /** smoothed horizontal acceleration in px/s² (signed); renderers lean the body into it */
  accel: number
  /** px above the ground the pet stands on (0 when grounded) */
  height: number
  /** downward speed at the most recent landing in px/s (0 until it has landed) */
  impact: number
  /** increments on every landing so a renderer can react to it exactly once */
  landKey: number
}

const GRAVITY = 1800
const EDGE_MARGIN = 12
/** Seconds to reach cruising speed from standing; braking is quicker. */
const ACCEL_TIME = 0.28
const BRAKE_TIME = 0.16
/** Above this speed the pet keeps facing the way it is sliding (skid turn) instead of its target. */
const TURN_SPEED = 25
/** How far (px at any scale) a placed pet may wander left/right of the spot it was put down. */
export const PERCH_RANGE = 90

/** Move `v` toward `target` by at most `maxDelta`. */
function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v
  if (Math.abs(d) <= maxDelta) return target
  return v + Math.sign(d) * maxDelta
}

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
  /** vertical cruising velocity in free roam (separate from the jump/drop velocity `vy`) */
  private vyMove = 0
  /** smoothed horizontal acceleration (px/s²), read by PetEngine for the body lean */
  accel = 0
  private impact = 0
  private landKey = 0
  /**
   * Where the user put the pet down. While set, this is the pet's ground: gravity lands it here and it
   * only wanders a little to either side, so it stays where it was placed.
   */
  private perch: Point | null = null

  constructor(private style: MovementStyle) {}

  setStyle(style: MovementStyle): void {
    this.style = style
  }

  setBounds(b: MovementBounds): void {
    const wasFloor = this.isOnFloor()
    this.bounds = b
    if (this.perch) this.perch = { x: Math.max(EDGE_MARGIN, Math.min(b.width - EDGE_MARGIN, this.perch.x)), y: Math.min(b.height, this.perch.y) }
    this.clampToBounds()
    if (!b.freeRoam && wasFloor) this.y = this.floorY()
    if (!b.freeRoam && this.y > this.floorY()) this.y = this.floorY()
  }

  /** The ground the pet stands on: the spot it was placed at, or the bottom of the work area. */
  floorY(): number {
    return this.perch ? this.perch.y : this.bounds.height
  }

  /** The bottom of the work area, regardless of any perch. */
  bottomY(): number {
    return this.bounds.height
  }

  setPerch(p: Point | null): void {
    this.perch = p ? { x: p.x, y: Math.min(this.bounds.height, p.y) } : null
  }

  getPerch(): Point | null {
    return this.perch
  }

  minX(): number {
    const lo = this.bounds.halfWidth + EDGE_MARGIN
    return this.perch ? Math.max(lo, Math.min(this.perch.x, this.maxScreenX()) - PERCH_RANGE) : lo
  }

  maxX(): number {
    const hi = this.maxScreenX()
    return this.perch ? Math.min(hi, Math.max(this.perch.x, this.bounds.halfWidth + EDGE_MARGIN) + PERCH_RANGE) : hi
  }

  private maxScreenX(): number {
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
    this.vyMove = 0
    this.accel = 0
    this.target = null
    this.clampToBounds()
  }

  /** Keep the pet inside the window. The floor is enforced by gravity, not here, so drags can lift the pet. */
  clampToBounds(): void {
    const x = Math.max(this.minX(), Math.min(this.maxX(), this.x))
    if (x !== this.x) this.vx = 0
    this.x = x
    this.y = Math.max(this.bounds.petHeight * 0.5, Math.min(this.floorY(), this.y))
  }

  private pointTarget: Point | null = null

  /** Start a fresh movement behavior. `speed` overrides the mode's default speed (px/s). */
  begin(mode: MovementMode, rng: Rng, cursor: Point | null, speed?: number): void {
    this.mode = mode
    this.target = null
    this.pauseUntil = 0
    this.chaseHops = mode === 'chase' ? rng.int(3, 6) : 0
    // 'none' keeps the current velocity: update() brakes it to a stop instead of freezing mid-stride.
    if (mode === 'none') return
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
      y: this.bounds.freeRoam && !this.perch ? Math.max(this.minY(), Math.min(this.floorY(), p.y)) : this.floorY()
    }
  }

  /** End the current movement; the pet brakes to a stop over the next few frames. */
  stop(): void {
    this.mode = 'none'
    this.target = null
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
    if (!this.bounds.freeRoam || this.perch) return this.floorY()
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
            y: this.bounds.freeRoam && !this.perch ? Math.max(this.minY(), Math.min(this.floorY(), cursor.y)) : this.floorY()
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
   *
   * Horizontal motion has momentum: velocity ramps up over ACCEL_TIME, eases out over the last
   * few tens of pixels before a destination and brakes (rather than freezing) when a movement ends.
   */
  update(dt: number, rng: Rng, cursor: Point | null, nowSeconds: number): { arrived: boolean } {
    let arrived = false
    const prevVx = this.vx

    // Vertical physics (jumps / drops) - only on floor mode.
    if (this.airborne) {
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      if (this.y >= this.floorY()) {
        this.impact = Math.max(0, this.vy)
        this.landKey++
        this.y = this.floorY()
        this.vy = 0
        this.airborne = false
      }
    }

    // Keep following the cursor while approaching it.
    if (this.mode === 'toCursor' && this.target) {
      if (cursor) this.pickTarget('toCursor', rng, cursor)
      else {
        this.coast(dt, prevVx)
        return { arrived: true }
      }
    }

    const paused = nowSeconds < this.pauseUntil
    if (this.mode === 'none' || !this.target || paused) {
      this.coast(dt, prevVx)
      return { arrived: false }
    }

    const dx = this.target.x - this.x
    const dy = this.target.y - this.y
    const dist = Math.hypot(dx, dy)
    const stopDistance = this.mode === 'toCursor' ? 48 : this.mode === 'toPoint' ? 4 : 6

    if (dist <= stopDistance) {
      arrived = true
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
      this.coast(dt, prevVx)
      return { arrived }
    }

    // Occasional brief stops mid-walk for a natural feel.
    if (this.mode === 'walk' && rng.chance(0.004)) {
      this.pauseUntil = nowSeconds + rng.range(0.4, 1.2)
    }

    // Ease out over the last stretch so the pet settles at its destination instead of overshooting.
    const brake = Math.max(20, this.speed * 0.3)
    const want = this.speed * Math.max(0.12, Math.min(1, dist / brake))
    const ux = dx / dist
    const uy = dy / dist
    const accel = this.speed / ACCEL_TIME
    this.vx = approach(this.vx, ux * want, accel * dt)
    const stepX = this.vx * dt
    this.x = Math.abs(stepX) >= Math.abs(dx) ? this.target.x : this.x + stepX
    if (!this.airborne && dy !== 0) {
      this.vyMove = approach(this.vyMove, uy * want, accel * dt)
      const stepY = this.vyMove * dt
      this.y = Math.abs(stepY) >= Math.abs(dy) ? this.target.y : this.y + stepY
    } else this.vyMove = 0
    this.updateFacing(dx)
    this.trackAccel(prevVx, dt)
    this.clampToBounds()
    return { arrived }
  }

  /** No destination: brake to a stop with the momentum of the last movement. */
  private coast(dt: number, prevVx: number): void {
    const decel = Math.max(this.speed, 60) / BRAKE_TIME
    this.vx = approach(this.vx, 0, decel * dt)
    this.vyMove = approach(this.vyMove, 0, decel * dt)
    if (this.vx !== 0) {
      this.x += this.vx * dt
      this.clampToBounds()
    }
    if (this.vyMove !== 0 && !this.airborne) {
      this.y = Math.max(this.minY(), Math.min(this.floorY(), this.y + this.vyMove * dt))
    }
    this.updateFacing(0)
    this.trackAccel(prevVx, dt)
  }

  /** Skid turn: while still sliding fast the pet faces the way it moves; once slow it faces its target. */
  private updateFacing(dx: number): void {
    if (Math.abs(this.vx) > TURN_SPEED) this.facing = this.vx > 0 ? 1 : -1
    else if (Math.abs(dx) > 2) this.facing = dx > 0 ? 1 : -1
  }

  private trackAccel(prevVx: number, dt: number): void {
    if (dt <= 0) return
    const a = (this.vx - prevVx) / dt
    this.accel += (a - this.accel) * Math.min(1, dt * 12)
    if (Math.abs(this.accel) < 1) this.accel = 0
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
      moving: Math.abs(this.vx) > 1 || Math.abs(this.vyMove) > 1,
      airborne: this.airborne,
      speed: Math.hypot(this.vx, this.vyMove),
      accel: this.accel,
      height: Math.max(0, this.floorY() - this.y),
      impact: this.impact,
      landKey: this.landKey
    }
  }
}
