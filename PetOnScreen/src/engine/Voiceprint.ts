import type { OwnerVoice } from '@models/Commands'

/**
 * A tiny on-device speaker model so a trained pet can tell its owner's voice from a stranger's.
 *
 * Each utterance becomes a fixed-size embedding: the mean and spread of 12 mel-frequency cepstral
 * coefficients over the voiced frames, plus pitch statistics. The owner's voiceprint is the running
 * mean and variance of the embeddings of utterances the owner rewarded with a treat. A new
 * utterance matches when its standardized distance from that mean is small.
 *
 * This is deliberately simple: no neural network, no download, deterministic, and good enough to
 * separate two different people most of the time. It is a pet toy, not an authentication system.
 */

export const SAMPLE_RATE = 16000
const FRAME_LEN = 400 // 25 ms
const HOP = 160 // 10 ms
const FFT_N = 512
const MEL_FILTERS = 26
const CEPSTRA = 13
const PITCH_MIN = 60
const PITCH_MAX = 420

/** Owner voiceprint needs this many rewarded utterances before the pet trusts it. */
export const MIN_OWNER_SAMPLES = 3
/** Enough samples for full confidence. */
export const FULL_OWNER_SAMPLES = 6
/** Mean squared standardized distance at which an utterance stops counting as the owner. */
export const MATCH_THRESHOLD = 2.4

/** Embedding layout: 12 MFCC means, 12 MFCC standard deviations, log-pitch mean, log-pitch spread. */
export const EMBEDDING_SIZE = (CEPSTRA - 1) * 2 + 2

/**
 * Typical between-utterance variance of each dimension for a single speaker. Blended with the
 * measured variance so a voiceprint built from three utterances is not absurdly overconfident.
 */
const PRIOR_VAR: number[] = [...Array<number>(CEPSTRA - 1).fill(0.35), ...Array<number>(CEPSTRA - 1).fill(0.08), 0.03, 0.02]
const PRIOR_WEIGHT = 3

/* ------------------------------------------------------------------ DSP */

let hamming: Float32Array | null = null
let melBank: { lo: number; hi: number; weights: Float32Array }[] | null = null
let dctTable: Float32Array | null = null
let fftTables: { cos: Float32Array; sin: Float32Array; rev: Uint16Array } | null = null

function window(): Float32Array {
  if (hamming) return hamming
  hamming = new Float32Array(FRAME_LEN)
  for (let i = 0; i < FRAME_LEN; i++) hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1))
  return hamming
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1)
}

function filterBank(): NonNullable<typeof melBank> {
  if (melBank) return melBank
  const bins = FFT_N / 2 + 1
  const loMel = hzToMel(80)
  const hiMel = hzToMel(SAMPLE_RATE / 2)
  const centers: number[] = []
  for (let i = 0; i < MEL_FILTERS + 2; i++) {
    const hz = melToHz(loMel + ((hiMel - loMel) * i) / (MEL_FILTERS + 1))
    centers.push((hz / (SAMPLE_RATE / 2)) * (bins - 1))
  }
  melBank = []
  for (let m = 1; m <= MEL_FILTERS; m++) {
    const a = centers[m - 1]
    const b = centers[m]
    const c = centers[m + 1]
    const lo = Math.max(0, Math.floor(a))
    const hi = Math.min(bins - 1, Math.ceil(c))
    const weights = new Float32Array(hi - lo + 1)
    for (let k = lo; k <= hi; k++) {
      let w = 0
      if (k >= a && k <= b && b > a) w = (k - a) / (b - a)
      else if (k > b && k <= c && c > b) w = (c - k) / (c - b)
      weights[k - lo] = w
    }
    melBank.push({ lo, hi, weights })
  }
  return melBank
}

function dct(): Float32Array {
  if (dctTable) return dctTable
  dctTable = new Float32Array(CEPSTRA * MEL_FILTERS)
  for (let c = 0; c < CEPSTRA; c++) {
    for (let m = 0; m < MEL_FILTERS; m++) dctTable[c * MEL_FILTERS + m] = Math.cos((Math.PI * c * (m + 0.5)) / MEL_FILTERS)
  }
  return dctTable
}

