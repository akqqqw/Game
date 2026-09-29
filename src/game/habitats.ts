/**
 * Среда обитания: жилища на острове.
 *
 * Игрок строит жилища (лес, вулкан, кристальная пещера, облачный сад) и
 * повышает их уровень. Чем выше уровень, тем больше слотов под существ и тем
 * сильнее бонус к доходу острова:
 *
 *  - жилец подходящей стихии даёт +5% за уровень жилища;
 *  - жилец «не своей» стихии — +2% за уровень;
 *  - синергия: если в жилище живут двое и больше существ одной стихии,
 *    каждая дополнительная пара даёт +4% за уровень.
 *
 * Существо может жить только в одном жилище и должен быть в коллекции: если
 * копии закончились (например, ушли в слияние), жилец автоматически выселяется.
 *
 * Все функции здесь чистые — их удобно проверять тестами.
 */

import { balance } from './balance'
import { getCreature, isKnownCreatureId } from './creatures'
import type { ElementId } from './elements'

export type HabitatId = 'forest' | 'volcano' | 'crystal' | 'cloud'

export type HabitatDefinition = {
  id: HabitatId
  name: string
  emoji: string
  /** Стихии, которым здесь хорошо: их жильцы дают повышенный бонус. */
  elements: ElementId[]
  description: string
  /** Стоимость постройки (уровень 0 → 1). */
  baseCost: number
  /** Во сколько раз дорожает каждый следующий уровень. */
  costGrowth: number
  maxLevel: number
}

export type HabitatState = {
  level: number
  /** Существа, живущие здесь (id видов, без повторов). */
  residents: string[]
}

/** Потолок уровня жилища. */
export const MAX_HABITAT_LEVEL = 5

/** Бонус жильца подходящей стихии за уровень жилища. */
export const MATCHING_RESIDENT_BONUS = 0.05

/** Бонус жильца неподходящей стихии за уровень жилища. */
export const OTHER_RESIDENT_BONUS = 0.02

/** Синергия за каждого дополнительного жильца той же стихии. */
export const SYNERGY_BONUS = 0.04

export const habitatDefinitions: HabitatDefinition[] = [
  {
    id: 'forest',
    name: 'Лесная роща',
    emoji: '🌳',
    elements: ['nature', 'water'],
    description: 'Листва, ручьи и всё живое, что растёт.',
    baseCost: 400,
    costGrowth: 1.9,
    maxLevel: MAX_HABITAT_LEVEL,
  },
  {
    id: 'volcano',
    name: 'Вулкан',
    emoji: '🌋',
    elements: ['fire', 'stone'],
    description: 'Раскалённые камни и огненные духи.',
    baseCost: 800,
    costGrowth: 1.9,
    maxLevel: MAX_HABITAT_LEVEL,
  },
  {
    id: 'crystal',
    name: 'Кристальная пещера',
    emoji: '💎',
    elements: ['crystal', 'stone'],
    description: 'Гулкие залы, где растут кристаллы.',
    baseCost: 1500,
    costGrowth: 1.9,
    maxLevel: MAX_HABITAT_LEVEL,
  },
  {
    id: 'cloud',
    name: 'Облачный сад',
    emoji: '☁️',
    elements: ['sky'],
    description: 'Парящие грядки и небесные существа.',
    baseCost: 2500,
    costGrowth: 1.9,
    maxLevel: MAX_HABITAT_LEVEL,
  },
]

export const habitatIds: HabitatId[] = habitatDefinitions.map((definition) => definition.id)

const habitatIndex = new Map(habitatDefinitions.map((definition) => [definition.id, definition]))

export function isHabitatId(value: unknown): value is HabitatId {
  return typeof value === 'string' && habitatIndex.has(value as HabitatId)
}

export function getHabitatDefinition(id: HabitatId): HabitatDefinition {
  const definition = habitatIndex.get(id)
  if (!definition) throw new Error(`Неизвестное жилище: ${id}`)
  return definition
}

/** Сколько существ вмещает жилище такого уровня. Не построено — ноль. */
export function habitatSlots(level: number): number {
  if (level <= 0) return 0
  return Math.min(level, MAX_HABITAT_LEVEL) + 1
}

/**
 * Стоимость перехода с уровня `level` на `level + 1`.
 * Базовая цена берётся из описания жилища, а общий для всех жилищ множитель —
 * из `balance`: так grindy-настройка экономики живёт в одном месте.
 */
export function habitatCost(definition: HabitatDefinition, level: number): number {
  if (level >= definition.maxLevel) return Number.POSITIVE_INFINITY
  const base = definition.baseCost * balance.habitats.costMultiplier
  return Math.ceil(base * definition.costGrowth ** level)
}

export function createEmptyHabitats(): Record<HabitatId, HabitatState> {
  return {
    forest: { level: 0, residents: [] },
    volcano: { level: 0, residents: [] },
    crystal: { level: 0, residents: [] },
    cloud: { level: 0, residents: [] },
  }
}

/** Подходит ли существо этому жилищу: совпадает хотя бы одна стихия. */
export function habitatMatchesCreature(definition: HabitatDefinition, creatureId: string): boolean {
  const creature = getCreature(creatureId)
  if (!creature) return false
  return creature.elements.some((element) => definition.elements.includes(element))
}

export type HabitatBonus = {
  id: HabitatId
  level: number
  slots: number
  residents: string[]
  matching: string[]
  residentBonus: number
  synergyBonus: number
  bonus: number
}

export type HabitatSummary = {
  perHabitat: HabitatBonus[]
  totalBonus: number
  multiplier: number
  totalResidents: number
}

function normaliseLevel(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.min(Math.max(Math.floor(level), 0), MAX_HABITAT_LEVEL)
}

