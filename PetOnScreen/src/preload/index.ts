import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiChatRequest, AiChatResult, AppSettings, Bootstrap, LiveSnapshot, PetCommand, SaveData } from '@shared/types'

/** Channels the renderer is allowed to subscribe to. */
const SUBSCRIBE_CHANNELS = new Set([
  'cursor',
  'activity',
  'bounds',
  'settings:changed',
  'pet:command',
  'visibility',
  'dashboard:state',
  'dashboard:tab',
  'pet:snapshot',
  'store:changed',
  'pet:surprise',
  'displays'
])

const api = {
  bootstrap: (): Promise<Bootstrap> => ipcRenderer.invoke('app:bootstrap'),
  getState: (): Promise<{ settings: AppSettings; save: SaveData; displays: Bootstrap['displays']; version: string; isPackaged: boolean; dataPath: string }> =>
    ipcRenderer.invoke('state:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch),
  writeSave: (save: SaveData): void => ipcRenderer.send('save:write', save),
  setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('mouse:ignore', ignore),
  openDashboard: (tab?: string): void => ipcRenderer.send('dashboard:open', tab),
  sendCommand: (cmd: PetCommand): void => ipcRenderer.send('pet:command', cmd),
  pushSnapshot: (snap: LiveSnapshot): void => ipcRenderer.send('pet:snapshot', snap),
  quit: (): void => ipcRenderer.send('app:quit'),
  aiChat: (req: AiChatRequest): Promise<AiChatResult> => ipcRenderer.invoke('ai:chat', req),
  on: <T>(channel: string, cb: (payload: T) => void): (() => void) => {
    if (!SUBSCRIBE_CHANNELS.has(channel)) throw new Error(`Unknown channel ${channel}`)
    const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

export type PetApi = typeof api

contextBridge.exposeInMainWorld('petApi', api)
