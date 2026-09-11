import { describe, expect, it } from 'vitest'
import { createRng } from '@engine/rng'
import { PetEngine } from '@engine/PetEngine'
import { createPet } from '@models/Pet'

const env = { width: 1600, height: 900, freeRoam: false, scale: 1, breakReminderMinutes: 0, ownerName: '' }

function makeEngine(speciesId: string, seed = 5): { engine: PetEngine; t: number } {
  const rng = createRng(seed)
  const pet = createPet(speciesId, 'T', rng.next, 1_000_000)
  pet.personality.laziness = 0 // deterministic: never ignores a throw
  pet.personality.mischief = 0 // never keeps the ball
  const engine = new PetEngine(pet, env, { x: 300, y: 900 }, rng, 1_000_000)
  return { engine, t: 1_000_000 }
}

function run(engine: PetEngine, t: number, seconds: number, onTick?: (state: string, ms: number) => void): number {
  const step = 1000 / 60
  for (let i = 0; i < (seconds * 1000) / step; i++) {
    t += step
    engine.setCursor({ x: 300, y: 700 })
    const snap = engine.tick(t)
    onTick?.(snap.state, t)
  }
  return t
}

describe('fetch', () => {
  it('pet chases a thrown ball, grabs it and brings it back', () => {
    const { engine } = makeEngine('dog')
    let t = 1_000_000
    engine.setCursor({ x: 300, y: 700 })
    t = run(engine, t, 0.5)
    engine.startFetch()
    expect(engine.playMode).toBe('fetch')
    expect(engine.snapshot().play?.ball?.held).toBe('cursor')

    // flick the ball to the right: pointer down, move fast, release
    engine.playPointerDown(300, 700)
    engine.playPointerMove(320, 690)
    t += 30
    engine.tick(t)
    engine.playPointerMove(380, 670)
    t += 30
    engine.tick(t)
    engine.playPointerUp(380, 670)
    const ball = engine.snapshot().play!.ball!
    expect(ball.held).toBe('free')

    const seen = new Set<string>()
    let ballHeldByPet = false
    let returned = false
    run(engine, t, 8, (state) => {
      seen.add(state)
      const play = engine.snapshot().play
      if (play?.ball?.held === 'pet') ballHeldByPet = true
      if (play?.phase === 'drop') returned = true
    })
    expect(seen.has('FETCHING')).toBe(true)
    expect(ballHeldByPet).toBe(true)
    expect(returned).toBe(true)
    expect(engine.pet.memory.gamesPlayed).toBeGreaterThanOrEqual(1)

    engine.stopPlay()
    expect(engine.playMode).toBe('none')
    expect(engine.snapshot().play).toBeNull()
  })

  it('ball physics stays inside the window and settles', () => {
    const { engine } = makeEngine('cat')
    let t = 1_000_000
    engine.setCursor({ x: 100, y: 200 })
    engine.tick(t)
    engine.startFetch()
    engine.playPointerDown(100, 200)
    engine.playPointerMove(140, 190)
    t += 20
    engine.tick(t)
    engine.playPointerUp(140, 190) // ~2000 px/s to the right
    let maxX = 0
    let minY = Infinity
    run(engine, t, 6, () => {
      const b = engine.snapshot().play?.ball
      if (b && b.held === 'free') {
        maxX = Math.max(maxX, b.x)
        minY = Math.min(minY, b.y)
        expect(b.x).toBeLessThanOrEqual(env.width)
        expect(b.y).toBeLessThanOrEqual(env.height)
      }
    })
    expect(maxX).toBeGreaterThan(200)
    expect(minY).toBeGreaterThanOrEqual(0)
  })
})

describe('tug of war', () => {
  it('pet wins a round when the player lets go, player wins by pulling', () => {
    const { engine } = makeEngine('dog')
    let t = 1_000_000
    engine.setCursor({ x: 300, y: 850 })
    t = run(engine, t, 0.3)
    engine.startTug()
    const tug = engine.snapshot().play!.tug!
    expect(engine.snapshot().state).toBe('TUGGING')

    // grab the handle, then let go: pet wins
    engine.playPointerDown(tug.handle.x, tug.handle.y)
    expect(engine.snapshot().play!.phase).toBe('pulling')
    engine.playPointerUp(tug.handle.x, tug.handle.y)
    t += 1000 / 60
    engine.tick(t)
    expect(engine.snapshot().play!.tug!.rounds.pet).toBe(1)
    expect(engine.snapshot().play!.phase).toBe('petWon')

    // wait for idle, then pull hard: player wins
    for (let i = 0; i < 60 * 3; i++) {
      t += 1000 / 60
      engine.tick(t)
    }
    expect(engine.snapshot().play!.phase).toBe('idle')
    const h = engine.snapshot().play!.tug!.handle
    engine.playPointerDown(h.x, h.y)
    let x = h.x
    let won = false
    for (let i = 0; i < 60 * 20 && !won; i++) {
      t += 1000 / 60
      x += 9 * Math.sign(h.x - engine.snapshot().x || 1) // keep pulling away from the pet
      x = Math.max(20, Math.min(env.width - 20, x))
      engine.setCursor({ x, y: h.y })
      engine.playPointerMove(x, h.y)
      engine.tick(t)
      won = engine.snapshot().play!.phase === 'userWon'
    }
    expect(won).toBe(true)
    expect(engine.snapshot().play!.tug!.rounds.user).toBe(1)
    expect(engine.pet.memory.gamesPlayed).toBe(2)
  })
})
