import { app, BrowserWindow, ipcMain, screen, session, shell, systemPreferences } from 'electron'
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AiChatRequest, AppSettings, Bootstrap, CursorInfo, LiveSnapshot, PetCommand, SaveData, WindowBounds } from '@shared/types'
import { Store } from './store'
import { ActivityMonitor } from './activity'
import { AppTray } from './tray'
import { ALWAYS_ON_TOP_LEVEL, createDashboardWindow, createPetWindow, describeDisplays, fitPetWindowToDisplay, resolveDisplay } from './windows'
import { aiChat } from './ai'
import { Updater } from './updater'

/**
 * Dev capture mode: `PETONSCREEN_SHOT_DIR=<dir> electron .` runs an isolated copy of the app
 * (separate userData, so it does not touch the real save), screenshots the pet window and the
 * dashboard into <dir>, then exits. Used for visual verification without touching the user's screen.
 */
const SHOT_DIR = process.env['PETONSCREEN_SHOT_DIR']
if (SHOT_DIR) app.setPath('userData', join(SHOT_DIR, 'userData'))
else if (process.env['PETONSCREEN_PERF']) app.setPath('userData', join(app.getPath('temp'), 'petonscreen-perf'))
// Perf experiment: compare software compositing for the transparent overlay.
if (process.env['PETONSCREEN_SWGPU']) app.disableHardwareAcceleration()

// Single instance: a second launch just opens the dashboard of the running one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let petWin: BrowserWindow | null = null
let dashWin: BrowserWindow | null = null
let tray: AppTray | null = null
let store: Store
let updater: Updater | null = null
const activity = new ActivityMonitor()
let cursorTimer: NodeJS.Timeout | null = null
let lastCursor: CursorInfo | null = null
let quitting = false

const isMac = process.platform === 'darwin'

function windowBounds(): WindowBounds {
  const b = petWin ? petWin.getBounds() : resolveDisplay(store.getSettings().displayId).workArea
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function sendToPet(channel: string, payload?: unknown): void {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload)
}

function sendToDashboard(channel: string, payload?: unknown): void {
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send(channel, payload)
}

function broadcast(channel: string, payload?: unknown): void {
  sendToPet(channel, payload)
  sendToDashboard(channel, payload)
}

function activePetName(): string | null {
  const save = store.getSave()
  return save.pets.find((p) => p.id === save.activePetId)?.name ?? null
}

function refreshTray(): void {
  tray?.refresh(store.getSettings(), describeDisplays(), activePetName(), updater?.state ?? null)
}

/** Surface renderer errors in the main process log (stderr) so they are visible from the terminal. */
function logRendererErrors(win: BrowserWindow, label: string): void {
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[${label}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error(`[${label}] failed to load ${url}: ${code} ${desc}`))
  win.webContents.on('render-process-gone', (_e, details) => console.error(`[${label}] renderer gone: ${details.reason}`))
}

function openDashboard(tab?: string, hidden = false): void {
  if (dashWin && !dashWin.isDestroyed()) {
    if (tab) dashWin.webContents.send('dashboard:tab', tab)
    if (!hidden) {
      dashWin.show()
      dashWin.focus()
    }
    return
  }
  dashWin = createDashboardWindow(tab, hidden)
  logRendererErrors(dashWin, 'dashboard')
  sendToPet('dashboard:state', true)
  dashWin.on('closed', () => {
    dashWin = null
    sendToPet('dashboard:state', false)
  })
}

function applySettings(patch: Partial<AppSettings>): AppSettings {
  const next = store.updateSettings(patch)
  if (petWin && !petWin.isDestroyed()) {
    if (patch.alwaysOnTop !== undefined) petWin.setAlwaysOnTop(next.alwaysOnTop, ALWAYS_ON_TOP_LEVEL)
    if (patch.clickThrough !== undefined) petWin.setIgnoreMouseEvents(true)
    if (patch.displayId !== undefined) {
      fitPetWindowToDisplay(petWin, next.displayId)
      sendToPet('bounds', windowBounds())
    }
    if (patch.petVisible !== undefined) {
      if (next.petVisible) petWin.showInactive()
      else petWin.hide()
      sendToPet('visibility', next.petVisible)
    }
  }
  if (patch.startWithOS !== undefined && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: next.startWithOS, openAsHidden: true })
  }
  broadcast('settings:changed', next)
  refreshTray()
  return next
}

