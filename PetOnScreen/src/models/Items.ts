export type ItemKind = 'food' | 'toy' | 'treasure'

export interface ItemDefinition {
  id: string
  name: string
  emoji: string
  kind: ItemKind
  description: string
  /** food: how much hunger it removes; toy: how much happiness it adds */
  power: number
  /** true for the always-available basics that never run out */
  infinite?: boolean
}

export const ITEMS: Record<string, ItemDefinition> = {
  kibble: { id: 'kibble', name: 'Kibble', emoji: '🥣', kind: 'food', description: 'Plain but filling. Never runs out.', power: 30, infinite: true },
  water: { id: 'water', name: 'Water', emoji: '💧', kind: 'food', description: 'Fresh water. Never runs out.', power: 5, infinite: true },
  treat: { id: 'treat', name: 'Treat', emoji: '🍪', kind: 'food', description: 'A crunchy treat. Small but makes pets very happy.', power: 12 },
  bone: { id: 'bone', name: 'Bone', emoji: '🦴', kind: 'food', description: 'Dogs go wild for this.', power: 35 },
  fish: { id: 'fish', name: 'Fish', emoji: '🐟', kind: 'food', description: 'Fresh fish. Cats and penguins approve.', power: 35 },
  carrot: { id: 'carrot', name: 'Carrot', emoji: '🥕', kind: 'food', description: 'Crunchy and orange.', power: 30 },
  berries: { id: 'berries', name: 'Berries', emoji: '🫐', kind: 'food', description: 'Sweet wild berries.', power: 25 },
  bamboo: { id: 'bamboo', name: 'Bamboo', emoji: '🎍', kind: 'food', description: 'A panda staple.', power: 35 },
  apple: { id: 'apple', name: 'Apple', emoji: '🍎', kind: 'food', description: 'Crisp and sweet. Deer and unicorns adore it.', power: 30 },
  seeds: { id: 'seeds', name: 'Seeds', emoji: '🌾', kind: 'food', description: 'A handful of seeds and grain.', power: 22 },
  nuts: { id: 'nuts', name: 'Nuts', emoji: '🥜', kind: 'food', description: 'For stuffing into cheeks.', power: 25 },
  cake: { id: 'cake', name: 'Cake', emoji: '🍰', kind: 'food', description: 'A slice of something fancy.', power: 28 },
  coffee: { id: 'coffee', name: 'Coffee', emoji: '☕', kind: 'food', description: 'Warm and comforting. A person\'s best friend.', power: 15 },
  sandwich: { id: 'sandwich', name: 'Sandwich', emoji: '🥪', kind: 'food', description: 'Lunch, finally.', power: 35 },
  ball: { id: 'ball', name: 'Ball', emoji: '🎾', kind: 'toy', description: 'Bouncy. Chase-able.', power: 15 },
  yarn: { id: 'yarn', name: 'Yarn', emoji: '🧶', kind: 'toy', description: 'Endlessly tangle-able.', power: 15 },
  stick: { id: 'stick', name: 'Stick', emoji: '🪵', kind: 'toy', description: 'The finest of sticks.', power: 12 },
  feather: { id: 'feather', name: 'Feather', emoji: '🪶', kind: 'toy', description: 'Floaty and irresistible.', power: 14 },
  snowball: { id: 'snowball', name: 'Snowball', emoji: '❄️', kind: 'toy', description: 'Cold and round.', power: 14 },
  bubbles: { id: 'bubbles', name: 'Bubbles', emoji: '🫧', kind: 'toy', description: 'Pop pop pop.', power: 14 },
  kite: { id: 'kite', name: 'Kite', emoji: '🪁', kind: 'toy', description: 'Something to chase on a windy day.', power: 16 },
  book: { id: 'book', name: 'Book', emoji: '📖', kind: 'toy', description: 'A good story. Some companions prefer this to a ball.', power: 15 },
  shiny: { id: 'shiny', name: 'Shiny Pebble', emoji: '💎', kind: 'treasure', description: 'Your pet found this and thought of you.', power: 0 },
  leaf: { id: 'leaf', name: 'Pretty Leaf', emoji: '🍁', kind: 'treasure', description: 'A carefully chosen leaf.', power: 0 },
  sock: { id: 'sock', name: 'Mystery Sock', emoji: '🧦', kind: 'treasure', description: 'Nobody knows where it came from.', power: 0 },
  flower: { id: 'flower', name: 'Flower', emoji: '🌼', kind: 'treasure', description: 'A tiny gift.', power: 0 }
}

export type Inventory = Record<string, number>

export function addItem(inv: Inventory, id: string, count = 1): Inventory {
  return { ...inv, [id]: (inv[id] ?? 0) + count }
}

export function removeItem(inv: Inventory, id: string, count = 1): Inventory {
  const def = ITEMS[id]
  if (def?.infinite) return inv
  const left = (inv[id] ?? 0) - count
  const next = { ...inv }
  if (left <= 0) delete next[id]
  else next[id] = left
  return next
}

export function hasItem(inv: Inventory, id: string): boolean {
  return Boolean(ITEMS[id]?.infinite) || (inv[id] ?? 0) > 0
}

export const STARTER_INVENTORY: Inventory = { treat: 3, ball: 1 }
