import { embedUtterance } from '@engine/Voiceprint'

/**
 * Microphone listening and on-device speech recognition for voice commands.
 *
 * - Audio is captured with getUserMedia, downsampled to 16 kHz and segmented into utterances by a
 *   simple energy gate (speech starts above a noise-relative threshold, ends after ~0.75 s of quiet).
 * - Each utterance is transcribed by Whisper tiny (English) running in this renderer through
 *   transformers.js on the WebAssembly backend. Nothing is sent anywhere: the model files are
 *   downloaded once from Hugging Face and cached in the app's data folder through the main process.
 * - The recognized text goes to the runtime together with a small voice embedding of the clip
 *   (services/Voiceprint), so the pet can tell its owner from somebody else. The audio itself is
 *   dropped right after.
 *
 * Nothing here runs unless the user turns voice commands on.
 */
export type VoiceStatus = 'off' | 'starting' | 'downloading' | 'loading' | 'listening' | 'hearing' | 'thinking' | 'error'

export interface VoiceState {
  status: VoiceStatus
  /** 0..1 model download progress while status is 'downloading' */
  progress: number
  error: string | null
  lastText: string | null
  lastAt: number | null
  /** 0..1 microphone level for the meter */
  level: number
}

type Transcriber = (audio: Float32Array) => Promise<string>

const MODEL_ID = 'onnx-community/whisper-tiny.en'
const TARGET_RATE = 16000
/** samples per analysis frame at 16 kHz (~128 ms) */
const FRAME = 2048
const SILENCE_FRAMES = 6
const MIN_SPEECH_FRAMES = 3
const MAX_SPEECH_FRAMES = 48
const PREROLL_FRAMES = 3
/** Whisper invents these on silence or background noise. */
const HALLUCINATIONS = /^(thank you|thanks( for watching)?|you|bye|the end|so|oh|hmm|uh|um|\.+)[.!\s]*$/i

