import { describe, expect, it } from 'vitest'
import { createRng } from '@engine/rng'
import { PetEngine } from '@engine/PetEngine'
import { TrainingEngine, type TrainingContext } from '@engine/TrainingEngine'
import { createPet, normalizePet } from '@models/Pet'
import { SPECIES } from '@models/Species'
import { DEFAULT_STATS } from '@models/PetStats'
import { createTraining, parseUtterance, skillOf, type CommandId } from '@models/Commands'

const env = { width: 1600, height: 900, freeRoam: false, scale: 1, breakReminderMinutes: 90, ownerName: '' }

function makeEngine(speciesId = 'dog', seed = 42): PetEngine {
  const rng = createRng(seed)
  const pet = createPet(speciesId, 'Max', rng.next, 1_000_000)
  return new PetEngine(pet, env, null, rng, 1_000_000)
}

function ctx(speciesId: string, level: number, patch: Partial<TrainingContext> = {}): TrainingContext {
  const species = SPECIES[speciesId]
  const training = createTraining()
  if (level > 0) training.commands.sit = { level, heard: 10, obeyed: 5, lastAt: null }
  return { personality: species.personality, stats: { ...DEFAULT_STATS }, species, currentState: 'IDLE', training, nowMs: 1_000_000, ...patch }
}

describe('parseUtterance', () => {
  it('recognizes commands through the pet name, punctuation, case and fillers', () => {
    expect(parseUtterance('Max, sit!', 'Max')).toMatchObject({ kind: 'command', id: 'sit' })
    expect(parseUtterance(' Sit down please.', 'Max').id).toBe('sit')
    expect(parseUtterance('come here', 'Max').id).toBe('come')
    expect(parseUtterance('Go to bed', 'Max').id).toBe('sleep')
    expect(parseUtterance('GET THE BALL', 'Max').id).toBe('fetch')
    expect(parseUtterance('okay max jump', 'Max').id).toBe('jump')
    expect(parseUtterance('Speak!', 'Mr Biscuit').id).toBe('speak')
  })

  it('leaves conversation alone', () => {
    expect(parseUtterance('do you want to sit with me?', 'Max').kind).toBe('none')
    expect(parseUtterance('I had a good day', 'Max').kind).toBe('none')
    expect(parseUtterance('are you hungry', 'Max').kind).toBe('none')
    expect(parseUtterance('', 'Max').kind).toBe('none')
  })

  it('hears praise, scolds and treats', () => {
    expect(parseUtterance('good boy Max!', 'Max').kind).toBe('praise')
    expect(parseUtterance('Well done', 'Max').kind).toBe('praise')
    expect(parseUtterance('No!', 'Max').kind).toBe('scold')
    expect(parseUtterance('bad dog', 'Max').kind).toBe('scold')
    expect(parseUtterance('treat?', 'Max').kind).toBe('treat')
  })
})