function fft(): NonNullable<typeof fftTables> {
  if (fftTables) return fftTables
  const cos = new Float32Array(FFT_N / 2)
  const sin = new Float32Array(FFT_N / 2)
  for (let i = 0; i < FFT_N / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / FFT_N)
    sin[i] = Math.sin((2 * Math.PI * i) / FFT_N)
  }
  const bits = Math.log2(FFT_N)
  const rev = new Uint16Array(FFT_N)
  for (let i = 0; i < FFT_N; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  fftTables = { cos, sin, rev }
  return fftTables
}

/** In-place radix-2 FFT; returns the power spectrum of the first N/2+1 bins. */
function powerSpectrum(frame: Float32Array, re: Float32Array, im: Float32Array, out: Float32Array): void {
  const { cos, sin, rev } = fft()
  // Bit-reversed load of the zero-padded frame.
  for (let i = 0; i < FFT_N; i++) {
    re[i] = rev[i] < frame.length ? frame[rev[i]] : 0
    im[i] = 0
  }
  for (let size = 2; size <= FFT_N; size <<= 1) {
    const half = size >> 1
    const step = FFT_N / size
    for (let start = 0; start < FFT_N; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = -sin[k * step]
        const i = start + k
        const j = i + half
        const tr = re[j] * wr - im[j] * wi
        const ti = re[j] * wi + im[j] * wr
        re[j] = re[i] - tr
        im[j] = im[i] - ti
        re[i] += tr
        im[i] += ti
      }
    }
  }
  for (let k = 0; k <= FFT_N / 2; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) / FFT_N
}

/** Fundamental frequency of one frame by normalized autocorrelation, or 0 when unvoiced. */
function pitchOf(frame: Float32Array): number {
  const minLag = Math.floor(SAMPLE_RATE / PITCH_MAX)
  const maxLag = Math.min(frame.length - 1, Math.ceil(SAMPLE_RATE / PITCH_MIN))
  let energy = 0
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i]
  if (energy <= 1e-9) return 0
  let bestLag = 0
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    let e2 = 0
    for (let i = 0; i + lag < frame.length; i++) {
      sum += frame[i] * frame[i + lag]
      e2 += frame[i + lag] * frame[i + lag]
    }
    const norm = sum / Math.sqrt(energy * e2 + 1e-12)
    if (norm > best) {
      best = norm
      bestLag = lag
    }
  }
  return best > 0.45 && bestLag > 0 ? SAMPLE_RATE / bestLag : 0
}

/**
 * Embedding of one utterance (mono, 16 kHz). Returns null when the clip has no voiced frames,
 * so silence and clicks never pollute a voiceprint.
 */
export function embedUtterance(audio: Float32Array, sampleRate = SAMPLE_RATE): number[] | null {
  const samples = sampleRate === SAMPLE_RATE ? audio : resampleLinear(audio, sampleRate, SAMPLE_RATE)
  if (samples.length < FRAME_LEN * 4) return null
  const win = window()
  const bank = filterBank()
  const dctT = dct()
  const re = new Float32Array(FFT_N)
  const im = new Float32Array(FFT_N)
  const spec = new Float32Array(FFT_N / 2 + 1)
  const frame = new Float32Array(FRAME_LEN)
  const raw = new Float32Array(FRAME_LEN)
  const logMel = new Float32Array(MEL_FILTERS)

  const frames: { mfcc: Float32Array; energy: number; pitch: number }[] = []
  for (let start = 0; start + FRAME_LEN <= samples.length; start += HOP) {
    let energy = 0
    for (let i = 0; i < FRAME_LEN; i++) {
      const prev = i === 0 ? (start > 0 ? samples[start - 1] : 0) : samples[start + i - 1]
      raw[i] = samples[start + i]
      const pre = samples[start + i] - 0.97 * prev
      frame[i] = pre * win[i]
      energy += raw[i] * raw[i]
    }
    energy /= FRAME_LEN
    powerSpectrum(frame, re, im, spec)
    for (let m = 0; m < MEL_FILTERS; m++) {
      const f = bank[m]
      let sum = 0
      for (let k = f.lo; k <= f.hi; k++) sum += spec[k] * f.weights[k - f.lo]
      logMel[m] = Math.log(sum + 1e-10)
    }
    const mfcc = new Float32Array(CEPSTRA)
    for (let c = 0; c < CEPSTRA; c++) {
      let sum = 0
      for (let m = 0; m < MEL_FILTERS; m++) sum += logMel[m] * dctT[c * MEL_FILTERS + m]
      mfcc[c] = sum
    }
    frames.push({ mfcc, energy, pitch: pitchOf(raw) })
  }
  if (frames.length === 0) return null

  // Voiced frames only: above a tenth of the loudest frame and well above silence.
  let peak = 0
  for (const f of frames) peak = Math.max(peak, f.energy)
  const gate = Math.max(peak * 0.1, 1e-6)
  const voiced = frames.filter((f) => f.energy >= gate)
  if (voiced.length < 4) return null

  const out = new Array<number>(EMBEDDING_SIZE).fill(0)
  const n = voiced.length
  for (let c = 1; c < CEPSTRA; c++) {
    let mean = 0
    for (const f of voiced) mean += f.mfcc[c]
    mean /= n
    let varSum = 0
    for (const f of voiced) varSum += (f.mfcc[c] - mean) ** 2
    out[c - 1] = mean
    out[CEPSTRA - 1 + c - 1] = Math.sqrt(varSum / n)
  }
  const pitched = voiced.filter((f) => f.pitch > 0).map((f) => Math.log(f.pitch))
  if (pitched.length >= 2) {
    const mean = pitched.reduce((a, b) => a + b, 0) / pitched.length
    const sd = Math.sqrt(pitched.reduce((a, b) => a + (b - mean) ** 2, 0) / pitched.length)
    out[EMBEDDING_SIZE - 2] = mean
    out[EMBEDDING_SIZE - 1] = sd
  } else {
    out[EMBEDDING_SIZE - 2] = Math.log(150)
    out[EMBEDDING_SIZE - 1] = 0.1
  }
  // Loudness-invariant: the first cepstral coefficient (overall energy) is intentionally left out.
  return out.map((v) => (Number.isFinite(v) ? v : 0))
}

