import type { ActivityInfo, AppSettings, Bootstrap, CursorInfo, LiveSnapshot, PetCommand, SaveData, WindowBounds } from '@shared/types'
import { PetEngine, SPRITE_HEIGHT, SPRITE_WIDTH, type PetSnapshot } from '@engine/PetEngine'
import { createPet, type PetSave } from '@models/Pet'
import { SPECIES } from '@models/Species'
import { levelForExperience } from '@models/PetStats'
import { PetStorage } from '@services/PetStorage'
import { AudioService } from '@services/AudioService'
import { ConversationService, type ConversationReply } from '@services/AIService'

/** The slowly-changing part of the snapshot that React renders. Position is applied directly to the DOM. */
export interface VisualState {
  petId: string
  name: string
  speciesId: string
  state: PetSnapshot['state']
  animation: PetSnapshot['animation']
  animationKey: number
  facing: 1 | -1
  moving: boolean
  airborne: boolean
  gait: PetSnapshot['gait']
  faceViewer: boolean
  speech: string | null
  speechKey: number
  fx: PetSnapshot['fx']
  fxKey: number
  mood: PetSnapshot['mood']
  hidden: boolean
  heldItem: string | null
  level: number
  scale: number
  paused: boolean
  /** mini-game HUD state (positions are written straight to the DOM, not here) */
  playMode: 'none' | 'fetch' | 'tug'
  /** the pet stays where the user put it down */
  perched: boolean
  /** out of breath after running or playing: tongue out, quick shallow breaths */
  panting: boolean
  playPhase: string | null
  playMessage: string
  tugRounds: { user: number; pet: number } | null
  tugHolding: boolean
  ballHeld: 'cursor' | 'pet' | 'free' | null
}

type Listener = () => void

/** Clips whose CSS loops move the body, so position/motion writes run at 30Hz instead of 10Hz. */
const ACTIVE_CLIPS = new Set<PetSnapshot['animation']>(['walk', 'run', 'play', 'jump', 'happy', 'excited', 'dance', 'angry', 'scared', 'eat', 'drink', 'groom', 'bathe', 'stretch', 'dragged', 'fall'])

interface MotionParams {
  breatheAmp: number
  breatheHz: number
  tailAmp: number
  tailHz: number
}

interface MotionEls {
  root: HTMLElement | null
  lean: HTMLElement | null
  body: HTMLElement | null
  tail: HTMLElement | null
  head: HTMLElement | null
  headMotion: HTMLElement | null
  shadow: HTMLElement | null
}

/** Clips in which a pet with nothing to look at glances around on its own. */
const GLANCE_CLIPS = new Set<PetSnapshot['animation']>(['idle', 'sit', 'watch', 'curious', 'tired', 'sad', 'happy'])
const TWO_PI = Math.PI * 2

/** Idle-motion parameters per clip. Tail droop poses are in CSS; here we only decide how much it sways. */
function motionFor(animation: PetSnapshot['animation'], moving: boolean): MotionParams {
  switch (animation) {
    case 'sleep':
      return { breatheAmp: 0.06, breatheHz: 0.18, tailAmp: 0, tailHz: 0 }
    case 'tired':
      return { breatheAmp: 0.05, breatheHz: 0.22, tailAmp: 3, tailHz: 0.3 }
    case 'sad':
    case 'scared':
    case 'angry':
    case 'dragged':
    case 'fall':
    case 'hide':
      return { breatheAmp: 0.04, breatheHz: animation === 'scared' ? 1.2 : 0.5, tailAmp: 0, tailHz: 0 }
    case 'run':
      return { breatheAmp: 0.03, breatheHz: 1.2, tailAmp: 16, tailHz: 2.5 }
    case 'walk':
      return { breatheAmp: 0.03, breatheHz: 0.6, tailAmp: 12, tailHz: 1.2 }
    case 'happy':
    case 'excited':
    case 'play':
    case 'dance':
      return { breatheAmp: 0.03, breatheHz: 0.8, tailAmp: 22, tailHz: 3 }
    case 'eat':
    case 'drink':
      return { breatheAmp: 0.03, breatheHz: 0.5, tailAmp: 10, tailHz: 1.5 }
    case 'curious':
    case 'watch':
      return { breatheAmp: 0.04, breatheHz: 0.35, tailAmp: 14, tailHz: 0.8 }
    default:
      return { breatheAmp: 0.045, breatheHz: 0.3, tailAmp: moving ? 12 : 9, tailHz: moving ? 1.2 : 0.4 }
  }
}

