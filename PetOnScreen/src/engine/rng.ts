/** Small seedable PRNG (mulberry32) so engine behavior can be unit tested deterministically. */
export interface Rng {
  next(): number
  range(min: number, max: number): number
  int(min: number, max: number): number
  chance(p: number): boolean
  pick<T>(arr: readonly T[]): T
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T | null
}

export function createRng(seed: number = Date.now() ^ (Math.random() * 0xffffffff)): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    pickWeighted: (items, weightOf) => {
      let total = 0
      const weights: number[] = []
      for (const item of items) {
        const w = Math.max(0, weightOf(item))
        weights.push(w)
        total += w
      }
      if (total <= 0) return null
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i]
        if (r <= 0) return items[i]
      }
      return items[items.length - 1]
    }
  }
}
