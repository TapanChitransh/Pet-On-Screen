import { describe, expect, it } from 'vitest'
import { createRng } from '@engine/rng'
import { PetEngine } from '@engine/PetEngine'
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

  it('falls back to the floor after being dropped', () => {
    const engine = makeEngine('rabbit')
    engine.tick(1_000_100)
    engine.dragStart()
    engine.dragMove(500, 300)
    engine.dragEnd()
    expect(engine.currentState()).toBe('FALLING')
    const seen = runFor(engine, 3, 1_000_100)
    expect(seen.has('FALLING')).toBe(true)
    const snap = engine.snapshot()
    expect(snap.y).toBe(env.height)
    expect(snap.state).not.toBe('FALLING')
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
