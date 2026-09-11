import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_SETTINGS, EMPTY_SAVE, type AppSettings, type SaveData } from '@shared/types'
import { normalizePet } from '@models/Pet'

interface PersistedFile {
  settings: AppSettings
  save: SaveData
}

/**
 * Single JSON file persistence in the user's app-data folder. Writes are debounced and atomic
 * (write to a temp file, then rename) so a crash never leaves a half-written save.
 */
export class Store {
  private readonly path: string
  private data: PersistedFile
  private writeTimer: NodeJS.Timeout | null = null

  constructor() {
    this.path = join(app.getPath('userData'), 'petonscreen-data.json')
    this.data = this.load()
  }

  get filePath(): string {
    return this.path
  }

  private load(): PersistedFile {
    const fallback: PersistedFile = { settings: { ...DEFAULT_SETTINGS }, save: { ...EMPTY_SAVE, pets: [] } }
    if (!existsSync(this.path)) return fallback
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<PersistedFile>
      const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }
      const pets = Array.isArray(raw.save?.pets) ? raw.save!.pets.map((p) => normalizePet(p)).filter((p): p is NonNullable<typeof p> => p !== null) : []
      const save: SaveData = {
        ...EMPTY_SAVE,
        ...(raw.save ?? {}),
        pets,
        activePetId: pets.some((p) => p.id === raw.save?.activePetId) ? raw.save!.activePetId! : pets[0]?.id ?? null
      }
      return { settings, save }
    } catch (err) {
      console.error('[store] failed to read save, starting fresh', err)
      return fallback
    }
  }

  getSettings(): AppSettings {
    return this.data.settings
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleWrite()
    return this.data.settings
  }

  getSave(): SaveData {
    return this.data.save
  }

  setSave(save: SaveData): void {
    this.data.save = { ...save, lastSavedAt: Date.now() }
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.path)
    } catch (err) {
      console.error('[store] failed to write save', err)
    }
  }
}
