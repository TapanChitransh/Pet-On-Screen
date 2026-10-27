import type { SaveData } from '@shared/types'
import type { PetSave } from '@models/Pet'

/**
 * Renderer-side owner of the SaveData document. The pet window is the single writer;
 * writes are debounced and pushed to the main process which persists them to disk.
 */
export class PetStorage {
  private data: SaveData
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(initial: SaveData, private readonly write: (save: SaveData) => void) {
    this.data = { ...initial, pets: [...initial.pets] }
  }

  get save(): SaveData {
    return this.data
  }

  get activePet(): PetSave | null {
    return this.data.pets.find((p) => p.id === this.data.activePetId) ?? null
  }

  upsertPet(pet: PetSave): void {
    const idx = this.data.pets.findIndex((p) => p.id === pet.id)
    const pets = [...this.data.pets]
    if (idx >= 0) pets[idx] = pet
    else pets.push(pet)
    this.data = { ...this.data, pets }
    this.schedule()
  }

  removePet(id: string): void {
    const pets = this.data.pets.filter((p) => p.id !== id)
    const activePetId = this.data.activePetId === id ? pets[0]?.id ?? null : this.data.activePetId
    this.data = { ...this.data, pets, activePetId }
    this.schedule(true)
  }

  setActive(id: string): void {
    if (!this.data.pets.some((p) => p.id === id)) return
    this.data = { ...this.data, activePetId: id }
    this.schedule(true)
  }

  setPosition(position: { fx: number; fy: number; perched?: boolean }): void {
    this.data = { ...this.data, position }
    this.schedule()
  }

  private schedule(immediate = false): void {
    if (this.timer) clearTimeout(this.timer)
    if (immediate) {
      this.flush()
      return
    }
    this.timer = setTimeout(() => this.flush(), 1500)
  }

  flush(): SaveData {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.write(this.data)
    return this.data
  }
}