/**
 * Glue between the pure engine and the Electron renderer: owns the frame loop, persistence,
 * IPC subscriptions, hover/drag bookkeeping and the interactive-vs-click-through state.
 */
export class PetRuntime {
  engine: PetEngine
  storage: PetStorage
  settings: AppSettings
  bounds: WindowBounds
  readonly audio = new AudioService()
  readonly conversation = new ConversationService((req) => window.petApi.aiChat(req))
  visual: VisualState
  snapshot: PetSnapshot
  version: string
  dashboardOpen: boolean

  /** Element that receives the per-frame transform. */
  frameEl: HTMLElement | null = null

  private raf = 0
  private running = false
  private hiddenAt: number | null = null
  private listeners = new Set<Listener>()
  private unsubscribers: (() => void)[] = []
  private engineUnsub: (() => void) | null = null
  private hoveringDom = false
  private hoveringCursor = false
  private dragging = false
  private overlayOpen = false
  private ignoringMouse = true
  private lastPush = 0
  private cursor: CursorInfo | null = null
  private lastVisualKey = ''
  private panting = false

  constructor(boot: Bootstrap) {
    this.settings = boot.settings
    this.bounds = boot.bounds
    this.version = boot.version
    this.dashboardOpen = boot.dashboardOpen
    this.storage = new PetStorage(boot.save, (save) => window.petApi.writeSave(save))
    if (!this.storage.activePet) {
      // First launch: a pet appears immediately, no setup wizard.
      const starter = createPet('dog', 'Max', Math.random)
      this.storage.upsertPet(starter)
      this.storage.setActive(starter.id)
    }
    this.engine = this.buildEngine(this.storage.activePet!)
    this.snapshot = this.engine.snapshot()
    this.visual = this.toVisual(this.snapshot)
    this.audio.configure(this.settings.soundEnabled, this.settings.volume)
    this.subscribeIpc()
    window.__petFlush = () => this.flush()
    // Dev hook used by the perf probe in the main process (PETONSCREEN_PERF=1).
    ;(window as unknown as { __petRuntime?: PetRuntime }).__petRuntime = this
    window.petApi.setIgnoreMouse(true)
    if (!this.settings.petVisible) this.hiddenAt = Date.now()
    else this.start()
  }

  static async create(): Promise<PetRuntime> {
    const boot = await window.petApi.bootstrap()
    return new PetRuntime(boot)
  }

  /* --------------------------------------------------------------- lifecycle */

  private buildEngine(pet: PetSave): PetEngine {
    const pos = this.storage.save.position
    const position = pos ? { x: pos.fx * this.bounds.width, y: pos.fy * this.bounds.height, perched: pos.perched ?? false } : null
    const engine = new PetEngine(
      pet,
      {
        width: this.bounds.width,
        height: this.bounds.height,
        freeRoam: this.settings.freeRoam,
        scale: this.settings.petScale,
        breakReminderMinutes: this.settings.breakReminderMinutes,
        ownerName: this.settings.ownerName
      },
      position
    )
    engine.setPaused(this.settings.paused)
    this.engineUnsub?.()
    this.engineUnsub = engine.on((e) => {
      switch (e.type) {
        case 'sound':
          this.audio.play(e.name, engine.species)
          break
        case 'save':
          this.persist()
          break
        default:
          break
      }
    })
    return engine
  }

  private switchEngine(pet: PetSave): void {
    this.persist()
    this.engine = this.buildEngine(pet)
    this.conversation.reset()
    this.snapshot = this.engine.snapshot()
    this.applyFrame(this.snapshot, performance.now())
    this.updateVisual(this.snapshot, true)
  }