function startCursorPolling(): void {
  if (cursorTimer) clearInterval(cursorTimer)
  cursorTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return
    const settings = store.getSettings()
    if (!settings.petVisible || settings.paused) return
    const point = screen.getCursorScreenPoint()
    const b = petWin.getBounds()
    const onDisplay = point.x >= b.x && point.x < b.x + b.width && point.y >= b.y - 80 && point.y < b.y + b.height + 80
    const info: CursorInfo = { x: point.x - b.x, y: point.y - b.y, onDisplay }
    if (lastCursor && lastCursor.x === info.x && lastCursor.y === info.y && lastCursor.onDisplay === info.onDisplay) return
    lastCursor = info
    sendToPet('cursor', info)
  }, 50)
}

function onDisplaysChanged(): void {
  if (!petWin || petWin.isDestroyed()) return
  fitPetWindowToDisplay(petWin, store.getSettings().displayId)
  sendToPet('bounds', windowBounds())
  broadcast('displays', describeDisplays())
  refreshTray()
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', (): Bootstrap => ({
    settings: store.getSettings(),
    save: store.getSave(),
    bounds: windowBounds(),
    displays: describeDisplays(),
    dashboardOpen: Boolean(dashWin && !dashWin.isDestroyed()),
    version: app.getVersion()
  }))
  ipcMain.handle('state:get', () => ({ settings: store.getSettings(), save: store.getSave(), displays: describeDisplays(), version: app.getVersion(), isPackaged: app.isPackaged, dataPath: store.filePath }))
  ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => applySettings(patch))
  ipcMain.on('save:write', (_e, save: SaveData) => {
    const prevName = activePetName()
    store.setSave(save)
    sendToDashboard('store:changed', { settings: store.getSettings(), save: store.getSave() })
    if (prevName !== activePetName()) refreshTray()
  })
  ipcMain.on('mouse:ignore', (_e, ignore: boolean) => {
    if (!petWin || petWin.isDestroyed()) return
    const forced = store.getSettings().clickThrough
    petWin.setIgnoreMouseEvents(forced ? true : ignore)
  })
  ipcMain.on('dashboard:open', (_e, tab?: string) => openDashboard(tab))
  ipcMain.on('pet:command', (_e, cmd: PetCommand) => sendToPet('pet:command', cmd))
  ipcMain.on('pet:snapshot', (_e, snap: LiveSnapshot) => sendToDashboard('pet:snapshot', snap))
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.handle('ai:chat', (_e, req: AiChatRequest) => {
    const s = store.getSettings()
    return aiChat(s.aiApiKey, s.aiModel, req)
  })
  ipcMain.handle('update:get', () => updater?.state ?? null)
  ipcMain.handle('update:check', () => updater?.check() ?? null)
  ipcMain.on('update:download', () => void updater?.download())
  ipcMain.on('update:install', () => updater?.install())
  ipcMain.on('update:open-release', () => updater?.openReleasePage())
  ipcMain.on('shell:open-external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle('voice:request-microphone', async () => {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  })
  // Speech model cache: the renderer downloads the model once and keeps it here, so voice
  // recognition works offline afterwards. Keys are URLs; files are named by their hash.
  const modelDir = join(app.getPath('userData'), 'models')
  const modelPath = (key: string): string => join(modelDir, createHash('sha1').update(key).digest('hex'))
  ipcMain.handle('model-cache:get', async (_e, key: string) => {
    try {
      return await readFile(modelPath(key))
    } catch {
      return null
    }
  })
  ipcMain.handle('model-cache:put', async (_e, key: string, data: Uint8Array) => {
    mkdirSync(modelDir, { recursive: true })
    const target = modelPath(key)
    const tmp = `${target}.${process.pid}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, target)
  })
}

/** The pet window may use the microphone (for voice commands) and nothing else. */
function registerPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const fromPet = petWin !== null && !petWin.isDestroyed() && wc.id === petWin.webContents.id
    callback(fromPet && permission === 'media' && store.getSettings().voiceEnabled)
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    const fromPet = wc !== null && petWin !== null && !petWin.isDestroyed() && wc.id === petWin.webContents.id
    return fromPet && permission === 'media'
  })
}

function createPet(): void {
  const settings = store.getSettings()
  petWin = createPetWindow(settings)
  petWin.once('ready-to-show', () => {
    if (store.getSettings().petVisible) petWin?.showInactive()
  })
  petWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      applySettings({ petVisible: false })
    }
  })
  petWin.on('closed', () => {
    petWin = null
  })
  logRendererErrors(petWin, 'pet')
  startCursorPolling()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function runDevShots(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const shoot = async (win: BrowserWindow | null, name: string): Promise<void> => {
    if (!win || win.isDestroyed()) return
    const img = await win.webContents.capturePage()
    writeFileSync(join(dir, `${name}.png`), img.toPNG())
    console.log(`[devshot] wrote ${name}.png ${img.getSize().width}x${img.getSize().height}`)
  }
  try {
    await sleep(3500)
    await shoot(petWin, 'pet')
    // PETONSCREEN_UPDATE_FROM=<older version> makes the dashboard shots show the update banner and card.
    if (process.env['PETONSCREEN_UPDATE_FROM']) console.log(`[devshot] update check: ${JSON.stringify((await updater?.check())?.status)}`)
    openDashboard('pets', true)
    await sleep(2500)
    // A hidden window repaints unreliably for capturePage, so show it without taking focus.
    dashWin?.showInactive()
    await sleep(1200)
    await shoot(dashWin, 'dashboard-pets')
    for (const tab of ['adopt', 'inventory', 'memory', 'settings', 'about']) {
      dashWin?.webContents.send('dashboard:tab', tab)
      await sleep(1000)
      await shoot(dashWin, `dashboard-${tab}`)
      if (tab === 'settings') {
        await dashWin?.webContents.executeJavaScript(`document.querySelector('.update-card')?.scrollIntoView({ block: 'start' })`, true)
        await sleep(500)
        await shoot(dashWin, 'dashboard-updates')
      }
    }
    dashWin?.hide()
    // Exercise a few interactions through the real command path and capture the result.
    sendToPet('pet:command', { type: 'pet' } satisfies PetCommand)
    await sleep(900)
    await shoot(petWin, 'pet-petted')
    sendToPet('pet:surprise')
    await sleep(900)
    await shoot(petWin, 'pet-event')
    // Training: open the real right-click menu, pick Train, type a command, give a treat.
    {
      const js = (code: string): Promise<unknown> => petWin?.webContents.executeJavaScript(code, true) ?? Promise.resolve()
      const [px, py] = JSON.parse((await js(`JSON.stringify([Math.round(window.__petRuntime.snapshot.x), Math.round(window.__petRuntime.snapshot.y - 50 * window.__petRuntime.settings.petScale)])`)) as string) as [number, number]
      petWin?.webContents.sendInputEvent({ type: 'mouseMove', x: px, y: py })
      await sleep(150)
      petWin?.webContents.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'right', clickCount: 1 })
      petWin?.webContents.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'right', clickCount: 1 })
      await sleep(400)
      const opened = await js(`(() => { const b = [...document.querySelectorAll('.menu-item')].find((el) => el.textContent.includes('Train')); if (b) b.click(); return !!b })()`)
      console.log(`[devshot] train menu item clicked: ${opened}`)
      await sleep(500)
      await shoot(petWin, 'train-popover')
      await js(`(() => { const r = window.__petRuntime; r.engine.pet.training.commands.sit = { level: 100, heard: 12, obeyed: 11, lastAt: null }; return JSON.stringify(r.heard('Max, sit!')) })()`).then((o) => console.log(`[devshot] heard sit -> ${o}`))
      await sleep(600)
      await js(`JSON.stringify(window.__petRuntime.heard('treat'))`).then((o) => console.log(`[devshot] treat -> ${o}`))
      await sleep(600)
      await shoot(petWin, 'train-popover-treat')
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
      await sleep(300)
    }
    // One capture per species, adopted through the real command path.
    const { SPECIES_LIST } = await import('@models/Species')
    for (const s of SPECIES_LIST) {
      sendToPet('pet:command', { type: 'adopt', speciesId: s.id, name: s.name } satisfies PetCommand)
      await sleep(1200)
      await shoot(petWin, `species-${s.id}`)
    }
    const js = (code: string): Promise<unknown> => petWin?.webContents.executeJavaScript(code, true) ?? Promise.resolve()
    // Pose sheet: freeze the runtime and swap the animation class directly on the sprite.
    sendToPet('pet:command', { type: 'adopt', speciesId: 'dog', name: 'Poses' } satisfies PetCommand)
    await sleep(1200)
    await js(`(() => { const r = window.__petRuntime; r.engine.setPaused(true); r.stop() })()`)
    for (const anim of ['idle', 'walk', 'run', 'sit', 'sleep', 'eat', 'happy', 'sad', 'angry', 'scared', 'curious', 'tug']) {
      await js(`(() => { const el = document.querySelector('.sprite-wrap'); el.className = el.className.replace(/anim-\\S+/, 'anim-${anim}') })()`)
      await sleep(700)
      await shoot(petWin, `pose-${anim}`)
    }
    await js(`(() => { const r = window.__petRuntime; r.engine.setPaused(false); r.start() })()`)
    // Mini-games: a thrown ball in flight / being fetched, and a tug of war in progress.
    sendToPet('pet:command', { type: 'adopt', speciesId: 'dog', name: 'Max' } satisfies PetCommand)
    await sleep(800)
    // Lifelike motion: lean while accelerating, ears-then-eyes attention, swing while carried, squash on landing.
    await js(`window.__petRuntime.engine.debugActivity('RUNNING', 'run', 6)`)
    await sleep(140)
    await shoot(petWin, 'motion-run-start')
    console.log('[devshot] run start', await js(`(() => { const s = window.__petRuntime.snapshot; return JSON.stringify({ facing: s.facing, speed: Math.round(s.speed), lean: s.lean.toFixed(1), state: s.state }) })()`))
    await sleep(900)
    await shoot(petWin, 'motion-run')
    await js(`(() => { const r = window.__petRuntime; r.engine.debugActivity('SITTING', 'none', 30); r.engine.setCursor(null); r.kick() })()`)
    await sleep(1500)
    await js(`(() => { const r = window.__petRuntime; const s = r.snapshot; r.engine.setCursor({ x: s.x + 150, y: s.y - 60 }); r.kick() })()`)
    await sleep(60)
    await shoot(petWin, 'motion-notice-ear')
    await sleep(900)
    await shoot(petWin, 'motion-notice-look')
    await js(`(() => { const r = window.__petRuntime; const s = r.snapshot; window.__drag = { x: s.x, y: s.y - 300 }; r.dragStart(); r.dragMove(window.__drag.x, window.__drag.y) })()`)
    for (let i = 0; i < 12; i++) {
      await js(`(() => { const r = window.__petRuntime; window.__drag.x += 28; r.dragMove(window.__drag.x, window.__drag.y) })()`)
      await sleep(16)
    }
    await shoot(petWin, 'motion-carried')
    console.log('[devshot] carried', await js(`(() => { const s = window.__petRuntime.snapshot; return JSON.stringify({ height: Math.round(s.height), lean: s.lean.toFixed(1), state: s.state }) })()`))
    await js(`(() => { const r = window.__petRuntime; r.dragEnd(); r.releasePerch() })()`)
    await sleep(400)
    await shoot(petWin, 'motion-falling')
    await sleep(200)
    await shoot(petWin, 'motion-landed')
    console.log('[devshot] landed', await js(`(() => { const s = window.__petRuntime.snapshot; return JSON.stringify({ height: Math.round(s.height), impact: Math.round(s.impact), landKey: s.landKey, state: s.state }) })()`))
    await sleep(1500)
    await js(`(() => { const r = window.__petRuntime; r.engine.setCursor({ x: 500, y: 640 }); r.startFetch(); r.playPointerDown(500, 640); r.playPointerMove(530, 630) })()`)
    await sleep(40)
    await js(`(() => { const r = window.__petRuntime; r.playPointerMove(640, 590); r.playPointerUp(640, 590) })()`)
    await sleep(350)
    await shoot(petWin, 'play-fetch-throw')
    await sleep(1400)
    await shoot(petWin, 'play-fetch-chase')
    await js(`window.__petRuntime.stopPlay()`)
    await sleep(500)
    await js(`(() => { const r = window.__petRuntime; r.startTug(); })()`)
    await sleep(600)
    await js(`(() => { const r = window.__petRuntime; const h = r.snapshot.play.tug.handle; r.playPointerDown(h.x, h.y); r.playPointerMove(h.x + 140, h.y - 20); r.engine.setCursor({ x: h.x + 140, y: h.y - 20 }) })()`)
    await sleep(700)
    await shoot(petWin, 'play-tug')
    await js(`window.__petRuntime.stopPlay()`)
  } catch (err) {
    console.error('[devshot] failed', err)
  } finally {
    app.quit()
  }
}

app.whenReady().then(() => {
  store = new Store()
  if (isMac) app.dock?.hide()
  registerIpc()
  registerPermissions()
  createPet()
  tray = new AppTray({
    updateSettings: (patch) => applySettings(patch),
    openDashboard: (tab) => openDashboard(tab),
    surprise: () => sendToPet('pet:surprise'),
    quit: () => app.quit(),
    installUpdate: () => updater?.install()
  })
  refreshTray()
  updater = new Updater({
    autoDownload: () => store.getSettings().autoUpdate,
    onState: (state) => {
      broadcast('update:state', state)
      refreshTray()
    }
  })
  if (!SHOT_DIR && !process.env['PETONSCREEN_PERF'] && !process.env['PETONSCREEN_PLAYTEST']) updater.start()
  activity.start((info) => sendToPet('activity', info))
  screen.on('display-added', onDisplaysChanged)
  screen.on('display-removed', onDisplaysChanged)
  screen.on('display-metrics-changed', onDisplaysChanged)
  if (app.isPackaged && store.getSettings().startWithOS !== app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: store.getSettings().startWithOS, openAsHidden: true })
  }
  if (process.env['PETONSCREEN_PLAYTEST']) void runPlayTest(SHOT_DIR ?? app.getPath('temp'))
  else if (SHOT_DIR) void runDevShots(SHOT_DIR)
  else if (process.env['PETONSCREEN_PERF']) void runPerfProbe()
  if (process.env['PETONSCREEN_METRICS']) {
    // Periodic CPU log for the running app: PETONSCREEN_METRICS=1 npm start
    app.getAppMetrics()
    setInterval(() => {
      const rows = app.getAppMetrics().map((m) => `${m.type}(${m.pid})=${m.cpu.percentCPUUsage.toFixed(1)}%`)
      console.log(`[metrics] ${new Date().toLocaleTimeString()} ${rows.join('  ')}`)
    }, 5000)
  }
})

/**
 * Dev play test: `PETONSCREEN_PLAYTEST=1 PETONSCREEN_SHOT_DIR=<dir> electron .` drives the real pet
 * window with synthesized mouse events (the same path real input takes) through a game of fetch
 * and logs what the ball and pet do at each step.
 */
async function runPlayTest(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const wc = (): Electron.WebContents | null => (petWin && !petWin.isDestroyed() ? petWin.webContents : null)
  const js = (code: string): Promise<unknown> => wc()?.executeJavaScript(code, true) ?? Promise.resolve(null)
  const state = async (label: string): Promise<void> => {
    const s = (await js(`(() => { const r = window.__petRuntime; const p = r.snapshot.play; return JSON.stringify({ state: r.snapshot.state, pet: [Math.round(r.snapshot.x), Math.round(r.snapshot.y)], mode: p?.mode, phase: p?.phase, ball: p?.ball && { x: Math.round(p.ball.x), y: Math.round(p.ball.y), held: p.ball.held }, interactive: r.isInteractive, capture: !!document.querySelector('.play-capture'), ballEl: !!document.querySelector('.play-ball') }) })()`)) as string
    console.log(`[playtest] ${label.padEnd(28)} ${s}`)
  }
  const mouse = (type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number): void => {
    wc()?.sendInputEvent(type === 'mouseMove' ? { type, x, y } : { type, x, y, button: 'left', clickCount: 1 })
  }
  const shoot = async (name: string): Promise<void> => {
    const img = await wc()?.capturePage()
    if (img) writeFileSync(join(dir, `${name}.png`), img.toPNG())
  }
  try {
    await sleep(3500)
    if (process.env['PETONSCREEN_PLAYTEST_FREEROAM']) {
      applySettings({ freeRoam: true })
      console.log('[playtest] free roam ON')
      await sleep(500)
    }
    await state('before')
    // Open the real right-click menu on the pet and start fetch from it.
    const pos = (await js(`JSON.stringify([Math.round(window.__petRuntime.snapshot.x), Math.round(window.__petRuntime.snapshot.y - 50 * window.__petRuntime.settings.petScale)])`)) as string
    const [px, py] = JSON.parse(pos) as [number, number]
    mouse('mouseMove', px, py)
    await sleep(200)
    wc()?.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'right', clickCount: 1 })
    wc()?.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'right', clickCount: 1 })
    await sleep(400)
    const menuOpen = await js(`!!document.querySelector('.menu')`)
    console.log(`[playtest] menu open after right-click: ${menuOpen}`)
    await js(`(() => { const b = [...document.querySelectorAll('.menu-item')].find((el) => el.textContent.includes('Play fetch')); if (b) b.click(); return !!b })()`)
    await sleep(300)
    await state('after menu > Play fetch')
    // Move the mouse: the held ball should follow.
    mouse('mouseMove', 500, 600)
    await sleep(80)
    mouse('mouseMove', 520, 590)
    await sleep(80)
    await state('after mouse move')
    await shoot('playtest-held')
    // Flick: press, four quick moves, release.
    mouse('mouseDown', 520, 590)
    await sleep(16)
    mouse('mouseMove', 560, 575)
    await sleep(16)
    mouse('mouseMove', 620, 555)
    await sleep(16)
    mouse('mouseMove', 700, 530)
    await sleep(16)
    mouse('mouseUp', 700, 530)
    await sleep(60)
    await state('right after flick')
    await sleep(400)
    await state('0.5s after flick')
    await shoot('playtest-flying')
    await sleep(1500)
    await state('2s after flick')
    await shoot('playtest-2s')
    await sleep(2500)
    await state('4.5s after flick')
    await shoot('playtest-4s')
    await sleep(3000)
    await state('7.5s after flick')
  } catch (err) {
    console.error('[playtest] failed', err)
  } finally {
    app.quit()
  }
}

/**
 * Dev perf probe: `PETONSCREEN_PERF=1 electron .` samples per-process CPU with animations and the
 * frame loop toggled, prints a table and exits. Percentages are of one core, from app.getAppMetrics().
 */
async function runPerfProbe(): Promise<void> {
  const js = (code: string): Promise<unknown> => petWin?.webContents.executeJavaScript(code, true) ?? Promise.resolve()
  const sample = async (label: string, seconds: number): Promise<void> => {
    app.getAppMetrics() // reset the per-process counters
    await sleep(seconds * 1000)
    const rows = app
      .getAppMetrics()
      .filter((m) => m.type !== 'Utility')
      .map((m) => `${m.type}=${m.cpu.percentCPUUsage.toFixed(1)}%`)
    console.log(`[perf] ${label.padEnd(26)} ${rows.join('  ')}`)
  }
  const cls = (add: string[], remove: string[]): Promise<unknown> =>
    js(`document.documentElement.classList.remove(${remove.map((c) => `'${c}'`).join(',')}); document.documentElement.classList.add(${add.map((c) => `'${c}'`).join(',')})`)
  const ALL = ['perf-noanim', 'perf-nosvganim', 'perf-steps']
  app.on('web-contents-created', (_e, wc) => {
    console.log(`[perf] web-contents created: type=${wc.getType()} id=${wc.id}`)
    wc.once('did-finish-load', () => console.log(`[perf] web-contents ${wc.id} loaded ${wc.getURL()}`))
  })
  app.on('second-instance', () => console.log('[perf] second-instance event fired'))
  try {
    await sleep(4000)
    const gpuStatus = app.getGPUFeatureStatus()
    console.log(`[perf] gpu: compositing=${gpuStatus.gpu_compositing} 2d=${gpuStatus['2d_canvas']} webgl=${gpuStatus.webgl} raster=${gpuStatus.rasterization}`)
    const info = (await app.getGPUInfo('complete')) as { auxAttributes?: { glRenderer?: string; glVendor?: string; softwareRendering?: boolean } }
    console.log(`[perf] gl: ${info.auxAttributes?.glVendor ?? '?'} / ${info.auxAttributes?.glRenderer ?? '?'} software=${info.auxAttributes?.softwareRendering ?? '?'}`)
    console.log(`[perf] windows: ${BrowserWindow.getAllWindows().map((w) => `${w.id}:${w.getTitle()}:${w.isVisible() ? 'visible' : 'hidden'}`).join(', ')}`)
    const b = petWin?.getBounds()
    console.log(`[perf] window ${b?.width}x${b?.height}, cores ${require('os').cpus().length} (percentages are of total machine CPU)`)
    await sample('baseline (pet acting freely)', 6)
    // Controlled frame-cost measurement: static pet, one variable toggled at a fixed rate.
    await js(`window.__petRuntime.engine.setPaused(true); window.__petRuntime.stop()`)
    await cls(['perf-noanim'], ALL)
    await sample('static', 4)
    for (const hz of [5, 10, 30, 60]) {
      await js(`window.__petRuntime.perfPulse(${hz})`)
      await sample(`pulse ${hz} Hz`, 5)
    }
    await js(`window.__petRuntime.perfPulse(0)`)
    await cls([], ALL)
    await js(`window.__petRuntime.start()`)
    await sample('frozen pet, idle motion only', 6)
    await js(`window.__petRuntime.engine.setPaused(false)`)
    await sample('baseline again', 10)
    console.log(`[perf] windows: ${BrowserWindow.getAllWindows().map((w) => `${w.id}:${w.getTitle()}:${w.isVisible() ? 'visible' : 'hidden'}`).join(', ')}`)
    console.log(`[perf] metrics: ${JSON.stringify(app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, name: m.name, service: m.serviceName })))}`)
  } catch (err) {
    console.error('[perf] failed', err)
  } finally {
    app.quit()
  }
}

app.on('second-instance', () => openDashboard())

// Tray application: closing windows never quits.
app.on('window-all-closed', () => {
  /* keep running in the tray */
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createPet()
})

let flushed = false
app.on('before-quit', (e) => {
  quitting = true
  if (flushed) return
  e.preventDefault()
  const flushFromRenderer = async (): Promise<void> => {
    if (!petWin || petWin.isDestroyed()) return
    const save = (await Promise.race([
      petWin.webContents.executeJavaScript('window.__petFlush ? window.__petFlush() : null', true),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))
    ])) as SaveData | null
    if (save && Array.isArray(save.pets)) store.setSave(save)
  }
  flushFromRenderer()
    .catch(() => undefined)
    .finally(() => {
      store.flush()
      flushed = true
      activity.stop()
      updater?.stop()
      if (cursorTimer) clearInterval(cursorTimer)
      tray?.destroy()
      app.quit()
    })
})
