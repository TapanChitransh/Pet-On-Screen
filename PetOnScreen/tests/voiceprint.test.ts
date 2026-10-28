import { describe, expect, it } from 'vitest'
import { createRng } from '@engine/rng'
import { PetEngine } from '@engine/PetEngine'
import { TrainingEngine, type TrainingContext } from '@engine/TrainingEngine'
import { EMBEDDING_SIZE, embedUtterance, enrollOwner, identifySpeaker, MIN_OWNER_SAMPLES, ownerConfidence, ownerDistance, SAMPLE_RATE } from '@engine/Voiceprint'
import { createPet, normalizePet } from '@models/Pet'
import { SPECIES } from '@models/Species'
import { DEFAULT_STATS } from '@models/PetStats'
import { createTraining, type OwnerVoice } from '@models/Commands'

/**
 * A crude synthetic "voice": a glottal pulse train at f0 with a few formant resonances, a vowel
 * sequence, and some breath noise. Two voices differ in pitch and formant placement the way an
 * adult male and an adult female (or a child) would.
 */
interface Voice {
  f0: number
  formants: [number, number, number][]
  breath: number
}

const LOW_VOICE: Voice = { f0: 115, formants: [[700, 1200, 2600], [300, 2200, 3000], [500, 900, 2500]], breath: 0.03 }
const HIGH_VOICE: Voice = { f0: 215, formants: [[850, 1500, 2900], [380, 2700, 3300], [600, 1100, 2800]], breath: 0.03 }

function synth(voice: Voice, seed: number, seconds = 1.2): Float32Array {
  const rng = createRng(seed)
  const n = Math.floor(seconds * SAMPLE_RATE)
  const out = new Float32Array(n)
  const f0 = voice.f0 * (0.94 + rng.next() * 0.12)
  const vowelLen = Math.floor(n / voice.formants.length)
  // 2nd-order resonators (biquad band-pass) per formant, excited by a pulse train + noise.
  const states = voice.formants[0].map(() => ({ y1: 0, y2: 0 }))
  let phase = 0
  for (let i = 0; i < n; i++) {
    const vowel = voice.formants[Math.min(voice.formants.length - 1, Math.floor(i / vowelLen))]
    const t = i / SAMPLE_RATE
    const vibrato = 1 + 0.015 * Math.sin(2 * Math.PI * 5.5 * t)
    phase += (f0 * vibrato) / SAMPLE_RATE
    let src = (rng.next() * 2 - 1) * voice.breath
    if (phase >= 1) {
      phase -= 1
      src += 1
    }
    let y = 0
    for (let k = 0; k < vowel.length; k++) {
      const fc = vowel[k] * (0.97 + rng.next() * 0.06)
      const bw = 90 + k * 40
      const r = Math.exp((-Math.PI * bw) / SAMPLE_RATE)
      const theta = (2 * Math.PI * fc) / SAMPLE_RATE
      const a1 = 2 * r * Math.cos(theta)
      const a2 = -r * r
      const st = states[k]
      const v = src + a1 * st.y1 + a2 * st.y2
      st.y2 = st.y1
      st.y1 = v
      y += v * (1 - r) * (k === 0 ? 1 : 0.6 / k)
    }
    // Amplitude envelope so the clip has an onset, a body and a tail like a word.
    const env = Math.min(1, i / 800, (n - i) / 1600)
    out[i] = y * env * 0.4
  }
  return out
}

describe('Voiceprint', () => {
  it('turns speech-like audio into a fixed-size embedding and rejects silence', () => {
    const e = embedUtterance(synth(LOW_VOICE, 1))
    expect(e).not.toBeNull()
    expect(e!.length).toBe(EMBEDDING_SIZE)
    expect(e!.every((v) => Number.isFinite(v))).toBe(true)
    expect(embedUtterance(new Float32Array(SAMPLE_RATE))).toBeNull()
    expect(embedUtterance(new Float32Array(100))).toBeNull()
  })

  it('is insensitive to loudness', () => {
    const clip = synth(LOW_VOICE, 2)
    const quiet = clip.map((v) => v * 0.2)
    const a = embedUtterance(clip)!
    const b = embedUtterance(quiet)!
    const owner = enrollOwner(enrollOwner(enrollOwner(null, a), embedUtterance(synth(LOW_VOICE, 3))!), embedUtterance(synth(LOW_VOICE, 4))!)
    expect(ownerDistance(owner, b)).toBeLessThan(ownerDistance(owner, embedUtterance(synth(HIGH_VOICE, 5))!))
  })

  it('learns an owner from a few rewarded utterances and tells a different voice apart', () => {
    let owner: OwnerVoice | null = null
    for (let i = 0; i < 4; i++) owner = enrollOwner(owner, embedUtterance(synth(LOW_VOICE, 10 + i))!)
    expect(owner!.n).toBe(4)
    expect(ownerConfidence(owner)).toBeGreaterThan(0)
    const same = identifySpeaker(owner, embedUtterance(synth(LOW_VOICE, 99)))
    const other = identifySpeaker(owner, embedUtterance(synth(HIGH_VOICE, 98)))
    expect(same.speaker).toBe('owner')
    expect(other.speaker).toBe('stranger')
    expect(other.distance!).toBeGreaterThan(same.distance!)
  })

  it('does not judge anyone before it has enough samples', () => {
    const owner = enrollOwner(null, embedUtterance(synth(LOW_VOICE, 20))!)
    expect(owner.n).toBeLessThan(MIN_OWNER_SAMPLES)
    expect(identifySpeaker(owner, embedUtterance(synth(HIGH_VOICE, 21))).speaker).toBe('unknown')
    expect(identifySpeaker(null, null).speaker).toBe('unknown')
    expect(ownerConfidence(null)).toBe(0)
  })

  it('survives a save round-trip and drops corrupt voiceprints', () => {
    let owner: OwnerVoice | null = null
    for (let i = 0; i < 3; i++) owner = enrollOwner(owner, embedUtterance(synth(LOW_VOICE, 30 + i))!)
    const pet = createPet('dog', 'Max', Math.random, 1_000_000)
    pet.training.owner = owner
    const restored = normalizePet(JSON.parse(JSON.stringify(pet)))!
    expect(restored.training.owner?.n).toBe(3)
    expect(restored.training.owner?.mean).toEqual(owner!.mean)
    const broken = normalizePet({ ...JSON.parse(JSON.stringify(pet)), training: { owner: { n: 3, mean: [1, 2], m2: [1] } } })!
    expect(broken.training.owner).toBeNull()
  })
})

