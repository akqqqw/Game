/**
 * Бестиарий острова.
 *
 * Три источника существ:
 *  1. яйца — обычные виды с весом `weight > 0`;
 *  2. слияния — виды с `fusionOnly: true` и нулевым весом, получаются только
 *     в лаборатории слияний (см. `fusion.ts`);
 *  3. секреты — `secret: true`: из яиц не выпадают никогда, рецепт скрыт,
 *     пока игрок не откроет существо.
 *
 * Веса яиц в сумме дают ровно 100 — это проверяется тестом.
 */

import type { ElementId } from './elements'

export type Rarity = 'Common' | 'Rare' | 'Mythic'

export type CreatureDefinition = {
  id: string
  name: string
  rarity: Rarity
  emoji: string
  /** Стихии существа: определяют, в каком жилище ему хорошо. */
  elements: ElementId[]
  clickBonus: number
  productionBonus: number
  /** Вес выпадения из яйца. 0 — из яиц не выпадает. */
  weight: number
  /** Секретное существо: только слияние, рецепт скрыт до открытия. */
  secret?: boolean
  /** Получается только слиянием. */
  fusionOnly?: boolean
  /** Намёк для ненайденного существа в коллекции. */
  hint?: string
}

export const creatures: CreatureDefinition[] = [
  // --- Обычные виды: выпадают из яиц ---------------------------------------
  {
    id: 'mossling',
    name: 'Моховик',
    rarity: 'Common',
    emoji: '🌿',
    elements: ['nature'],
    clickBonus: 1,
    productionBonus: 0,
    weight: 22,
  },
  {
    id: 'dewfin',
    name: 'Росинка',
    rarity: 'Common',
    emoji: '🐟',
    elements: ['water'],
    clickBonus: 1,
    productionBonus: 1,
    weight: 14,
  },
  {
    id: 'petalimp',
    name: 'Лепестник',
    rarity: 'Common',
    emoji: '🌸',
    elements: ['nature'],
    clickBonus: 2,
    productionBonus: 0,
    weight: 9,
  },
  {
    id: 'glowmole',
    name: 'Светокоп',
    rarity: 'Common',
    emoji: '🦔',
    elements: ['stone'],
    clickBonus: 1,
    productionBonus: 2,
    weight: 5,
  },
  {
    id: 'thornling',
    name: 'Колючник',
    rarity: 'Common',
    emoji: '🌵',
    elements: ['nature'],
    clickBonus: 2,
    productionBonus: 1,
    weight: 4,
  },
  {
    id: 'stonegolem',
    name: 'Каменный голем',
    rarity: 'Common',
    emoji: '🗿',
    elements: ['stone'],
    clickBonus: 2,
    productionBonus: 2,
    weight: 6,
  },
  {
    id: 'emberfox',
    name: 'Углехвост',
    rarity: 'Rare',
    emoji: '🦊',
    elements: ['fire'],
    clickBonus: 2,
    productionBonus: 1,
    weight: 15,
  },
  {
    id: 'cloudram',
    name: 'Облачник',
    rarity: 'Rare',
    emoji: '🐏',
    elements: ['sky'],
    clickBonus: 3,
    productionBonus: 2,
    weight: 10,
  },
  {
    id: 'reefowl',
    name: 'Рифовая птица',
    rarity: 'Rare',
    emoji: '🦚',
    elements: ['water'],
    clickBonus: 1,
    productionBonus: 3,
    weight: 5,
  },
  {
    id: 'starseed',
    name: 'Звёздное семя',
    rarity: 'Mythic',
    emoji: '✨',
    elements: ['sky'],
    clickBonus: 5,
    productionBonus: 3,
    weight: 6,
  },
  {
    id: 'moonhart',
    name: 'Лунорог',
    rarity: 'Mythic',
    emoji: '🦌',
    elements: ['sky'],
    clickBonus: 4,
    productionBonus: 5,
    weight: 4,
  },

  // --- Существа слияний: только лаборатория --------------------------------
  {
    id: 'magmagolem',
    name: 'Магмовый голем',
    rarity: 'Rare',
    emoji: '🌋',
    elements: ['fire', 'stone'],
    clickBonus: 3,
    productionBonus: 4,
    weight: 0,
    fusionOnly: true,
    hint: 'Сплав огня и камня.',
  },
  {
    id: 'mosswarden',
    name: 'Мшистый страж',
    rarity: 'Rare',
    emoji: '🐢',
    elements: ['nature', 'stone'],
    clickBonus: 2,
    productionBonus: 5,
    weight: 0,
    fusionOnly: true,
    hint: 'Камень, поросший мхом.',
  },
  {
    id: 'tidelotus',
    name: 'Приливный лотос',
    rarity: 'Rare',
    emoji: '🪷',
    elements: ['water', 'nature'],
    clickBonus: 4,
    productionBonus: 3,
    weight: 0,
    fusionOnly: true,
    hint: 'Цветок, что растёт на воде.',
  },
  {
    id: 'frostfin',
    name: 'Морознопёр',
    rarity: 'Rare',
    emoji: '🐧',
    elements: ['water', 'sky'],
    clickBonus: 3,
    productionBonus: 4,
    weight: 0,
    fusionOnly: true,
    hint: 'Холод небесной воды.',
  },
  {
    id: 'crystalwing',
    name: 'Кристаллокрыл',
    rarity: 'Mythic',
    emoji: '🦋',
    elements: ['crystal', 'sky'],
    clickBonus: 5,
    productionBonus: 6,
    weight: 0,
    fusionOnly: true,
    hint: 'Крылья из горного кристалла.',
  },
  {
    id: 'sunspirit',
    name: 'Солнечный дух',
    rarity: 'Mythic',
    emoji: '☀️',
    elements: ['fire', 'sky'],
    clickBonus: 6,
    productionBonus: 5,
    weight: 0,
    fusionOnly: true,
    hint: 'Пламя, поднявшееся к солнцу.',
  },
  {
    id: 'stormhart',
    name: 'Шторморог',
    rarity: 'Mythic',
    emoji: '🌩️',
    elements: ['sky', 'fire'],
    clickBonus: 5,
    productionBonus: 7,
    weight: 0,
    fusionOnly: true,
    hint: 'Гроза, принявшая облик оленя.',
  },
  {
    id: 'thornbeast',
    name: 'Тернобестия',
    rarity: 'Mythic',
    emoji: '🐗',
    elements: ['nature'],
    clickBonus: 6,
    productionBonus: 6,
    weight: 0,
    fusionOnly: true,
    hint: 'Два колючих существа, сросшихся в одно.',
  },

  // --- Секреты: только редкие слияния, из яиц недоступны --------------------
  {
    id: 'worldtree',
    name: 'Древо-прародитель',
    rarity: 'Mythic',
    emoji: '🌳',
    elements: ['nature', 'crystal'],
    clickBonus: 8,
    productionBonus: 10,
    weight: 0,
    fusionOnly: true,
    secret: true,
    hint: 'Первый росток острова. Соедини камень, поросший мхом, с солнечным светом.',
  },
  {
    id: 'voidphoenix',
    name: 'Пустотный феникс',
    rarity: 'Mythic',
    emoji: '🦅',
    elements: ['fire', 'sky'],
    clickBonus: 9,
    productionBonus: 9,
    weight: 0,
    fusionOnly: true,
    secret: true,
    hint: 'Пламя, что рождается из бури.',
  },
  {
    id: 'tidelord',
    name: 'Владыка приливов',
    rarity: 'Mythic',
    emoji: '🐋',
    elements: ['water', 'sky'],
    clickBonus: 7,
    productionBonus: 12,
    weight: 0,
    fusionOnly: true,
    secret: true,
    hint: 'Два водных духа, слившиеся в одного хозяина океана.',
  },
  {
    id: 'prismdragon',
    name: 'Призменный дракон',
    rarity: 'Mythic',
    emoji: '🐉',
    elements: ['crystal', 'fire'],
    clickBonus: 12,
    productionBonus: 10,
    weight: 0,
    fusionOnly: true,
    secret: true,
    hint: 'Кристалл, закалённый в магме.',
  },
]

