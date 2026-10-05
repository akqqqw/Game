/**
 * Схема сохранения игры: версия, миграции и нормализация данных.
 *
 * Через `normalizeSave()` проходят ВСЕ сохранения — и локальные из IndexedDB,
 * и облачные из SDK. Данные считаются недоверенными: облако может вернуть
 * объект другого формата, старую версию схемы или мусор.
 *
 * Требования платформы: п. 1.9 (прогресс не теряется), 1.13.3 и 1.11
 * (облачные сохранения, доступ с разных устройств).
 */

import { achievements } from './achievements'
import { clickUpgradeCost, eggCostFor, referenceIncome, sunwellCost } from './balance'
import { isKnownCreatureId } from './creatures'
import type { DailyTask, DailyTaskKind } from './dailyTasks'
import { fusionRecipes } from './fusion'
import {
  computeHabitatSummary,
  createEmptyHabitats,
  sanitizeHabitats,
  type HabitatId,
  type HabitatState,
} from './habitats'

/**
 * Актуальная версия схемы сохранения.
 * Версия 4: цены покупок больше не хранятся как истина — они пересчитываются
 * из прогресса (число улучшений, вылупленных яиц), а в сохранении лежат только
 * для совместимости.
 */
export const SAVE_VERSION = 4

/** Ключ, под которым сохранение лежит в облаке Яндекс Игр. */
export const CLOUD_SAVE_KEY = 'evolution-isles-save'

/** Максимальный размер данных игрока в облаке — 200 КБ (ограничение SDK). */
export const CLOUD_SAVE_MAX_BYTES = 200_000

export type PersistedGame = {
  version: number
  energy: number
  clickPower: number
  energyPerSecond: number
  /** Сколько раз улучшали клик: из этого считается цена следующего улучшения. */
  clickUpgradeLevel: number
  /** Цена следующего улучшения клика — производная величина. */
  clickUpgradeCost: number
  sunwellLevel: number
  /** Цена следующего солнечного источника — производная величина. */
  sunwellCost: number
  /** Цена следующего яйца — производная величина. */
  eggCost: number
  ownedCreatures: Record<string, number>
  /** Мутировавшие копии существ: id вида → количество. */
  mutations: Record<string, number>
  /** Жилища: уровень и жильцы каждого. */
  habitats: Record<HabitatId, HabitatState>
  /** Открытые рецепты слияний (id существа-результата). */
  discoveredRecipes: string[]
  fusionsDone: number
  lastHatchedId: string | null
  stars: number
  eggInventory: number
  totalEnergyEarned: number
  eggsOpened: number
  upgradesBought: number
  totalClicks: number
  unlockedAchievements: string[]
  dailyTasks: DailyTask[]
  dailyTaskDate: string
  savedAt: number
}

/** Значения по умолчанию — используются и для новой игры, и для заполнения дыр. */
const baseDefaults: Omit<PersistedGame, 'savedAt' | 'version' | 'habitats'> = {
  energy: 0,
  clickPower: 1,
  energyPerSecond: 0,
  clickUpgradeLevel: 0,
  clickUpgradeCost: 25,
  sunwellLevel: 0,
  sunwellCost: 150,
  eggCost: 300,
  ownedCreatures: {},
  mutations: {},
  discoveredRecipes: [],
  fusionsDone: 0,
  lastHatchedId: null,
  stars: 0,
  eggInventory: 0,
  totalEnergyEarned: 0,
  eggsOpened: 0,
  upgradesBought: 0,
  totalClicks: 0,
  unlockedAchievements: [],
  dailyTasks: [],
  dailyTaskDate: '',
}

const dailyTaskKinds: DailyTaskKind[] = [
  'earn_energy',
  'open_eggs',
  'buy_upgrades',
  'fuse',
  'build_habitats',
]
const knownAchievementIds = new Set(achievements.map((achievement) => achievement.id))
const knownRecipeIds = new Set(fusionRecipes.map((recipe) => recipe.id))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type NumberOptions = { min?: number; max?: number; integer?: boolean }

function toNumber(value: unknown, fallback: number, options: NumberOptions = {}): number {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = options
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const clamped = Math.min(Math.max(value, min), max)
  return integer ? Math.floor(clamped) : clamped
}

function toInt(value: unknown, fallback = 0): number {
  return toNumber(value, fallback, { integer: true })
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function sanitizeOwnedCreatures(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  const result: Record<string, number> = {}
  for (const [id, rawLevel] of Object.entries(value)) {
    if (!isKnownCreatureId(id)) continue
    const level = toInt(rawLevel, 0)
    if (level > 0) result[id] = level
  }
  return result
}

/**
 * Мутации не могут превышать число копий вида: мутировавшая копия — это та же
 * особь, просто усиленная, поэтому её всегда «не больше», чем самих существ.
 */
function sanitizeMutations(value: unknown, ownedCreatures: Record<string, number>): Record<string, number> {
  if (!isRecord(value)) return {}
  const result: Record<string, number> = {}
  for (const [id, rawCount] of Object.entries(value)) {
    if (!isKnownCreatureId(id)) continue
    const owned = ownedCreatures[id] ?? 0
    const count = Math.min(toInt(rawCount, 0), owned)
    if (count > 0) result[id] = count
  }
  return result
}

function sanitizeRecipes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !knownRecipeIds.has(id) || result.includes(id)) continue
    result.push(id)
  }
  return result
}

