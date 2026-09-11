import { app, Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import type { AppSettings, DisplayInfo } from '@shared/types'
import { createTrayIcon } from './icon'

export interface TrayActions {
  updateSettings: (patch: Partial<AppSettings>) => void
  openDashboard: (tab?: string) => void
  surprise: () => void
  quit: () => void
}

const SIZES: { label: string; value: number }[] = [
  { label: 'Tiny', value: 0.6 },
  { label: 'Small', value: 0.8 },
  { label: 'Normal', value: 1 },
  { label: 'Large', value: 1.35 },
  { label: 'Huge', value: 1.8 }
]

export class AppTray {
  private tray: Tray

  constructor(private actions: TrayActions) {
    this.tray = new Tray(createTrayIcon(32))
    this.tray.setToolTip('PetOnScreen')
    // Windows/Linux: double-click opens the dashboard. macOS menu bar items open their menu on click.
    if (process.platform !== 'darwin') this.tray.on('double-click', () => actions.openDashboard())
  }

  refresh(settings: AppSettings, displays: DisplayInfo[], petName: string | null): void {
    const a = this.actions
    const template: MenuItemConstructorOptions[] = [
      { label: petName ? `🐾 ${petName}` : '🐾 PetOnScreen', enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => a.openDashboard() },
      { label: settings.petVisible ? 'Hide Pet' : 'Show Pet', click: () => a.updateSettings({ petVisible: !settings.petVisible }) },
      { label: 'Pause Pet', type: 'checkbox', checked: settings.paused, click: () => a.updateSettings({ paused: !settings.paused }) },
      { label: 'Surprise Me (trigger a random event)', click: () => a.surprise() },
      { type: 'separator' },
      {
        label: 'Pet Size',
        submenu: SIZES.map((s) => ({
          label: s.label,
          type: 'radio',
          checked: Math.abs(settings.petScale - s.value) < 0.05,
          click: () => a.updateSettings({ petScale: s.value })
        }))
      },
      {
        label: 'Monitor',
        submenu: displays.map((d) => ({
          label: d.label,
          type: 'radio',
          checked: settings.displayId === d.id || (settings.displayId === null && d.primary),
          click: () => a.updateSettings({ displayId: d.id })
        }))
      },
      { label: 'Always on Top', type: 'checkbox', checked: settings.alwaysOnTop, click: () => a.updateSettings({ alwaysOnTop: !settings.alwaysOnTop }) },
      { label: 'Click-through (never grabs the mouse)', type: 'checkbox', checked: settings.clickThrough, click: () => a.updateSettings({ clickThrough: !settings.clickThrough }) },
      { label: 'Free Roam (leave the floor)', type: 'checkbox', checked: settings.freeRoam, click: () => a.updateSettings({ freeRoam: !settings.freeRoam }) },
      { label: 'Sounds', type: 'checkbox', checked: settings.soundEnabled, click: () => a.updateSettings({ soundEnabled: !settings.soundEnabled }) },
      {
        label: app.isPackaged ? (process.platform === 'darwin' ? 'Open at Login' : 'Start with System') : 'Start with System (installed build only)',
        type: 'checkbox',
        enabled: app.isPackaged,
        checked: settings.startWithOS,
        click: () => a.updateSettings({ startWithOS: !settings.startWithOS })
      },
      { type: 'separator' },
      { label: 'Settings…', click: () => a.openDashboard('settings') },
      { label: 'Quit PetOnScreen', click: () => a.quit() }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
    this.tray.setToolTip(petName ? `PetOnScreen — ${petName}` : 'PetOnScreen')
  }

  destroy(): void {
    this.tray.destroy()
  }
}