describe('owner loyalty', () => {
  const engine = new TrainingEngine()
  const knownOwner: OwnerVoice = { n: 10, mean: new Array(EMBEDDING_SIZE).fill(0), m2: new Array(EMBEDDING_SIZE).fill(1) }

  function ctx(level: number, owner: OwnerVoice | null): TrainingContext {
    const species = SPECIES.dog
    const training = createTraining()
    training.commands.sit = { level, heard: 20, obeyed: 15, lastAt: null }
    training.owner = owner
    return { personality: species.personality, stats: { ...DEFAULT_STATS }, species, currentState: 'IDLE', training, nowMs: 1_000_000, ownerName: 'Sam' }
  }

  it('an untrained pet listens to anyone', () => {
    expect(engine.obeyChance(ctx(0, knownOwner), 'sit', 'stranger')).toBeCloseTo(engine.obeyChance(ctx(0, knownOwner), 'sit', 'owner'), 5)
    expect(engine.obeyChance(ctx(100, null), 'sit', 'stranger')).toBeCloseTo(engine.obeyChance(ctx(100, null), 'sit', 'owner'), 5)
  })

  it('a mastered command is obeyed from the owner and barely from a stranger', () => {
    const forOwner = engine.obeyChance(ctx(100, knownOwner), 'sit', 'owner')
    const forStranger = engine.obeyChance(ctx(100, knownOwner), 'sit', 'stranger')
    expect(forOwner).toBeGreaterThan(0.7)
    expect(forStranger).toBeLessThan(forOwner * 0.2)
  })

  it('refusing a stranger looks for the owner, teaches nothing and cannot be reinforced', () => {
    const rng = createRng(7)
    const c = ctx(100, knownOwner)
    let refused = 0
    let training = c.training
    for (let i = 0; i < 40; i++) {
      const r = engine.command({ ...c, training }, 'sit', rng, 'stranger')
      training = r.training
      if (r.refusedStranger) {
        refused++
        expect(r.after).toBe(r.before)
        expect(r.reaction.speech === null || /Sam|human|who are you|no\./.test(r.reaction.speech)).toBe(true)
      }
    }
    expect(refused).toBeGreaterThan(30)
    expect(training.lastObeyed).toBeNull()
    expect(training.lastRefused).toBeNull()
  })

  it('treats bind the voice: PetEngine enrolls the owner and then ignores strangers for mastered commands', () => {
    const rng = createRng(21)
    const pet = createPet('collie', 'Jess', rng.next, 1_000_000)
    const eng = new PetEngine(pet, { width: 1600, height: 900, freeRoam: false, scale: 1, breakReminderMinutes: 90, ownerName: 'Sam' }, null, rng, 1_000_000)
    eng.pet.training.commands.sit = { level: 100, heard: 30, obeyed: 28, lastAt: null }
    eng.tick(1_000_100)
    expect(eng.identifySpeaker([1, 2, 3])).toBe('unknown')
    for (let i = 0; i < 6; i++) eng.enrollOwnerVoice(embedUtterance(synth(LOW_VOICE, 40 + i))!)
    expect(eng.pet.training.owner?.n).toBe(6)
    expect(eng.identifySpeaker(embedUtterance(synth(LOW_VOICE, 50)))).toBe('owner')
    expect(eng.identifySpeaker(embedUtterance(synth(HIGH_VOICE, 51)))).toBe('stranger')
    let obeyedByStranger = 0
    let obeyedByOwner = 0
    for (let i = 0; i < 25; i++) {
      if (eng.command('sit', 'stranger').obeyed) obeyedByStranger++
      if (eng.command('sit', 'owner').obeyed) obeyedByOwner++
    }
    expect(obeyedByOwner).toBeGreaterThan(15)
    expect(obeyedByStranger).toBeLessThan(5)
  })
})