function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const j = Math.floor(pos)
    const a = input[j] ?? 0
    const b = input[j + 1] ?? a
    out[i] = a + (b - a) * (pos - j)
  }
  return out
}

/* ------------------------------------------------------------- voiceprint */

/** Add one utterance to the owner's voiceprint (Welford running mean/variance). */
export function enrollOwner(owner: OwnerVoice | null, embedding: number[]): OwnerVoice {
  if (!owner || owner.mean.length !== embedding.length) {
    return { n: 1, mean: [...embedding], m2: new Array<number>(embedding.length).fill(0) }
  }
  const n = owner.n + 1
  const mean = owner.mean.slice()
  const m2 = owner.m2.slice()
  for (let i = 0; i < embedding.length; i++) {
    const delta = embedding[i] - mean[i]
    mean[i] += delta / n
    m2[i] += delta * (embedding[i] - mean[i])
  }
  return { n, mean, m2 }
}

/** 0..1: how well the pet knows its owner's voice. 0 until MIN_OWNER_SAMPLES are enrolled, then quickly most of the way. */
export function ownerConfidence(owner: OwnerVoice | null): number {
  if (!owner || owner.n < MIN_OWNER_SAMPLES) return 0
  return 0.75 + 0.25 * Math.min(1, (owner.n - MIN_OWNER_SAMPLES) / (FULL_OWNER_SAMPLES - MIN_OWNER_SAMPLES))
}

/** Mean squared standardized distance of an utterance from the owner's voiceprint (lower = closer). */
export function ownerDistance(owner: OwnerVoice, embedding: number[]): number {
  if (owner.mean.length !== embedding.length) return Infinity
  let sum = 0
  for (let i = 0; i < embedding.length; i++) {
    const measured = owner.n > 1 ? owner.m2[i] / (owner.n - 1) : 0
    const prior = PRIOR_VAR[i] ?? 0.1
    const variance = (measured * Math.max(0, owner.n - 1) + prior * PRIOR_WEIGHT) / (Math.max(0, owner.n - 1) + PRIOR_WEIGHT)
    const z = (embedding[i] - owner.mean[i]) / Math.sqrt(variance + 1e-6)
    sum += z * z
  }
  return sum / embedding.length
}

/**
 * Who is speaking. 'unknown' until the voiceprint has enough samples: a pet that has not learned
 * its owner's voice yet listens to everyone.
 */
export function identifySpeaker(owner: OwnerVoice | null, embedding: number[] | null): { speaker: 'owner' | 'stranger' | 'unknown'; distance: number | null } {
  if (!owner || owner.n < MIN_OWNER_SAMPLES || !embedding) return { speaker: 'unknown', distance: null }
  const distance = ownerDistance(owner, embedding)
  return { speaker: distance <= MATCH_THRESHOLD ? 'owner' : 'stranger', distance }
}
