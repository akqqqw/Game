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
import type { DailyTask, DailyTaskKind } from './dailyTasks'
import { creatures } from './creatures'

/** Актуальная версия схемы сохранения. */
export const SAVE_VERSION = 2

/** Ключ, под которым сохранение лежит в облаке Яндекс Игр. */
export const CLOUD_SAVE_KEY = 'evolution-isles-save'

/** Максимальный размер данных игрока в облаке — 200 КБ (ограничение SDK). */
export const CLOUD_SAVE_MAX_BYTES = 200_000

export type PersistedGame = {
  version: number
  energy: number
  clickPower: number
  energyPerSecond: number
  clickUpgradeCost: number
  sunwellLevel: number
  sunwellCost: number
  eggCost: number
  ownedCreatures: Record<string, number>
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
const baseDefaults: Omit<PersistedGame, 'savedAt' | 'version'> = {
  energy: 0,
  clickPower: 1,
  energyPerSecond: 0,
  clickUpgradeCost: 25,
  sunwellLevel: 0,
  sunwellCost: 75,
  eggCost: 100,
  ownedCreatures: {},
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

const dailyTaskKinds: DailyTaskKind[] = ['earn_energy', 'open_eggs', 'buy_upgrades']
const knownCreatureIds = new Set(creatures.map((creature) => creature.id))
const knownAchievementIds = new Set(achievements.map((achievement) => achievement.id))

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
    if (!knownCreatureIds.has(id)) continue
    const level = toInt(rawLevel, 0)
    if (level > 0) result[id] = level
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
  return typeof value === 'string' && knownCreatureIds.has(value) ? value : null
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
}

function buildSave(raw: Record<string, unknown>): PersistedGame {
  return {
    version: SAVE_VERSION,
    energy: toNumber(raw.energy, baseDefaults.energy),
    clickPower: toNumber(raw.clickPower, baseDefaults.clickPower),
    energyPerSecond: toNumber(raw.energyPerSecond, baseDefaults.energyPerSecond),
    clickUpgradeCost: Math.max(1, toNumber(raw.clickUpgradeCost, baseDefaults.clickUpgradeCost)),
    sunwellLevel: toInt(raw.sunwellLevel, baseDefaults.sunwellLevel),
    sunwellCost: Math.max(1, toNumber(raw.sunwellCost, baseDefaults.sunwellCost)),
    eggCost: Math.max(1, toNumber(raw.eggCost, baseDefaults.eggCost)),
    ownedCreatures: sanitizeOwnedCreatures(raw.ownedCreatures),
    lastHatchedId: sanitizeLastHatched(raw.lastHatchedId),
    stars: toInt(raw.stars, baseDefaults.stars),
    eggInventory: toInt(raw.eggInventory, baseDefaults.eggInventory),
    totalEnergyEarned: toNumber(raw.totalEnergyEarned, baseDefaults.totalEnergyEarned),
    eggsOpened: toInt(raw.eggsOpened, baseDefaults.eggsOpened),
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
  return { ...baseDefaults, version: SAVE_VERSION, savedAt }
}

/** Пустой ли прогресс: нужно, чтобы не перезатирать достижения пустым облаком. */
export function isEmptyProgress(save: PersistedGame): boolean {
  return save.energy <= 0
    && save.totalClicks === 0
    && save.totalEnergyEarned === 0
    && save.eggsOpened === 0
    && save.upgradesBought === 0
    && save.stars === 0
    && save.eggInventory === 0
    && Object.keys(save.ownedCreatures).length === 0
}

/**
 * Численная оценка «продвинутости» сохранения.
 * Используется только для логов и уведомлений, решение принимается по времени.
 */
export function progressScore(save: PersistedGame): number {
  const collectionValue = Object.values(save.ownedCreatures).reduce((total, level) => total + level, 0)
  return save.totalEnergyEarned
    + save.energy
    + save.upgradesBought * 250
    + save.eggsOpened * 500
    + collectionValue * 750
    + save.stars * 100
    + save.totalClicks
}
