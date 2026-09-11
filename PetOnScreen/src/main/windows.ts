import { BrowserWindow, screen, shell, type Display } from 'electron'
import { join } from 'path'
import type { AppSettings, DisplayInfo } from '@shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

/**
 * Window level for always-on-top. On macOS 'floating' keeps the pet above normal windows but below
 * system UI (menu bar, Spotlight, notifications); 'screen-saver' would sit above those too. On
 * Windows the level is a hint and 'screen-saver' is the most reliable choice.
 */
export const ALWAYS_ON_TOP_LEVEL: 'floating' | 'screen-saver' = process.platform === 'darwin' ? 'floating' : 'screen-saver'

function rendererUrl(page: 'index' | 'dashboard', query = ''): { url?: string; file?: string } {
  if (isDev) return { url: `${process.env['ELECTRON_RENDERER_URL']}/${page}.html${query}` }
  return { file: join(__dirname, `../renderer/${page}.html`) }
}

export function describeDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}${d.id === primary.id ? ' (primary)' : ''}`,
    bounds: d.bounds,
    workArea: d.workArea,
    primary: d.id === primary.id
  }))
}

export function resolveDisplay(displayId: number | null): Display {
  const all = screen.getAllDisplays()
  return all.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
}

/**
 * The pet window is a transparent, frameless, always-on-top window covering the work area
 * of one display. The pet moves inside it with CSS transforms, which is far smoother and
 * cheaper than moving a small OS window around. Mouse events pass through everywhere except
 * over the pet: the main process polls the cursor position and the renderer flips
 * setIgnoreMouseEvents off while the cursor is over the pet's hitbox or a menu is open.
 * We deliberately do not use `forward: true` - on Windows it installs a system-wide low-level
 * mouse hook that costs measurable CPU on every mouse move.
 */
export function createPetWindow(settings: AppSettings): BrowserWindow {
  const display = resolveDisplay(settings.displayId)
  const wa = display.workArea
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    title: 'PetOnScreen',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  win.setMenu(null)
  win.setIgnoreMouseEvents(true)
  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  const target = rendererUrl('index')
  if (target.url) void win.loadURL(target.url)
  else void win.loadFile(target.file!)
  return win
}

export function fitPetWindowToDisplay(win: BrowserWindow, displayId: number | null): void {
  const wa = resolveDisplay(displayId).workArea
  win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
}

export function createDashboardWindow(tab?: string, hidden = false): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 760,
    minHeight: 520,
    title: 'PetOnScreen',
    backgroundColor: '#12131a',
    autoHideMenuBar: true,
    show: false,
    paintWhenInitiallyHidden: hidden,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Only the capture harness needs a hidden window to keep painting; a minimized dashboard
      // should sleep like any normal window.
      backgroundThrottling: !hidden
    }
  })
  win.setMenu(null)
  if (!hidden) win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  const target = rendererUrl('dashboard', tab ? `?tab=${encodeURIComponent(tab)}` : '')
  if (target.url) void win.loadURL(target.url)
  else void win.loadFile(target.file!, tab ? { query: { tab } } : undefined)
  return win
}
