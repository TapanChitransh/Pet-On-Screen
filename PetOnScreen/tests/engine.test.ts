import { describe, expect, it } from 'vitest'
import { createRng } from '@engine/rng'
import { PetEngine } from '@engine/PetEngine'
import { MovementEngine, PERCH_RANGE } from '@engine/MovementEngine'
import { BehaviorEngine } from '@engine/BehaviorEngine'
import { PersonalityEngine } from '@engine/PersonalityEngine'
import { createPet } from '@models/Pet'
import { SPECIES } from '@models/Species'
import { createMemory } from '@models/Memory'
import { DEFAULT_STATS, moodFor } from '@models/PetStats'
import type { BehaviorState, DecisionContext } from '@models/Behavior'

const env = { width: 1600, height: 900, freeRoam: false, scale: 1, breakReminderMinutes: 90, ownerName: '' }

function makeEngine(speciesId = 'dog', seed = 42): PetEngine {
  const rng = createRng(seed)
  const pet = createPet(speciesId, 'Test', rng.next, 1_000_000)
  return new PetEngine(pet, env, null, rng, 1_000_000)
}

function runFor(engine: PetEngine, seconds: number, startMs = 1_000_000): Set<BehaviorState> {
  const seen = new Set<BehaviorState>()
  let t = startMs
  const step = 1000 / 30
  for (let i = 0; i < (seconds * 1000) / step; i++) {
    t += step
    const snap = engine.tick(t)
    seen.add(snap.state)
    expect(snap.x).toBeGreaterThanOrEqual(0)
    expect(snap.x).toBeLessThanOrEqual(env.width)
    expect(snap.y).toBeLessThanOrEqual(env.height)
  }
  return seen
}