  private subscribeIpc(): void {
    const api = window.petApi
    this.unsubscribers.push(
      api.on<CursorInfo>('cursor', (c) => {
        this.cursor = c
        this.engine.setCursor(c.onDisplay ? { x: c.x, y: c.y } : null)
        this.updateCursorHover()
      }),
      api.on<ActivityInfo>('activity', (a) => this.engine.setUserActivity(a.idleSeconds, a.activeSeconds, a.returned)),
      api.on<WindowBounds>('bounds', (b) => {
        this.bounds = b
        this.engine.setEnvironment({ width: b.width, height: b.height })
      }),
      api.on<AppSettings>('settings:changed', (s) => this.applySettings(s)),
      api.on<PetCommand>('pet:command', (cmd) => this.command(cmd)),
      api.on<boolean>('visibility', (visible) => {
        if (visible) {
          if (this.hiddenAt) this.engine.applyElapsed((Date.now() - this.hiddenAt) / 1000)
          this.hiddenAt = null
          this.start()
        } else {
          this.hiddenAt = Date.now()
          this.stop()
          this.persist()
          this.storage.flush()
        }
      }),
      api.on<boolean>('dashboard:state', (open) => {
        this.dashboardOpen = open
        if (open) this.pushLive(true)
      }),
      api.on<void>('pet:surprise', () => this.engine.surprise())
    )
  }

  private applySettings(s: AppSettings): void {
    const prev = this.settings
    this.settings = s
    this.engine.setEnvironment({ freeRoam: s.freeRoam, scale: s.petScale, breakReminderMinutes: s.breakReminderMinutes, ownerName: s.ownerName })
    if (prev.paused !== s.paused) this.engine.setPaused(s.paused)
    if (prev.ownerName !== s.ownerName && s.ownerName) this.engine.setOwnerName(s.ownerName)
    this.audio.configure(s.soundEnabled, s.volume)
    if (prev.clickThrough !== s.clickThrough) {
      this.ignoringMouse = true
      this.syncMouse()
    }
    this.updateVisual(this.snapshot, true)
  }

  dispose(): void {
    this.stop()
    this.unsubscribers.forEach((u) => u())
    this.engineUnsub?.()
    delete window.__petFlush
  }

  /* ------------------------------------------------------------------- loop */

  /* ------------------------------------------------------------- scheduling */
  // Measured on a transparent full-screen window: every compositor frame costs ~5ms of GPU-process
  // CPU, and an idle 60Hz requestAnimationFrame loop alone costs ~10% of a core. So the loop is
  // adaptive: rAF only while the pet is fast (airborne, dragged, running), a 30Hz timer while it is
  // moving or in an active clip, and an ~8Hz timer while it idles. User input kicks a tick at once.

  private timer: ReturnType<typeof setTimeout> | null = null

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private inTick = false

  /** Run a tick immediately (after user input) instead of waiting for the scheduled one. */
  kick(): void {
    // A kick raised from inside a tick (e.g. hover detected while ticking) is already being handled.
    if (!this.running || this.inTick) return
    cancelAnimationFrame(this.raf)
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.step()
  }

  private step = (): void => {
    if (!this.running) return
    this.timer = null
    this.inTick = true
    try {
      this.tick()
    } finally {
      this.inTick = false
    }
    this.schedule()
  }

  private schedule(): void {
    const snap = this.snapshot
    const fast = snap.airborne || snap.speed > 120 || this.dragging || snap.play !== null
    const active = snap.moving || ACTIVE_CLIPS.has(snap.animation) || performance.now() < this.effectUntil || Math.abs(snap.lean) > 0.6 || snap.attention === 'ear'
    if (fast) this.raf = requestAnimationFrame(this.step)
    else this.timer = setTimeout(this.step, active ? 33 : 120)
  }

  private tick(): void {
    if (this.perfSkip.tick) return
    const nowMs = Date.now()
    const snap = this.engine.tick(nowMs)
    this.snapshot = snap
    this.applyFrame(snap, performance.now())
    this.updateCursorHover()
    this.updateVisual(snap)
    const now = performance.now()
    if (this.dashboardOpen && now - this.lastPush > 1000) this.pushLive()
  }

  /* ---------------------------------------------------------- frame output */
  // Writes are scoped to the smallest element that needs them. Setting an inherited custom property
  // on the frame root invalidates and repaints every sprite layer (~8ms per frame measured), so
  // breathing and tail sway are inline transforms on their own composited layers, and the
  // blink/ear/eye variables live on the head layer only.