function sanitizeAchievements(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !knownAchievementIds.has(id) || result.includes(id)) continue
    result.push(id)
  }
  return result
}

function sanitizeDailyTasks(value: unknown): DailyTask[] {
  if (!Array.isArray(value)) return []
  const result: DailyTask[] = []
  for (const rawTask of value) {
    if (!isRecord(rawTask)) continue
    const kind = rawTask.kind
    if (typeof kind !== 'string' || !dailyTaskKinds.includes(kind as DailyTaskKind)) continue
    const id = toText(rawTask.id, '')
    const title = toText(rawTask.title, '')
    if (!id || !title) continue
    result.push({
      id,
      kind: kind as DailyTaskKind,
      title,
      target: Math.max(1, toInt(rawTask.target, 1)),
      progress: toInt(rawTask.progress, 0),
      rewardStars: toInt(rawTask.rewardStars, 0),
      rewardEggs: toInt(rawTask.rewardEggs, 0),
      claimed: toBoolean(rawTask.claimed, false),
    })
  }
  return result
}

function sanitizeLastHatched(value: unknown): string | null {
  return typeof value === 'string' && isKnownCreatureId(value) ? value : null
}

/** Похож ли объект на сохранение игры (защита от посторонних данных в облаке). */
function looksLikeSave(raw: Record<string, unknown>): boolean {
  const numericKeys = ['energy', 'clickPower', 'energyPerSecond', 'clickUpgradeCost', 'totalClicks']
  return numericKeys.some((key) => typeof raw[key] === 'number' && Number.isFinite(raw[key]))
}

function detectVersion(raw: Record<string, unknown>): number {
  const version = raw.version
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) return 1
  return Math.floor(version)
}

type SaveMigration = (raw: Record<string, unknown>) => Record<string, unknown>

/**
 * Миграции между версиями схемы. Ключ — версия, ИЗ которой мигрируем.
 * Старые сохранения (без поля `version`) считаются версией 1.
 */
const migrations: Record<number, SaveMigration> = {
  1: (raw) => ({
    ...raw,
    version: 2,
    // До версии 2 пассивный доход мог быть не проставлен явно.
    energyPerSecond: typeof raw.energyPerSecond === 'number' ? raw.energyPerSecond : 1,
  }),
  // Версия 3 добавила слияния, мутации и жилища. Старый прогресс не теряется:
  // новые поля заполняются значениями по умолчанию в `buildSave`.
  2: (raw) => ({ ...raw, version: 3 }),
  // Версия 4 переводит цены на новый баланс. Число купленных улучшений клика
  // восстанавливаем из старой цены (25 × 1.65^уровень): игрок не теряет
  // прогресс, но следующие покупки стоят по новым правилам.
  3: (raw) => ({ ...raw, version: 4, clickUpgradeLevel: legacyClickLevel(raw.clickUpgradeCost) }),
}

/** Прежняя цена улучшения клика: 25 × 1.65^уровень. */
const LEGACY_CLICK_BASE_COST = 25
const LEGACY_CLICK_GROWTH = 1.65

/**
 * Восстанавливает число купленных улучшений клика из старой цены.
 * Ограничение сверху — защита от подделанного сохранения с огромной ценой.
 */
function legacyClickLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= LEGACY_CLICK_BASE_COST) return 0
  const level = Math.log(value / LEGACY_CLICK_BASE_COST) / Math.log(LEGACY_CLICK_GROWTH)
  return Math.min(1000, Math.max(0, Math.round(level)))
}

/**
 * Цены покупок — производные от прогресса, а не данные игрока.
 * Пересчитываются при каждой загрузке: подделанное сохранение не даст
 * дешёвых цен, а смена баланса сразу применяется к текущему прогрессу.
 */
function pricesForProgress(inputs: {
  clickUpgradeLevel: number
  sunwellLevel: number
  eggsOpened: number
  clickPower: number
  energyPerSecond: number
  habitatBonus: number
}): Pick<PersistedGame, 'clickUpgradeCost' | 'sunwellCost' | 'eggCost'> {
  const income = referenceIncome({
    clickPower: inputs.clickPower,
    energyPerSecond: inputs.energyPerSecond,
    habitatBonus: inputs.habitatBonus,
  })

  return {
    clickUpgradeCost: clickUpgradeCost(inputs.clickUpgradeLevel),
    sunwellCost: sunwellCost(inputs.sunwellLevel),
    eggCost: eggCostFor(inputs.eggsOpened, income),
  }
}