describe('PetEngine autonomous behavior', () => {
  it('cycles through a variety of behaviors on its own and stays on screen', () => {
    const engine = makeEngine('dog')
    const seen = runFor(engine, 20 * 60)
    expect(seen.size).toBeGreaterThanOrEqual(6)
    expect(seen.has('WALKING')).toBe(true)
    expect(seen.has('IDLE')).toBe(true)
  })

  it('does not pick uniformly: idle and walking dominate', () => {
    const engine = makeEngine('dog', 7)
    const counts: Record<string, number> = {}
    let t = 1_000_000
    let last = ''
    for (let i = 0; i < 30 * 60 * 30; i++) {
      t += 1000 / 30
      const s = engine.tick(t).state
      if (s !== last) {
        counts[s] = (counts[s] ?? 0) + 1
        last = s
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect((counts.IDLE ?? 0) / total).toBeGreaterThan(0.12)
    expect((counts.DANCING ?? 0) / total).toBeLessThan(0.05)
  })

  it('stats drift slowly and never collapse', () => {
    const engine = makeEngine('cat')
    runFor(engine, 60 * 60)
    const s = engine.pet.stats
    expect(s.health).toBeGreaterThan(90)
    expect(s.hunger).toBeLessThan(100)
    expect(s.happiness).toBeGreaterThan(30)
  })

  it('reacts to interactions and remembers them', () => {
    const engine = makeEngine('dog')
    engine.tick(1_000_100)
    const before = engine.pet.stats.happiness
    engine.petIt()
    expect(engine.currentState()).toMatch(/HAPPY|ANNOYED/)
    expect(engine.pet.stats.happiness).toBeGreaterThan(before)
    expect(engine.pet.memory.interactionCounts.pet).toBe(1)
    expect(engine.pet.memory.totalInteractions).toBe(1)
  })

  it('feeding consumes finite items but never kibble', () => {
    const engine = makeEngine('dog')
    engine.tick(1_000_100)
    engine.pet.stats.hunger = 60
    expect(engine.feed('treat')).toBe(true)
    expect(engine.pet.inventory.treat).toBe(2)
    expect(engine.feed('kibble')).toBe(true)
    expect(engine.feed('bamboo')).toBe(false)
  })

  it('click reactions vary', () => {
    const engine = makeEngine('fox', 3)
    const states = new Set<string>()
    let t = 1_000_000
    for (let i = 0; i < 40; i++) {
      t += 4000
      engine.tick(t)
      engine.click()
      states.add(engine.currentState())
    }
    expect(states.size).toBeGreaterThanOrEqual(3)
  })

  it('stays where it was put down, and falls once released', () => {
    const engine = makeEngine('rabbit')
    engine.tick(1_000_100)
    engine.dragStart()
    engine.dragMove(500, 300)
    engine.dragEnd()
    expect(engine.isPerched()).toBe(true)
    runFor(engine, 60, 1_000_100)
    let snap = engine.snapshot()
    expect(snap.y).toBe(300)
    expect(Math.abs(snap.x - 500)).toBeLessThanOrEqual(PERCH_RANGE + 1)
    expect(snap.perched).toBe(true)

    engine.releasePerch()
    expect(engine.currentState()).toBe('FALLING')
    const seen = runFor(engine, 3, 1_000_100 + 60_000)
    expect(seen.has('FALLING')).toBe(true)
    snap = engine.snapshot()
    expect(snap.y).toBe(env.height)
    expect(snap.perched).toBe(false)
  })

  it('remembers the spot across restarts', () => {
    const engine = makeEngine('dog')
    engine.tick(1_000_100)
    engine.dragStart()
    engine.dragMove(400, 250)
    engine.dragEnd()
    const pos = engine.positionFraction()
    expect(pos.perched).toBe(true)
    const restored = new PetEngine(engine.toSave(), env, { x: pos.fx * env.width, y: pos.fy * env.height, perched: true }, createRng(1), Date.now())
    expect(restored.isPerched()).toBe(true)
    expect(restored.snapshot().y).toBeCloseTo(250, 0)
  })

  it('serializes and restores', () => {
    const engine = makeEngine('panda')
    runFor(engine, 30)
    const save = engine.toSave()
    const restored = new PetEngine(save, env, null, createRng(1), save.lastSeenAt + 1000)
    expect(restored.pet.name).toBe('Test')
    expect(restored.pet.stats.energy).toBeCloseTo(save.stats.energy, 0)
  })
})

describe('lifelike motion', () => {
  const bounds = { width: 1600, height: 900, halfWidth: 42, petHeight: 110, freeRoam: false }

  it('accelerates to speed and brakes into its destination instead of teleporting between speeds', () => {
    const rng = createRng(3)
    const m = new MovementEngine(SPECIES.dog.movement)
    m.setBounds(bounds)
    m.place(300, 900)
    m.begin('toPoint', rng, null, 120)
    m.setPointTarget({ x: 900, y: 900 })
    const dt = 1 / 30
    let t = 0
    m.update(dt, rng, null, (t += dt))
    expect(m.snapshot().speed).toBeLessThan(60)
    let peak = 0
    for (let i = 0; i < 20; i++) {
      m.update(dt, rng, null, (t += dt))
      peak = Math.max(peak, m.snapshot().speed)
    }
    expect(peak).toBeGreaterThan(115)
    expect(peak).toBeLessThanOrEqual(120.5)
    let arrived = false
    for (let i = 0; i < 300 && !arrived; i++) arrived = m.update(dt, rng, null, (t += dt)).arrived
    expect(arrived).toBe(true)
    expect(Math.abs(m.x - 900)).toBeLessThanOrEqual(4)
    expect(m.snapshot().speed).toBeLessThan(40)
  })

  it('keeps facing the way it slides while braking, then turns (skid turn)', () => {
    const rng = createRng(4)
    const m = new MovementEngine(SPECIES.dog.movement)
    m.setBounds(bounds)
    m.place(400, 900)
    m.begin('toPoint', rng, null, 160)
    m.setPointTarget({ x: 1200, y: 900 })
    const dt = 1 / 30
    let t = 0
    for (let i = 0; i < 30; i++) m.update(dt, rng, null, (t += dt))
    expect(m.facing).toBe(1)
    m.setPointTarget({ x: 100, y: 900 })
    m.update(dt, rng, null, (t += dt))
    expect(m.facing).toBe(1)
    expect(m.vx).toBeGreaterThan(0)
    let turnedAt = -1
    for (let i = 0; i < 30; i++) {
      m.update(dt, rng, null, (t += dt))
      if (m.facing === -1) {
        turnedAt = i
        break
      }
    }
    expect(turnedAt).toBeGreaterThan(0)
    expect(turnedAt).toBeLessThan(20)
  })

  it('reports the impact of a landing and its height while airborne', () => {
    const rng = createRng(5)
    const m = new MovementEngine(SPECIES.cat.movement)
    m.setBounds(bounds)
    m.place(500, 600)
    expect(m.snapshot().height).toBeCloseTo(300, 0)
    m.drop()
    expect(m.airborne).toBe(true)
    const dt = 1 / 60
    let t = 0
    for (let i = 0; i < 240 && m.airborne; i++) m.update(dt, rng, null, (t += dt))
    const snap = m.snapshot()
    expect(snap.airborne).toBe(false)
    expect(snap.height).toBe(0)
    expect(snap.landKey).toBe(1)
    expect(snap.impact).toBeGreaterThan(900)
  })

  it('gets out of breath running and recovers at rest', () => {
    const engine = makeEngine('dog', 11)
    engine.tick(1_000_100)
    engine.debugActivity('RUNNING', 'run', 6)
    let t = 1_000_100
    for (let i = 0; i < 30 * 6; i++) {
      if (engine.currentState() !== 'RUNNING') engine.debugActivity('RUNNING', 'run', 6)
      engine.tick((t += 1000 / 30))
    }
    const winded = engine.snapshot().exertion
    expect(winded).toBeGreaterThan(0.6)
    engine.debugActivity('SITTING', 'none', 60)
    for (let i = 0; i < 30 * 25; i++) engine.tick((t += 1000 / 30))
    expect(engine.snapshot().exertion).toBeLessThan(winded * 0.3)
  })

  it('notices a moving cursor after a short delay, ears first, and loses interest when it stops', () => {
    const engine = makeEngine('rabbit', 13)
    let t = 1_000_100
    engine.debugActivity('SITTING', 'none', 120)
    engine.tick(t)
    const pet = engine.snapshot()
    engine.setCursor({ x: pet.x + 120, y: pet.y - 40 })
    let snap = engine.tick((t += 1000 / 30))
    expect(snap.attention).toBe('ear')
    expect(snap.lookAt).toBeNull()
    for (let i = 0; i < 20; i++) snap = engine.tick((t += 1000 / 30))
    expect(snap.attention).toBe('look')
    expect(snap.lookAt).not.toBeNull()
    expect(snap.lookAt!.dx).toBeGreaterThan(0)
    // the cursor sits still: interest fades
    for (let i = 0; i < 30 * 15; i++) snap = engine.tick((t += 1000 / 30))
    const engaged = ['WATCHING', 'CURIOUS', 'CHASING'].includes(snap.state)
    if (!engaged) expect(snap.attention).toBe('none')
  })

  it('does not react to a hover on the same frame', () => {
    let immediate = 0
    let later = 0
    for (let seed = 1; seed <= 12; seed++) {
      const engine = makeEngine('cat', seed)
      let t = 1_000_100
      engine.debugActivity('IDLE', 'none', 30)
      engine.tick(t)
      engine.hoverEnter()
      if (engine.tick((t += 1000 / 30)).state === 'WATCHING') immediate++
      for (let i = 0; i < 20; i++) engine.tick((t += 1000 / 30))
      if (engine.currentState() === 'WATCHING') later++
    }
    expect(immediate).toBe(0)
    expect(later).toBeGreaterThan(0)
  })

  it('leans into acceleration and swings while carried', () => {
    const engine = makeEngine('dog', 17)
    let t = 1_000_100
    engine.tick(t)
    engine.debugActivity('RUNNING', 'run', 6)
    let maxLean = 0
    for (let i = 0; i < 15; i++) maxLean = Math.max(maxLean, Math.abs(engine.tick((t += 1000 / 30)).lean))
    expect(maxLean).toBeGreaterThan(2)

    engine.dragStart()
    let ms = t
    let x = 600
    for (let i = 0; i < 20; i++) {
      ms += 16
      x += 20
      engine.dragMove(x, 400, ms)
      engine.tick(ms)
    }
    const carried = engine.snapshot()
    expect(carried.state).toBe('DRAGGED')
    expect(carried.lean).toBeGreaterThan(8)
    expect(carried.height).toBeGreaterThan(400)
    engine.dragEnd()
  })
})

describe('BehaviorEngine weights', () => {
  const ctx = (over: Partial<DecisionContext> = {}): DecisionContext => ({
    personality: SPECIES.cat.personality,
    stats: { ...DEFAULT_STATS },
    mood: moodFor(DEFAULT_STATS),
    memory: createMemory(),
    previousState: 'IDLE',
    idleSeconds: 0,
    activeSeconds: 0,
    cursorOnDisplay: true,
    cursorMoving: false,
    cursorNear: false,
    sinceInteraction: Infinity,
    hourOfDay: 12,
    speciesBias: SPECIES.cat.behaviorBias,
    freeRoam: false,
    ...over
  })

  it('a hungry pet strongly prefers eating', () => {
    const be = new BehaviorEngine(new PersonalityEngine())
    const full = be.weigh(ctx({ stats: { ...DEFAULT_STATS, hunger: 10 } }), 0).find((w) => w.def.state === 'EATING')!
    const hungry = be.weigh(ctx({ stats: { ...DEFAULT_STATS, hunger: 90 } }), 0).find((w) => w.def.state === 'EATING')!
    expect(full.weight).toBe(0)
    expect(hungry.weight).toBeGreaterThan(20)
  })

  it('cooldowns block repeats except for urgent needs', () => {
    const be = new BehaviorEngine(new PersonalityEngine())
    be.markEnded('SLEEPING', 100)
    const rested = be.weigh(ctx({ stats: { ...DEFAULT_STATS, energy: 90 } }), 200).find((w) => w.def.state === 'SLEEPING')!
    const exhausted = be.weigh(ctx({ stats: { ...DEFAULT_STATS, energy: 5 } }), 200).find((w) => w.def.state === 'SLEEPING')!
    expect(rested.weight).toBe(0)
    expect(exhausted.weight).toBeGreaterThan(0)
  })

  it('lazy cats sleep more than energetic dogs', () => {
    const be = new BehaviorEngine(new PersonalityEngine())
    const cat = be.weigh(ctx(), 0).find((w) => w.def.state === 'SLEEPING')!.weight
    const dog = be
      .weigh(ctx({ personality: SPECIES.dog.personality, speciesBias: SPECIES.dog.behaviorBias }), 0)
      .find((w) => w.def.state === 'SLEEPING')!.weight
    expect(cat).toBeGreaterThan(dog)
  })
})