/** Жильцы, которые действительно живут здесь: существо есть в коллекции. */
function validResidents(
  state: HabitatState | undefined,
  ownedCreatures: Record<string, number>,
): string[] {
  const level = normaliseLevel(state?.level ?? 0)
  const slots = habitatSlots(level)
  if (slots === 0 || !state) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const id of state.residents) {
    if (result.length >= slots) break
    if (seen.has(id)) continue
    if (!isKnownCreatureId(id)) continue
    if ((ownedCreatures[id] ?? 0) <= 0) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function bonusForHabitat(
  definition: HabitatDefinition,
  level: number,
  residents: string[],
): { matching: string[]; residentBonus: number; synergyBonus: number } {
  const matching = residents.filter((id) => habitatMatchesCreature(definition, id))
  const others = residents.length - matching.length
  const residentBonus = level * (matching.length * MATCHING_RESIDENT_BONUS + others * OTHER_RESIDENT_BONUS)

  // Синергия: считаем стихии жильцов; каждая группа от двух существ даёт прибавку.
  const elementCounts = new Map<ElementId, number>()
  for (const id of residents) {
    const creature = getCreature(id)
    if (!creature) continue
    for (const element of creature.elements) {
      elementCounts.set(element, (elementCounts.get(element) ?? 0) + 1)
    }
  }

  let synergyBonus = 0
  for (const count of elementCounts.values()) {
    if (count < 2) continue
    synergyBonus += SYNERGY_BONUS * level * (count - 1)
  }

  return { matching, residentBonus, synergyBonus }
}

/**
 * Считает бонусы всех жилищ. Множитель дохода острова — `multiplier`
 * (1 — без жилищ, 1.35 — «+35% к доходу»).
 */
export function computeHabitatSummary(
  habitats: Record<HabitatId, HabitatState>,
  ownedCreatures: Record<string, number>,
): HabitatSummary {
  const perHabitat: HabitatBonus[] = []
  let totalBonus = 0
  let totalResidents = 0

  for (const definition of habitatDefinitions) {
    const state = habitats[definition.id]
    const level = normaliseLevel(state?.level ?? 0)
    const slots = habitatSlots(level)
    const residents = validResidents(state, ownedCreatures)
    const { matching, residentBonus, synergyBonus } = bonusForHabitat(definition, level, residents)

    const bonus = residentBonus + synergyBonus
    totalBonus += bonus
    totalResidents += residents.length

    perHabitat.push({
      id: definition.id,
      level,
      slots,
      residents,
      matching,
      residentBonus,
      synergyBonus,
      bonus,
    })
  }

  return {
    perHabitat,
    totalBonus,
    multiplier: 1 + totalBonus,
    totalResidents,
  }
}

/**
 * Приводит жилища из сохранения к безопасному виду: уровни в пределах лимита,
 * жильцы только из коллекции, без повторов и только в пределах слотов.
 */
export function sanitizeHabitats(
  raw: unknown,
  ownedCreatures: Record<string, number>,
): Record<HabitatId, HabitatState> {
  const result = createEmptyHabitats()
  if (typeof raw !== 'object' || raw === null) return result

  const source = raw as Record<string, unknown>
  const usedResidents = new Set<string>()

  for (const definition of habitatDefinitions) {
    const entry = source[definition.id]
    if (typeof entry !== 'object' || entry === null) continue

    const record = entry as Record<string, unknown>
    const level = normaliseLevel(typeof record.level === 'number' ? record.level : 0)
    const slots = habitatSlots(level)

    const residents: string[] = []
    if (Array.isArray(record.residents)) {
      for (const id of record.residents) {
        if (residents.length >= slots) break
        if (!isKnownCreatureId(id)) continue
        if (usedResidents.has(id)) continue
        if ((ownedCreatures[id] ?? 0) <= 0) continue
        usedResidents.add(id)
        residents.push(id)
      }
    }

    result[definition.id] = { level, residents }
  }

  return result
}

/** Выселяет жильцов, которых больше нет в коллекции (например, ушли в слияние). */
export function dropUnavailableResidents(
  habitats: Record<HabitatId, HabitatState>,
  ownedCreatures: Record<string, number>,
): Record<HabitatId, HabitatState> {
  return sanitizeHabitats(habitats, ownedCreatures)
}

export type ResidentCheck =
  | { ok: true }
  | { ok: false; reason: 'not-built' | 'not-owned' | 'already-resident' | 'no-slot' | 'unknown-creature' }

/** Проверяет, можно ли поселить существо в жилище. */
export function canAssignResident(
  habitats: Record<HabitatId, HabitatState>,
  ownedCreatures: Record<string, number>,
  habitatId: HabitatId,
  creatureId: string,
): ResidentCheck {
  if (!isKnownCreatureId(creatureId)) return { ok: false, reason: 'unknown-creature' }
  const state = habitats[habitatId]
  const level = normaliseLevel(state?.level ?? 0)
  if (level <= 0) return { ok: false, reason: 'not-built' }
  if ((ownedCreatures[creatureId] ?? 0) <= 0) return { ok: false, reason: 'not-owned' }

  for (const definition of habitatDefinitions) {
    const residents = habitats[definition.id]?.residents ?? []
    if (residents.includes(creatureId)) return { ok: false, reason: 'already-resident' }
  }

  const residents = validResidents(state, ownedCreatures)
  if (residents.length >= habitatSlots(level)) return { ok: false, reason: 'no-slot' }
  return { ok: true }
}

/** «+35%» — для подписей в интерфейсе. */
export function formatBonus(bonus: number): string {
  return `+${Math.round(bonus * 100)}%`
}
