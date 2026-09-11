/**
 * Shared types used by the main process, preload bridge and both renderers.
 * Keep this file free of Electron/DOM imports so it can be used everywhere.
 */
import type { PetSave } from '@models/Pet'

export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  primary: boolean
}

export interface AppSettings {
  /** Which display the pet lives on. null = primary. */
  displayId: number | null
  /** Visual scale of the pet, 0.5 .. 2.5 */
  petScale: number
  alwaysOnTop: boolean
  /** When true the pet never captures the mouse - it is purely decorative. */
  clickThrough: boolean
  /** When true the pet walks anywhere; otherwise it stays on the floor (bottom of the work area). */
  freeRoam: boolean
  startWithOS: boolean
  soundEnabled: boolean
  volume: number
  /** Minutes of continuous activity before the pet suggests a break. 0 disables. */
  breakReminderMinutes: number
  petVisible: boolean
  paused: boolean
  ownerName: string
  /** Optional Claude API key for AI conversation. Stored locally only. */
  aiApiKey: string
  aiModel: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayId: null,
  petScale: 1,
  alwaysOnTop: true,
  clickThrough: false,
  freeRoam: false,
  startWithOS: false,
  soundEnabled: true,
  volume: 0.5,
  breakReminderMinutes: 90,
  petVisible: true,
  paused: false,
  ownerName: '',
  aiApiKey: '',
  aiModel: 'claude-opus-5'
}

export interface SaveData {
  version: number
  activePetId: string | null
  pets: PetSave[]
  /** Pet position as a fraction of the window so it survives resolution changes. */
  position: { fx: number; fy: number } | null
  lastSavedAt: number
}

export const EMPTY_SAVE: SaveData = {
  version: 1,
  activePetId: null,
  pets: [],
  position: null,
  lastSavedAt: 0
}

/** Commands the dashboard / tray can send to the live pet. */
export type PetCommand =
  | { type: 'pet' }
  | { type: 'feed'; foodId?: string }
  | { type: 'play' }
  | { type: 'toy'; toyId?: string }
  | { type: 'rename'; name: string }
  | { type: 'switchPet'; petId: string }
  | { type: 'adopt'; speciesId: string; name: string }
  | { type: 'releasePet'; petId: string }
  | { type: 'setOwnerName'; name: string }
  | { type: 'useItem'; itemId: string }
  | { type: 'talk'; text: string }

export interface ActivityInfo {
  /** Seconds since the last keyboard / mouse input (system-wide, no content captured). */
  idleSeconds: number
  /** Seconds of continuous activity since the user last stopped for > 5 minutes. */
  activeSeconds: number
  /** True on the tick the user returned after a long idle period. */
  returned: boolean
}

export interface CursorInfo {
  /** Cursor position relative to the pet window. */
  x: number
  y: number
  /** Whether the cursor is inside the pet window's display. */
  onDisplay: boolean
}

export interface WindowBounds {
  width: number
  height: number
  x: number
  y: number
}

export interface Bootstrap {
  settings: AppSettings
  save: SaveData
  bounds: WindowBounds
  displays: DisplayInfo[]
  dashboardOpen: boolean
  version: string
}

/** Lightweight snapshot broadcast to the dashboard while it is open. */
export interface LiveSnapshot {
  petId: string
  state: string
  mood: string
  speech: string | null
  stats: {
    happiness: number
    hunger: number
    energy: number
    health: number
    affection: number
    experience: number
    level: number
    ageDays: number
  }
}

export interface ChatMessage {
  role: 'user' | 'pet'
  text: string
  at: number
}

export interface AiChatRequest {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export type AiChatResult = { ok: true; text: string } | { ok: false; error: string }