const creatureIndex = new Map(creatures.map((creature) => [creature.id, creature]))

export function getCreature(id: string): CreatureDefinition | undefined {
  return creatureIndex.get(id)
}

/** Существа, которые могут выпасть из яйца (секреты и слияния исключены). */
export const eggPool: CreatureDefinition[] = creatures.filter(
  (creature) => creature.weight > 0 && !creature.secret,
)

/** Сумма весов яиц — должна быть 100. */
export const eggWeightTotal = eggPool.reduce((total, creature) => total + creature.weight, 0)

/** Виды, которых можно достичь в игре (всё, кроме секретов). */
export const regularCreatures: CreatureDefinition[] = creatures.filter((creature) => !creature.secret)

/** Секретные виды: только слиянием, из яиц недоступны. */
export const secretCreatures: CreatureDefinition[] = creatures.filter((creature) => creature.secret)

/**
 * Сколько «бонусных единиц» даёт существо: обычная копия — одну,
 * мутировавшая — две (мутация удваивает бонус вида).
 */
export function bonusCopies(count: number, mutations: number): number {
  return count + mutations
}

export function rarityLabel(rarity: Rarity): string {
  return {
    Common: 'Обычная',
    Rare: 'Редкая',
    Mythic: 'Мифическая',
  }[rarity]
}

export function isKnownCreatureId(value: unknown): value is string {
  return typeof value === 'string' && creatureIndex.has(value)
}