  private lastWritten: Record<string, string> = {}
  private blinkAt = 0
  private blinkUntil = 0
  private earAt = 0
  private earUntil = 0
  /** Short-lived effects (landing squash, lean settling) keep the loop at 30Hz until this time. */
  private effectUntil = 0
  private lastFrameMs = 0
  private breathPhase = 0
  private breathJitter = 1
  private lastLandKey = -1
  private squashAmp = 0
  private squashAt = 0
  private lastLookDx = 0
  /** Where the head is pointing; it trails the eyes by a few hundred milliseconds. */
  private headLook = { dx: 0, dy: 0 }
  private glance: { dx: number; dy: number } | null = null
  private glanceAt = 0
  private glanceUntil = 0

  private motionEls: MotionEls | null = null

  private els(): MotionEls {
    const cached = this.motionEls
    if (cached && cached.body?.isConnected) return cached
    const root = this.frameEl
    this.motionEls = {
      root: root?.querySelector<HTMLElement>('.sprite-wrap') ?? null,
      lean: root?.querySelector<HTMLElement>('.pet-body') ?? null,
      body: root?.querySelector<HTMLElement>('.body .idle-motion') ?? null,
      tail: root?.querySelector<HTMLElement>('.tail .idle-motion') ?? null,
      head: root?.querySelector<HTMLElement>('.part.head') ?? null,
      headMotion: root?.querySelector<HTMLElement>('.part.head .idle-motion') ?? null,
      shadow: root?.querySelector<HTMLElement>('.shadow-layer') ?? null
    }
    this.lastWritten = {}
    return this.motionEls
  }

  private write(el: HTMLElement | null, key: string, prop: string, value: string): void {
    if (!el || this.lastWritten[key] === value) return
    this.lastWritten[key] = value
    if (prop === 'transform') el.style.transform = value
    else el.style.setProperty(prop, value)
  }

  /** Perf probe switches (set through window.__petRuntime). */
  perfSkip: { all?: boolean; transform?: boolean; vars?: boolean; tick?: boolean } = {}
  private pulseTimer: ReturnType<typeof setInterval> | null = null

  /** Perf probe: toggle the breathing transform at a fixed rate to measure the cost of a frame. */
  perfPulse(hz: number): void {
    if (this.pulseTimer) clearInterval(this.pulseTimer)
    this.pulseTimer = null
    if (hz <= 0) return
    let k = 0
    this.pulseTimer = setInterval(() => {
      k ^= 1
      const body = this.els().body
      if (body) body.style.transform = k ? 'scale(1, 1.03)' : 'scale(1, 1)'
    }, 1000 / hz)
  }

  /** Mini-game visuals: ball, rope, handle and grip meters are positioned directly in the DOM. */
  private playEls: { ball: HTMLElement | null; rope: SVGPathElement | null; handle: SVGCircleElement | null; gripUser: HTMLElement | null; gripPet: HTMLElement | null; mode: string } | null = null