function buildSave(raw: Record<string, unknown>): PersistedGame {
  const ownedCreatures = sanitizeOwnedCreatures(raw.ownedCreatures)
  const habitats = sanitizeHabitats(raw.habitats, ownedCreatures)
  const clickUpgradeLevel = toInt(raw.clickUpgradeLevel, baseDefaults.clickUpgradeLevel)
  const sunwellLevel = toInt(raw.sunwellLevel, baseDefaults.sunwellLevel)
  const clickPower = toNumber(raw.clickPower, baseDefaults.clickPower)
  const energyPerSecond = toNumber(raw.energyPerSecond, baseDefaults.energyPerSecond)
  const eggsOpened = toInt(raw.eggsOpened, baseDefaults.eggsOpened)

  return {
    version: SAVE_VERSION,
    energy: toNumber(raw.energy, baseDefaults.energy),
    clickPower,
    energyPerSecond,
    clickUpgradeLevel,
    ...pricesForProgress({
      clickUpgradeLevel,
      sunwellLevel,
      eggsOpened,
      clickPower,
      energyPerSecond,
      habitatBonus: computeHabitatSummary(habitats, ownedCreatures).totalBonus,
    }),
    sunwellLevel,
    ownedCreatures,
    mutations: sanitizeMutations(raw.mutations, ownedCreatures),
    habitats,
    discoveredRecipes: sanitizeRecipes(raw.discoveredRecipes),
    fusionsDone: toInt(raw.fusionsDone, baseDefaults.fusionsDone),
    lastHatchedId: sanitizeLastHatched(raw.lastHatchedId),
    stars: toInt(raw.stars, baseDefaults.stars),
    eggInventory: toInt(raw.eggInventory, baseDefaults.eggInventory),
    totalEnergyEarned: toNumber(raw.totalEnergyEarned, baseDefaults.totalEnergyEarned),
    eggsOpened,
    upgradesBought: toInt(raw.upgradesBought, baseDefaults.upgradesBought),
    totalClicks: toInt(raw.totalClicks, baseDefaults.totalClicks),
    unlockedAchievements: sanitizeAchievements(raw.unlockedAchievements),
    dailyTasks: sanitizeDailyTasks(raw.dailyTasks),
    dailyTaskDate: toText(raw.dailyTaskDate, baseDefaults.dailyTaskDate),
    savedAt: toNumber(raw.savedAt, 0),
  }
}

/**
 * Приводит любое значение к актуальной схеме сохранения.
 * Возвращает `null`, если данные не похожи на сохранение этой игры.
 */
export function normalizeSave(raw: unknown): PersistedGame | null {
  if (!isRecord(raw)) return null
  if (!looksLikeSave(raw)) return null

  let current = raw
  let version = detectVersion(current)
  let guard = 0

  while (version < SAVE_VERSION && guard < 16) {
    const migration = migrations[version]
    if (!migration) break
    current = migration(current)
    version = detectVersion(current)
    guard += 1
  }

  return buildSave(current)
}

/** Новая игра: сохранение с нулевым прогрессом. */
export function createNewSave(savedAt = 0): PersistedGame {
  return { ...baseDefaults, habitats: createEmptyHabitats(), version: SAVE_VERSION, savedAt }
}

/** Пустой ли прогресс: нужно, чтобы не перезатирать достижения пустым облаком. */
export function isEmptyProgress(save: PersistedGame): boolean {
  const hasHabitat = Object.values(save.habitats).some(
    (habitat) => habitat.level > 0 || habitat.residents.length > 0,
  )

  return save.energy <= 0
    && save.totalClicks === 0
    && save.totalEnergyEarned === 0
    && save.eggsOpened === 0
    && save.upgradesBought === 0
    && save.stars === 0
    && save.eggInventory === 0
    && save.fusionsDone === 0
    && Object.keys(save.ownedCreatures).length === 0
    && Object.keys(save.mutations).length === 0
    && save.discoveredRecipes.length === 0
    && !hasHabitat
}

/**
 * Численная оценка «продвинутости» сохранения.
 * Используется только для логов и уведомлений, решение принимается по времени.
 */
export function progressScore(save: PersistedGame): number {
  const collectionValue = Object.values(save.ownedCreatures).reduce((total, level) => total + level, 0)
  const mutationValue = Object.values(save.mutations).reduce((total, level) => total + level, 0)
  const habitatValue = Object.values(save.habitats).reduce(
    (total, habitat) => total + habitat.level * 2000,
    0,
  )

  return save.totalEnergyEarned
    + save.energy
    + save.upgradesBought * 250
    + save.eggsOpened * 500
    + collectionValue * 750
    + save.stars * 100
    + save.totalClicks
    + save.fusionsDone * 1000
    + mutationValue * 1500
    + save.discoveredRecipes.length * 900
    + habitatValue
}
