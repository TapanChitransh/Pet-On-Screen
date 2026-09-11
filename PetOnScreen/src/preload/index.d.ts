import type { PetApi } from './index'

declare global {
  interface Window {
    petApi: PetApi
    /** Set by the pet renderer so the main process can grab a final save on quit. */
    __petFlush?: () => unknown
  }
}

export {}