describe('TrainingEngine', () => {
  const engine = new TrainingEngine()

  it('obeys a mastered command far more often than a new one', () => {
    expect(engine.obeyChance(ctx('dog', 0), 'sit')).toBeLessThan(0.3)
    expect(engine.obeyChance(ctx('dog', 100), 'sit')).toBeGreaterThan(0.7)
    expect(engine.obeyChance(ctx('dog', 100), 'sit')).toBeLessThanOrEqual(0.97)
  })

  it('tired pets resist active commands and sleeping pets barely listen', () => {
    const rested = engine.obeyChance(ctx('dog', 80), 'come')
    const tired = engine.obeyChance(ctx('dog', 80, { stats: { ...DEFAULT_STATS, energy: 10 } }), 'come')
    const asleep = engine.obeyChance(ctx('dog', 80, { currentState: 'SLEEPING' }), 'come')
    expect(tired).toBeLessThan(rested * 0.6)
    expect(asleep).toBeLessThan(rested * 0.5)
  })

  it('repetition raises the level, and a clever eager dog learns faster than a lazy cat', () => {
    const rng = createRng(1)
    const dog = ctx('dog', 0)
    const cat = ctx('cat', 0)
    let a = dog.training
    let b = cat.training
    for (let i = 0; i < 30; i++) {
      a = engine.command({ ...dog, training: a, nowMs: i * 1000 }, 'sit', rng).training
      b = engine.command({ ...cat, training: b, nowMs: i * 1000 }, 'sit', rng).training
    }
    expect(skillOf(a, 'sit').heard).toBe(30)
    expect(skillOf(a, 'sit').level).toBeGreaterThan(10)
    expect(skillOf(a, 'sit').level).toBeGreaterThan(skillOf(b, 'sit').level)
    expect(a.total).toBe(30)
  })

  it('praise right after obeying reinforces that command; later it only cheers', () => {
    const rng = createRng(3)
    const c = ctx('dog', 60)
    let t = c.training
    let obeyed = false
    for (let i = 0; i < 60 && !obeyed; i++) {
      const r = engine.command({ ...c, training: t }, 'sit', rng)
      t = r.training
      obeyed = r.obeyed
    }
    expect(obeyed).toBe(true)
    expect(t.lastObeyed?.id).toBe('sit')
    const praised = engine.praise({ ...c, training: t, nowMs: c.nowMs + 5000 }, rng)
    expect(praised.id).toBe('sit')
    expect(praised.after).toBeGreaterThan(praised.before)
    expect(praised.training.lastObeyed).toBeNull()
    const late = engine.praise({ ...c, training: t, nowMs: c.nowMs + 60_000 }, rng)
    expect(late.id).toBeNull()
    expect(late.reaction?.state).toBe('HAPPY')
    expect(late.training).toBe(t)
  })

  it('a scold right after a refusal teaches the boundary and costs a little happiness', () => {
    const rng = createRng(5)
    const c = ctx('cat', 0)
    let t = c.training
    let refused = false
    for (let i = 0; i < 60 && !refused; i++) {
      const r = engine.command({ ...c, training: t }, 'sit', rng)
      t = r.training
      refused = !r.obeyed
    }
    expect(refused).toBe(true)
    const scolded = engine.scold({ ...c, training: t, nowMs: c.nowMs + 3000 }, rng)
    expect(scolded.id).toBe('sit')
    expect(scolded.after).toBeGreaterThan(scolded.before)
    expect(scolded.reaction?.stats.happiness).toBeLessThan(0)
  })

  it('a treat after obeying is the strongest reinforcement and reports milestones', () => {
    const c = ctx('dog', 74)
    c.training.lastObeyed = { id: 'sit', at: c.nowMs - 2000 }
    const r = engine.reward(c)
    expect(r.id).toBe('sit')
    expect(r.after).toBeGreaterThanOrEqual(75)
    expect(r.milestone).toBe('learned')
    expect(r.training.treats).toBe(1)
    const nothing = engine.reward({ ...c, training: createTraining() })
    expect(nothing.id).toBeNull()
  })

  it('treats teach far faster than repetition: mastering takes a handful of treats or dozens of repeats', () => {
    const rng = createRng(9)
    const c = ctx('dog', 0)
    // Repetition only.
    let plain = c.training
    let repeats = 0
    while (skillOf(plain, 'sit').level < 75 && repeats < 500) {
      plain = engine.command({ ...c, training: plain, nowMs: c.nowMs + repeats * 1000 }, 'sit', rng).training
      repeats++
    }
    // Command, then a treat whenever it obeyed.
    let treated = c.training
    let attempts = 0
    let treats = 0
    while (skillOf(treated, 'sit').level < 75 && attempts < 500) {
      const now = c.nowMs + attempts * 1000
      const r = engine.command({ ...c, training: treated, nowMs: now }, 'sit', rng)
      treated = r.training
      if (r.obeyed) {
        treated = engine.reward({ ...c, training: treated, nowMs: now + 3000 }).training
        treats++
      }
      attempts++
    }
    expect(repeats).toBeGreaterThan(40)
    expect(treats).toBeLessThanOrEqual(10)
    expect(attempts).toBeLessThan(repeats / 2)
  })
})

