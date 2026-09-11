import { describe, expect, it } from 'vitest'
import { DEFAULT_NAMES, SPECIES_LIST } from '@models/Species'
import { ITEMS } from '@models/Items'
import { BEHAVIORS } from '@models/Behavior'
import { createPet } from '@models/Pet'
import { PetEngine } from '@engine/PetEngine'
import { createRng } from '@engine/rng'

const STATES = new Set<string>([...BEHAVIORS.map((b) => b.state), 'ZOOMIES', 'CHASING', 'CELEBRATING', 'SCARED', 'ANNOYED', 'WATCHING', 'HIDING', 'DANCING', 'FETCHING', 'CARRYING', 'TUGGING'])

describe('species catalogue', () => {
  it('has twenty-four characters including one person', () => {
    expect(SPECIES_LIST.length).toBe(24)
    expect(SPECIES_LIST.filter((s) => s.kind === 'person').length).toBe(1)
  })

  it('references only real items and states, and has default names', () => {
    for (const s of SPECIES_LIST) {
      for (const f of s.favoriteFoods) expect(ITEMS[f]?.kind, `${s.id} food ${f}`).toBe('food')
      for (const t of s.favoriteToys) expect(ITEMS[t]?.kind, `${s.id} toy ${t}`).toBe('toy')
      for (const state of Object.keys(s.behaviorBias)) expect(STATES.has(state), `${s.id} bias ${state}`).toBe(true)
      expect(DEFAULT_NAMES[s.id]?.length, `${s.id} names`).toBeGreaterThan(0)
      expect(s.voice.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('every species runs in the engine and moves', () => {
    for (const s of SPECIES_LIST) {
      const rng = createRng(11)
      const engine = new PetEngine(createPet(s.id, 'T', rng.next, 1_000_000), { width: 1400, height: 800, freeRoam: false, scale: 1, breakReminderMinutes: 0, ownerName: '' }, null, rng, 1_000_000)
      const seen = new Set<string>()
      let t = 1_000_000
      for (let i = 0; i < 30 * 240; i++) {
        t += 1000 / 30
        seen.add(engine.tick(t).state)
      }
      expect(seen.size, s.id).toBeGreaterThanOrEqual(4)
      if (s.behaviorBias.GROOMING === 0) expect(seen.has('GROOMING'), `${s.id} should never groom`).toBe(false)
    }
  })
})
