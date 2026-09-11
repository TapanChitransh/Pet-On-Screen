import type { SoundName } from '@engine/PetEngine'
import type { SpeciesDefinition } from '@models/Species'

/**
 * Tiny procedural sound design with the Web Audio API - no audio files needed.
 * Everything is short, quiet and rate limited so it never becomes annoying.
 */
export class AudioService {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private enabled = true
  private volume = 0.5
  private lastPlayed: Partial<Record<SoundName, number>> = {}

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.master) this.master.gain.value = this.volume * 0.35
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    try {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume * 0.35
      this.master.connect(this.ctx.destination)
      return this.ctx
    } catch {
      return null
    }
  }

  play(name: SoundName, species: SpeciesDefinition): void {
    if (!this.enabled || this.volume <= 0) return
    const now = performance.now()
    const minGap: Record<SoundName, number> = { voice: 900, happy: 1200, eat: 2000, sleep: 8000, jump: 400, land: 300, notify: 5000, annoyed: 900, step: 250 }
    if (now - (this.lastPlayed[name] ?? -Infinity) < minGap[name]) return
    this.lastPlayed[name] = now
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    switch (name) {
      case 'voice':
        this.voice(ctx, t, species)
        break
      case 'annoyed':
        this.tone(ctx, t, species.sound.pitch * 0.7, 0.18, 'sawtooth', 0.5, species.sound.pitch * 0.5)
        break
      case 'happy':
        this.tone(ctx, t, species.sound.pitch * 1.2, 0.09, 'triangle', 0.5)
        this.tone(ctx, t + 0.11, species.sound.pitch * 1.6, 0.12, 'triangle', 0.5)
        break
      case 'eat':
        for (let i = 0; i < 3; i++) this.noise(ctx, t + i * 0.16, 0.05, 0.25, 1800)
        break
      case 'sleep':
        this.tone(ctx, t, 180, 0.6, 'sine', 0.12, 140)
        break
      case 'jump':
        this.tone(ctx, t, 300, 0.12, 'sine', 0.25, 600)
        break
      case 'land':
      case 'step':
        this.noise(ctx, t, 0.04, name === 'land' ? 0.35 : 0.12, 500)
        break
      case 'notify':
        this.tone(ctx, t, 660, 0.12, 'sine', 0.35)
        this.tone(ctx, t + 0.14, 880, 0.18, 'sine', 0.35)
        break
    }
  }

  private voice(ctx: AudioContext, t: number, species: SpeciesDefinition): void {
    const p = species.sound.pitch
    switch (species.sound.kind) {
      case 'bark':
        this.tone(ctx, t, p, 0.09, 'square', 0.35, p * 0.6)
        this.tone(ctx, t + 0.12, p * 1.1, 0.1, 'square', 0.3, p * 0.6)
        break
      case 'meow':
        this.tone(ctx, t, p * 0.8, 0.35, 'triangle', 0.35, p * 1.3, p * 0.7)
        break
      case 'squeak':
        this.tone(ctx, t, p, 0.08, 'sine', 0.3, p * 1.4)
        break
      case 'chirp':
        this.tone(ctx, t, p, 0.07, 'triangle', 0.3, p * 1.5)
        this.tone(ctx, t + 0.09, p * 1.2, 0.07, 'triangle', 0.3, p * 1.7)
        break
      case 'grunt':
        this.tone(ctx, t, p, 0.22, 'sawtooth', 0.25, p * 0.8)
        break
      case 'hoot':
        this.tone(ctx, t, p, 0.22, 'sine', 0.35, p * 0.95)
        this.tone(ctx, t + 0.3, p * 0.9, 0.3, 'sine', 0.3, p * 0.85)
        break
      case 'quack':
        this.tone(ctx, t, p, 0.1, 'sawtooth', 0.28, p * 0.7)
        this.tone(ctx, t + 0.14, p * 0.95, 0.1, 'sawtooth', 0.24, p * 0.65)
        break
      case 'honk':
        this.tone(ctx, t, p, 0.28, 'triangle', 0.3, p * 0.8, p * 1.1)
        break
      case 'neigh':
        this.tone(ctx, t, p * 1.6, 0.4, 'triangle', 0.3, p * 0.9, p * 1.4)
        break
      case 'roar':
        this.tone(ctx, t, p, 0.35, 'sawtooth', 0.28, p * 0.6)
        this.noise(ctx, t, 0.3, 0.18, 400)
        break
      case 'howl':
        this.tone(ctx, t, p * 0.8, 0.9, 'triangle', 0.26, p * 0.9, p * 1.5)
        break
      case 'hum':
        this.tone(ctx, t, p, 0.16, 'triangle', 0.22)
        this.tone(ctx, t + 0.18, p * 1.25, 0.16, 'triangle', 0.22)
        this.tone(ctx, t + 0.36, p * 1.5, 0.2, 'triangle', 0.2)
        break
    }
  }

  private tone(ctx: AudioContext, t: number, freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number, midFreq?: number): void {
    if (!this.master) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (midFreq) osc.frequency.linearRampToValueAtTime(midFreq, t + dur * 0.5)
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  private noise(ctx: AudioContext, t: number, dur: number, gain: number, cutoff: number): void {
    if (!this.master) return
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(filter).connect(g).connect(this.master)
    src.start(t)
  }
}
