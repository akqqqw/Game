export type Rarity = 'Common' | 'Rare' | 'Mythic'

export type CreatureDefinition = {
  id: string
  name: string
  rarity: Rarity
  emoji: string
  clickBonus: number
  productionBonus: number
  weight: number
}

export const creatures: CreatureDefinition[] = [
  {
    id: 'mossling',
    name: 'Моховик',
    rarity: 'Common',
    emoji: '🌿',
    clickBonus: 1,
    productionBonus: 0,
    weight: 26,
  },
  {
    id: 'dewfin',
    name: 'Росинка',
    rarity: 'Common',
    emoji: '🐟',
    clickBonus: 1,
    productionBonus: 1,
    weight: 15,
  },
  {
    id: 'petalimp',
    name: 'Лепестник',
    rarity: 'Common',
    emoji: '🌸',
    clickBonus: 2,
    productionBonus: 0,
    weight: 10,
  },
  {
    id: 'glowmole',
    name: 'Светокоп',
    rarity: 'Common',
    emoji: '🦔',
    clickBonus: 1,
    productionBonus: 2,
    weight: 5,
  },
  {
    id: 'thornling',
    name: 'Колючник',
    rarity: 'Common',
    emoji: '🌵',
    clickBonus: 2,
    productionBonus: 1,
    weight: 4,
  },
  {
    id: 'emberfox',
    name: 'Углехвост',
    rarity: 'Rare',
    emoji: '🦊',
    clickBonus: 2,
    productionBonus: 1,
    weight: 15,
  },
  {
    id: 'cloudram',
    name: 'Облачник',
    rarity: 'Rare',
    emoji: '🐏',
    clickBonus: 3,
    productionBonus: 2,
    weight: 10,
  },
  {
    id: 'reefowl',
    name: 'Рифовая птица',
    rarity: 'Rare',
    emoji: '🦚',
    clickBonus: 1,
    productionBonus: 3,
    weight: 5,
  },
  {
    id: 'starseed',
    name: 'Звёздное семя',
    rarity: 'Mythic',
    emoji: '✨',
    clickBonus: 5,
    productionBonus: 3,
    weight: 6,
  },
  {
    id: 'moonhart',
    name: 'Лунорог',
    rarity: 'Mythic',
    emoji: '🦌',
    clickBonus: 4,
    productionBonus: 5,
    weight: 4,
  },
]

export function getCreature(id: string): CreatureDefinition | undefined {
  return creatures.find((creature) => creature.id === id)
}

export function rarityLabel(rarity: Rarity): string {
  return {
    Common: 'Обычная',
    Rare: 'Редкая',
    Mythic: 'Мифическая',
  }[rarity]
}