  private applyPlayFrame(snap: PetSnapshot): void {
    const play = snap.play
    if (!play) {
      this.playEls = null
      return
    }
    const els0 = this.playEls
    const stale =
      !els0 ||
      els0.mode !== play.mode ||
      (play.mode === 'fetch' && (!els0.ball || !els0.ball.isConnected)) ||
      (play.mode === 'tug' && (!els0.rope || !els0.rope.isConnected))
    if (stale) {
      // React mounts the PlayLayer on the tick after the game starts, so keep looking until it exists.
      this.playEls = {
        mode: play.mode,
        ball: document.querySelector<HTMLElement>('.play-ball'),
        rope: document.querySelector<SVGPathElement>('.play-rope'),
        handle: document.querySelector<SVGCircleElement>('.play-handle'),
        gripUser: document.querySelector<HTMLElement>('.grip-user .grip-fill'),
        gripPet: document.querySelector<HTMLElement>('.grip-pet .grip-fill')
      }
    }
    const els = this.playEls!
    if (play.ball && els.ball) {
      const b = play.ball
      els.ball.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, 0)`
      els.ball.style.width = `${b.r * 2}px`
      els.ball.style.height = `${b.r * 2}px`
    }
    if (play.tug && els.rope && els.handle) {
      const { handle, mouth, tension } = play.tug
      const dist = Math.hypot(handle.x - mouth.x, handle.y - mouth.y)
      const slack = Math.max(0, 130 * this.settings.petScale - dist)
      const sag = 10 + slack * 0.45 + (1 - tension) * 12
      const mx = (mouth.x + handle.x) / 2
      const my = (mouth.y + handle.y) / 2 + sag
      els.rope.setAttribute('d', `M${mouth.x.toFixed(1)} ${mouth.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${handle.x.toFixed(1)} ${handle.y.toFixed(1)}`)
      els.rope.style.strokeWidth = `${(5 - tension * 1.5) * this.settings.petScale}px`
      els.handle.setAttribute('cx', handle.x.toFixed(1))
      els.handle.setAttribute('cy', handle.y.toFixed(1))
      if (els.gripUser) els.gripUser.style.width = `${Math.round(play.tug.userGrip * 100)}%`
      if (els.gripPet) els.gripPet.style.width = `${Math.round(play.tug.petGrip * 100)}%`
    }
  }

  private applyFrame(snap: PetSnapshot, nowMs: number): void {
    if (!this.frameEl || this.perfSkip.all) return
    this.applyPlayFrame(snap)
    const { body, tail, head } = this.els()

    if (!this.perfSkip.transform) {
      this.write(this.frameEl, 'root', 'transform', `translate3d(${Math.round(snap.x * 2) / 2}px, ${Math.round(snap.y * 2) / 2}px, 0)`)
    }
    if (this.perfSkip.vars) return

    const dtF = this.lastFrameMs ? Math.min(0.25, (nowMs - this.lastFrameMs) / 1000) : 0
    this.lastFrameMs = nowMs
    const { lean, headMotion, shadow, root } = this.els()

    // Body lean: into acceleration on the ground, swinging from the hand while carried.
    const leanDeg = Math.round(snap.lean * 2) / 2
    this.write(lean, 'leanOrigin', 'transform-origin', snap.state === 'DRAGGED' ? '50% 18%' : '50% 100%')
    this.write(lean, 'lean', 'transform', leanDeg === 0 ? '' : `rotate(${leanDeg}deg)`)

    // Contact shadow shrinks and fades with height above the ground.
    if (snap.height > 0.5) {
      const k = Math.max(0.35, 1 - snap.height / 420)
      this.write(shadow, 'shadowT', 'transform', `scale(${k.toFixed(2)})`)
      this.write(shadow, 'shadowO', 'opacity', (k * 0.9).toFixed(2))
    } else {
      this.write(shadow, 'shadowT', 'transform', '')
      this.write(shadow, 'shadowO', 'opacity', '')
    }

    // Landing: a squash proportional to the impact that springs back over ~half a second.
    if (snap.landKey !== this.lastLandKey) {
      if (this.lastLandKey >= 0 && snap.impact > 150) {
        this.squashAmp = Math.min(0.28, snap.impact / 1400)
        this.squashAt = nowMs
        this.effectUntil = nowMs + 650
      }
      this.lastLandKey = snap.landKey
    }
    let squash = 0
    if (this.squashAmp > 0) {
      const ts = (nowMs - this.squashAt) / 1000
      squash = this.squashAmp * Math.exp(-ts * 9) * Math.cos(ts * 24)
      if (ts > 0.6) this.squashAmp = 0
    }

    // Stride length follows actual speed so the feet stop sliding over the ground.
    if ((snap.animation === 'walk' || snap.animation === 'run') && snap.speed > 1) {
      const mv = this.engine.species.movement
      const ref = (snap.animation === 'run' ? mv.runSpeed : mv.walkSpeed) * this.settings.petScale
      const stride = Math.round(Math.max(0.6, Math.min(1.8, ref / snap.speed)) * 10) / 10
      this.write(root, 'stride', '--stride', stride.toString())
    }

    // Breathing: rate and depth per clip, faster and shallower when out of breath, and each breath a
    // slightly different length (a perfect sine reads as a machine).
    const t = nowMs / 1000
    const m = motionFor(snap.animation, snap.moving)
    const hz = m.breatheHz + (snap.animation === 'sleep' ? 0 : snap.exertion * 2.2)
    const amp = m.breatheAmp + snap.exertion * 0.015
    this.breathPhase += dtF * hz * this.breathJitter * TWO_PI
    if (this.breathPhase >= TWO_PI) {
      this.breathPhase -= TWO_PI
      this.breathJitter = 0.85 + Math.random() * 0.3
    }
    const breathe = 1 + amp * (0.5 + 0.5 * Math.sin(this.breathPhase))
    this.write(body, 'breathe', 'transform', `scale(${(1 + squash * 0.9).toFixed(4)}, ${(breathe - squash).toFixed(4)})`)
    const sway = m.tailAmp * Math.sin(t * m.tailHz * Math.PI * 2)
    this.write(tail, 'tail', 'transform', `rotate(${sway.toFixed(1)}deg)`)

    // Gaze: the cursor if the pet has noticed it, otherwise the occasional glance around the room.
    let look = snap.lookAt
    if (!look && !snap.moving && GLANCE_CLIPS.has(snap.animation)) {
      if (nowMs >= this.glanceAt) {
        this.glance = { dx: Math.random() * 1.6 - 0.8, dy: Math.random() * 0.9 - 0.4 }
        this.glanceUntil = nowMs + 700 + Math.random() * 1800
        this.glanceAt = this.glanceUntil + 4000 + Math.random() * 10000
      }
      if (nowMs < this.glanceUntil) look = this.glance
    }

    // Blinks: more often and longer when tired, and one on every big shift of gaze.
    const tired = snap.animation === 'tired' || snap.stats.energy < 30
    if (nowMs >= this.blinkAt) {
      this.blinkUntil = nowMs + (tired ? 230 : 140)
      this.blinkAt = nowMs + (Math.random() < 0.2 ? 380 : tired ? 1200 + Math.random() * 2000 : 2500 + Math.random() * 4500)
    }
    const lookDx = look ? look.dx : 0
    if (Math.abs(lookDx - this.lastLookDx) > 0.5 && nowMs > this.blinkUntil + 300) this.blinkUntil = nowMs + 120
    this.lastLookDx = lookDx
    this.write(head, 'blink', '--blink', nowMs < this.blinkUntil ? '1' : '0')

    // Ears: random twitches, a perk the moment something is noticed, held slightly up while watching.
    if (nowMs >= this.earAt) {
      this.earUntil = nowMs + 320
      this.earAt = nowMs + 5000 + Math.random() * 9000
    }
    const earPhase = nowMs < this.earUntil ? (this.earUntil - nowMs) / 320 : 0
    let ear = earPhase === 0 ? '0deg' : earPhase > 0.5 ? '-14deg' : '6deg'
    if (snap.attention === 'ear') ear = '-16deg'
    else if (snap.attention === 'look' && earPhase === 0) ear = '-5deg'
    this.write(head, 'ear', '--ear', ear)

    // Eyes move first; the head follows a beat later.
    this.write(head, 'lx', '--look-x', look ? (Math.round(look.dx * 10) / 10).toString() : '0')
    this.write(head, 'ly', '--look-y', look ? (Math.round(look.dy * 10) / 10).toString() : '0')
    // Converges in ~4 writes at the idle tick rate; it deliberately does not raise the tick rate.
    const follow = 1 - Math.exp(-dtF * 6)
    this.headLook.dx += ((look?.dx ?? 0) - this.headLook.dx) * follow
    this.headLook.dy += ((look?.dy ?? 0) - this.headLook.dy) * follow
    const hx = Math.round(this.headLook.dx * 10) / 10
    const hy = Math.round(this.headLook.dy * 10) / 10
    this.write(headMotion, 'headlook', 'transform', hx === 0 && hy === 0 ? '' : `rotate(${(hy * 6 - hx * 2).toFixed(1)}deg) translate(${(hx * 2).toFixed(1)}%, ${(hy * 1.5).toFixed(1)}%)`)
  }

  private toVisual(snap: PetSnapshot): VisualState {
    return {
      petId: this.engine.pet.id,
      name: snap.name,
      speciesId: snap.speciesId,
      state: snap.state,
      animation: snap.animation,
      animationKey: snap.animationKey,
      facing: snap.facing,
      moving: snap.moving,
      airborne: snap.airborne,
      gait: snap.gait,
      faceViewer: snap.faceViewer,
      speech: snap.speech,
      speechKey: snap.speechKey,
      fx: snap.fx,
      fxKey: snap.fxKey,
      mood: snap.mood,
      hidden: snap.hidden,
      heldItem: snap.heldItem,
      level: snap.level,
      scale: this.settings.petScale,
      paused: this.settings.paused,
      playMode: snap.play?.mode ?? 'none',
      perched: snap.perched,
      panting: this.panting,
      playPhase: snap.play?.phase ?? null,
      playMessage: snap.play?.message ?? '',
      tugRounds: snap.play?.tug ? { ...snap.play.tug.rounds } : null,
      tugHolding: snap.play?.tug?.holding ?? false,
      ballHeld: snap.play?.ball?.held ?? null
    }
  }

  private updateVisual(snap: PetSnapshot, force = false): void {
    // Hysteresis so the tongue does not flicker in and out around the threshold.
    if (snap.exertion > 0.55) this.panting = true
    else if (snap.exertion < 0.3) this.panting = false
    const v = this.toVisual(snap)
    const key = JSON.stringify(v)
    if (!force && key === this.lastVisualKey) return
    this.lastVisualKey = key
    this.visual = v
    this.emit()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private pushLive(force = false): void {
    this.lastPush = performance.now()
    const s = this.engine.pet.stats
    const snap: LiveSnapshot = {
      petId: this.engine.pet.id,
      state: this.snapshot.state,
      mood: this.snapshot.mood,
      speech: this.snapshot.speech,
      stats: {
        happiness: s.happiness,
        hunger: s.hunger,
        energy: s.energy,
        health: s.health,
        affection: s.affection,
        experience: s.experience,
        level: levelForExperience(s.experience),
        ageDays: this.snapshot.ageDays
      }
    }
    if (force || this.dashboardOpen) window.petApi.pushSnapshot(snap)
  }

  /* ------------------------------------------------------------ persistence */

  private persist(): void {
    this.storage.upsertPet(this.engine.toSave())
    this.storage.setPosition(this.engine.positionFraction())
  }

  flush(): SaveData {
    this.persist()
    return this.storage.flush()
  }

  /* ------------------------------------------------------------- mouse state */

  /** Hitbox of the sprite in window coordinates. */
  hitRect(): { left: number; top: number; right: number; bottom: number } {
    const s = this.settings.petScale
    const halfW = (SPRITE_WIDTH / 2) * s * 0.75
    const h = SPRITE_HEIGHT * s * 0.95
    return { left: this.snapshot.x - halfW, right: this.snapshot.x + halfW, top: this.snapshot.y - h, bottom: this.snapshot.y }
  }

  private updateCursorHover(): void {
    const c = this.cursor
    let over = false
    if (c && c.onDisplay && !this.snapshot.hidden) {
      const r = this.hitRect()
      over = c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom
    }
    if (over !== this.hoveringCursor) {
      this.hoveringCursor = over
      this.onHoverChanged()
    }
  }

  setDomHover(over: boolean): void {
    if (over === this.hoveringDom) return
    this.hoveringDom = over
    this.onHoverChanged()
  }

  private wasHovering = false
  private onHoverChanged(): void {
    const hovering = this.hoveringDom || this.hoveringCursor
    if (hovering !== this.wasHovering) {
      this.wasHovering = hovering
      if (hovering) this.engine.hoverEnter()
      else this.engine.hoverLeave()
      this.kick()
    }
    this.syncMouse()
  }

  setOverlayOpen(open: boolean): void {
    this.overlayOpen = open
    this.syncMouse()
  }

  private syncMouse(): void {
    const playing = this.engine.playMode !== 'none'
    const interactive = !this.settings.clickThrough && (this.hoveringDom || this.hoveringCursor || this.dragging || this.overlayOpen || playing)
    const ignore = !interactive
    if (ignore === this.ignoringMouse) return
    this.ignoringMouse = ignore
    window.petApi.setIgnoreMouse(ignore)
  }

  get isInteractive(): boolean {
    return !this.ignoringMouse
  }

  /* --------------------------------------------------------------- gestures */

  click(): void {
    this.engine.click()
    this.kick()
  }

  dragStart(): void {
    this.dragging = true
    this.engine.dragStart()
    this.syncMouse()
    this.kick()
  }

  dragMove(x: number, y: number): void {
    this.engine.dragMove(x, y)
  }

  dragEnd(): void {
    this.dragging = false
    this.engine.dragEnd()
    this.syncMouse()
    this.kick()
  }

  /** Let a pet that was put down somewhere wander the whole screen again. */
  releasePerch(): void {
    this.engine.releasePerch()
    this.kick()
  }

  /* -------------------------------------------------------------- mini-games */

  startFetch(): void {
    this.engine.startFetch()
    this.syncMouse()
    this.kick()
  }

  startTug(): void {
    this.engine.startTug()
    this.syncMouse()
    this.kick()
  }

  stopPlay(): void {
    this.engine.stopPlay()
    this.syncMouse()
    this.kick()
  }

  playPointerDown(x: number, y: number): boolean {
    const handled = this.engine.playPointerDown(x, y)
    this.kick()
    return handled
  }

  playPointerMove(x: number, y: number): void {
    this.engine.playPointerMove(x, y)
  }

  playPointerUp(x: number, y: number): void {
    this.engine.playPointerUp(x, y)
    this.kick()
  }

  /* ---------------------------------------------------------------- actions */

  command(cmd: PetCommand): void {
    switch (cmd.type) {
      case 'pet':
        this.engine.petIt()
        break
      case 'feed':
        this.engine.feed(cmd.foodId ?? 'kibble')
        break
      case 'play':
        this.engine.play()
        break
      case 'toy':
        this.engine.giveToy(cmd.toyId ?? 'ball')
        break
      case 'useItem':
        this.engine.useItem(cmd.itemId)
        break
      case 'rename':
        this.engine.rename(cmd.name)
        break
      case 'setOwnerName':
        void window.petApi.updateSettings({ ownerName: cmd.name })
        break
      case 'talk':
        void this.talk(cmd.text)
        break
      case 'adopt':
        this.adopt(cmd.speciesId, cmd.name)
        break
      case 'switchPet':
        this.switchPet(cmd.petId)
        break
      case 'releasePet':
        this.releasePet(cmd.petId)
        break
    }
    this.persist()
    this.kick()
  }

  adopt(speciesId: string, name: string): void {
    if (!SPECIES[speciesId]) return
    const pet = createPet(speciesId, name.trim() || SPECIES[speciesId].name, Math.random)
    this.storage.upsertPet(pet)
    this.storage.setActive(pet.id)
    this.switchEngine(pet)
    this.engine.say(`hi! I'm ${pet.name} 🐾`)
    this.storage.flush()
  }

  switchPet(petId: string): void {
    const pet = this.storage.save.pets.find((p) => p.id === petId)
    if (!pet || pet.id === this.engine.pet.id) return
    this.storage.setActive(petId)
    this.switchEngine(pet)
    this.storage.flush()
  }

  releasePet(petId: string): void {
    if (this.storage.save.pets.length <= 1) return
    const wasActive = this.engine.pet.id === petId
    this.storage.removePet(petId)
    if (wasActive) {
      const next = this.storage.activePet
      if (next) this.switchEngine(next)
    }
    this.storage.flush()
  }

  async talk(text: string): Promise<ConversationReply> {
    this.engine.talk()
    const reply = await this.conversation.reply(
      text,
      { pet: this.engine.pet, species: this.engine.species, ownerName: this.settings.ownerName, currentState: this.engine.currentState() },
      this.settings.aiApiKey.length > 0
    )
    if (reply.learnedOwnerName && !this.settings.ownerName) {
      void window.petApi.updateSettings({ ownerName: reply.learnedOwnerName })
    }
    this.engine.say(reply.text, Math.min(10, 3 + reply.text.length * 0.06))
    this.audio.play('voice', this.engine.species)
    this.persist()
    return reply
  }
}