describe('PetEngine commands', () => {
  function teach(engine: PetEngine, id: CommandId, level = 100): void {
    engine.pet.training.commands[id] = { level, heard: 20, obeyed: 18, lastAt: null }
  }

  it('a mastered "sit" makes the pet sit, counts the interaction and asks to save', () => {
    const engine = makeEngine('dog', 11)
    teach(engine, 'sit')
    engine.tick(1_000_100)
    let saves = 0
    engine.on((e) => {
      if (e.type === 'save') saves++
    })
    let obeyed = false
    for (let i = 0; i < 20 && !obeyed; i++) {
      const out = engine.command('Max, sit!')
      expect(out.kind).toBe('command')
      expect(out.id).toBe('sit')
      obeyed = out.obeyed === true
      if (obeyed) expect(engine.currentState()).toBe('SITTING')
    }
    expect(obeyed).toBe(true)
    expect(engine.pet.memory.interactionCounts.command).toBeGreaterThan(0)
    expect(saves).toBeGreaterThan(0)
  })

  it('giving a treat from the inventory reinforces the last obeyed command and uses one up', () => {
    const engine = makeEngine('dog', 16)
    teach(engine, 'sit', 50)
    engine.tick(1_000_100)
    let obeyed = false
    for (let i = 0; i < 40 && !obeyed; i++) obeyed = engine.command('sit').obeyed === true
    expect(obeyed).toBe(true)
    const before = engine.pet.training.commands.sit!.level
    const treats = engine.pet.inventory.treat ?? 0
    expect(treats).toBeGreaterThan(0)
    expect(engine.feed('treat')).toBe(true)
    expect(engine.pet.inventory.treat ?? 0).toBe(treats - 1)
    expect(engine.pet.training.commands.sit!.level).toBeGreaterThan(before)
    expect(engine.pet.training.treats).toBe(1)
    // A second treat right away has nothing to reinforce.
    const level = engine.pet.training.commands.sit!.level
    engine.command('treat')
    expect(engine.pet.training.commands.sit!.level).toBe(level)
    // Out of treats: the voice command "treat" just gets a puzzled pet.
    engine.pet.inventory = {}
    expect(engine.command('treat').treatGiven).toBe(false)
  })

  it('"fetch" starts the fetch game when obeyed', () => {
    const engine = makeEngine('dog', 12)
    teach(engine, 'fetch')
    engine.tick(1_000_100)
    let started = false
    for (let i = 0; i < 20 && !started; i++) started = engine.command('fetch').obeyed === true
    expect(started).toBe(true)
    expect(engine.playMode).toBe('fetch')
  })

  it('"come" heads toward the cursor', () => {
    const engine = makeEngine('dog', 13)
    teach(engine, 'come')
    engine.tick(1_000_100)
    const startX = engine.snapshot().x
    const target = startX < 800 ? 1500 : 100
    engine.setCursor({ x: target, y: 850 })
    let obeyed = false
    for (let i = 0; i < 20 && !obeyed; i++) obeyed = engine.command('come here').obeyed === true
    expect(obeyed).toBe(true)
    let t = 1_000_100
    for (let i = 0; i < 60; i++) {
      t += 1000 / 30
      engine.tick(t)
    }
    const dx = engine.snapshot().x - startX
    expect(Math.sign(dx)).toBe(Math.sign(target - startX))
    expect(Math.abs(dx)).toBeGreaterThan(40)
  })

  it('unknown words are not commands and leave training untouched', () => {
    const engine = makeEngine('dog', 14)
    engine.tick(1_000_100)
    const before = JSON.stringify(engine.pet.training)
    const out = engine.command('hello there, nice weather')
    expect(out.kind).toBe('none')
    expect(JSON.stringify(engine.pet.training)).toBe(before)
  })

  it('training survives a save round-trip and old saves load without it', () => {
    const engine = makeEngine('dog', 15)
    teach(engine, 'dance', 42)
    const restored = normalizePet(JSON.parse(JSON.stringify(engine.toSave())))
    expect(restored?.training.commands.dance?.level).toBe(42)
    const legacy = normalizePet({ id: 'dog-old', speciesId: 'dog', name: 'Old' })
    expect(legacy?.training.commands).toEqual({})
    expect(legacy?.memory.interactionCounts.command).toBe(0)
  })
})