/** transformers.js cache hooks backed by files in the app's data folder (the renderer has no filesystem). */
const ipcModelCache = {
  async match(request: string | Request): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url
    const data = await window.petApi.modelCacheGet(key)
    if (!data) return undefined
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return new Response(copy.buffer, { status: 200, headers: { 'Content-Length': String(copy.byteLength) } })
  },
  async put(request: string | Request, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url
    const buf = await response.arrayBuffer()
    await window.petApi.modelCachePut(key, buf)
  }
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const j = Math.floor(pos)
    const frac = pos - j
    const a = input[j] ?? 0
    const b = input[j + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

function concat(frames: Float32Array[]): Float32Array {
  let n = 0
  for (const f of frames) n += f.length
  const out = new Float32Array(n)
  let o = 0
  for (const f of frames) {
    out.set(f, o)
    o += f.length
  }
  return out
}

export class VoiceService {
  state: VoiceState = { status: 'off', progress: 0, error: null, lastText: null, lastAt: null, level: 0 }

  private wanted = false
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private transcriber: Transcriber | null = null
  private loading: Promise<Transcriber> | null = null
  private busy = false
  private pending: Float32Array | null = null
  private preroll: Float32Array[] = []
  private speech: Float32Array[] = []
  private inSpeech = false
  private silentFrames = 0
  private noise = 0.004
  private frameCount = 0
  private carry: Float32Array = new Float32Array(0)

  constructor(
    private readonly onUtterance: (text: string, voice: number[] | null) => void,
    private readonly onChange: () => void
  ) {}

  get listening(): boolean {
    return this.wanted
  }

  async start(): Promise<void> {
    if (this.wanted) return
    this.wanted = true
    this.set({ status: 'starting', error: null })
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('No microphone access in this window')
      const allowed = await window.petApi.requestMicrophone()
      if (!allowed) throw new Error('Microphone access was not granted. Allow it in your system settings and try again.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!this.wanted) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      this.stream = stream
      const transcriber = await this.load()
      if (!this.wanted) {
        this.cleanupAudio()
        return
      }
      this.transcriber = transcriber
      this.openAudio(stream)
      this.set({ status: 'listening', progress: 1 })
    } catch (err) {
      this.wanted = false
      this.cleanupAudio()
      const message = err instanceof Error ? err.message : String(err)
      this.set({ status: 'error', error: /NotAllowed|Permission|denied/i.test(message) ? 'Microphone access was denied.' : message })
    }
  }

  stop(): void {
    this.wanted = false
    this.cleanupAudio()
    this.set({ status: 'off', level: 0 })
  }

  /** Transcribe a clip directly (used by the dev harness and tests). */
  async transcribe(audio: Float32Array): Promise<string> {
    const t = this.transcriber ?? (await this.load())
    return t(audio)
  }

  /* ------------------------------------------------------------------ model */

  private load(): Promise<Transcriber> {
    if (this.loading) return this.loading
    this.loading = (async (): Promise<Transcriber> => {
      this.set({ status: 'downloading', progress: 0 })
      const tf = await import('@huggingface/transformers')
      const { env, pipeline } = tf
      env.allowLocalModels = false
      env.useBrowserCache = false
      env.useCustomCache = true
      env.customCache = ipcModelCache
      const wasm = (env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } }).wasm
      if (wasm) {
        // The onnxruntime wasm is shipped with the app (scripts/sync-ort.mjs), never fetched from a CDN.
        wasm.wasmPaths = new URL('ort/', document.baseURI).href
        wasm.numThreads = 1
        wasm.proxy = false
      }
      const files = new Map<string, number>()
      const asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (info: { status: string; file?: string; progress?: number }) => {
          if (info.status === 'progress' && info.file) {
            files.set(info.file, info.progress ?? 0)
            let sum = 0
            for (const v of files.values()) sum += v
            this.set({ status: 'downloading', progress: sum / (files.size * 100) })
          } else if (info.status === 'ready') {
            this.set({ status: 'loading', progress: 1 })
          }
        }
      })
      return async (audio: Float32Array): Promise<string> => {
        const out = await asr(audio)
        const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text
        return (text ?? '').trim()
      }
    })()
    this.loading.catch(() => {
      this.loading = null
    })
    return this.loading
  }

  /* ------------------------------------------------------------------ audio */

  private openAudio(stream: MediaStream): void {
    let ctx: AudioContext
    try {
      ctx = new AudioContext({ sampleRate: TARGET_RATE })
    } catch {
      ctx = new AudioContext()
    }
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(FRAME, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0
    processor.onaudioprocess = (e): void => this.onAudio(e.inputBuffer.getChannelData(0), ctx.sampleRate)
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)
    this.ctx = ctx
    this.processor = processor
    this.carry = new Float32Array(0)
    this.preroll = []
    this.speech = []
    this.inSpeech = false
  }

  private cleanupAudio(): void {
    this.processor?.disconnect()
    this.processor = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.inSpeech = false
    this.speech = []
    this.pending = null
  }

  private onAudio(input: Float32Array, rate: number): void {
    const samples = resample(input, rate, TARGET_RATE)
    // Re-frame to exactly FRAME samples at 16 kHz regardless of the context's native rate.
    const joined = this.carry.length ? concat([this.carry, samples]) : samples
    let offset = 0
    while (joined.length - offset >= FRAME) {
      this.onFrame(joined.slice(offset, offset + FRAME))
      offset += FRAME
    }
    this.carry = joined.slice(offset)
  }

  private onFrame(frame: Float32Array): void {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    if (!this.inSpeech || rms < this.noise * 2.5) this.noise = Math.min(0.02, this.noise * 0.97 + rms * 0.03)
    const threshold = Math.max(0.012, this.noise * 3.5)
    this.frameCount++
    const level = Math.min(1, rms / 0.12)
    if (this.frameCount % 2 === 0) this.set({ level })

    if (rms > threshold) {
      if (!this.inSpeech) {
        this.inSpeech = true
        this.speech = [...this.preroll]
        this.silentFrames = 0
        if (this.state.status === 'listening') this.set({ status: 'hearing' })
      }
      this.speech.push(frame)
      this.silentFrames = 0
    } else if (this.inSpeech) {
      this.speech.push(frame)
      this.silentFrames++
      if (this.silentFrames >= SILENCE_FRAMES) this.endUtterance()
    }
    if (this.inSpeech && this.speech.length >= MAX_SPEECH_FRAMES) this.endUtterance()

    this.preroll.push(frame)
    if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()
  }

  private endUtterance(): void {
    const frames = this.speech
    const voiced = frames.length - this.silentFrames - PREROLL_FRAMES
    this.speech = []
    this.inSpeech = false
    this.silentFrames = 0
    if (voiced < MIN_SPEECH_FRAMES) {
      if (this.state.status === 'hearing') this.set({ status: 'listening' })
      return
    }
    void this.handle(concat(frames))
  }

  private async handle(audio: Float32Array): Promise<void> {
    if (this.busy) {
      this.pending = audio
      return
    }
    this.busy = true
    this.set({ status: 'thinking' })
    try {
      const t = this.transcriber
      if (!t) return
      const text = await t(audio)
      if (!this.wanted) return
      const clean = text.replace(/\s+/g, ' ').trim()
      if (!clean || clean.length > 80 || HALLUCINATIONS.test(clean)) return
      this.set({ lastText: clean, lastAt: Date.now() })
      this.onUtterance(clean, embedUtterance(audio, TARGET_RATE))
    } catch (err) {
      console.warn('[voice] transcription failed', err)
    } finally {
      this.busy = false
      if (this.wanted) this.set({ status: 'listening' })
      const next = this.pending
      this.pending = null
      if (next && this.wanted) void this.handle(next)
    }
  }

  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch }
    this.onChange()
  }
}
