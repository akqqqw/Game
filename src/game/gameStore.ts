import { create } from 'zustand'
import { noteGameAction } from '../platform/ads'
import { initCloudAutoSync, pushCloudSave, queueCloudSave, readCloudSave } from '../platform/cloudSave'
import { getSdkSession, getSdkSessionSync, onSdkSessionChange, type SdkSession } from '../platform/yandexSdk'
import { achievements, getAchievementProgress } from './achievements'
import {
  balance,
  clickUpgradeCost,
  eggCostFor,
  fusionCostFor,
  offlineLimitSeconds,
  referenceIncome,
  sunwellCost,
} from './balance'
import { eggPool, getCreature, secretCreatures } from './creatures'
import { advanceDailyTasks, createDailyTasks, getTodayKey, type DailyTask } from './dailyTasks'
import { MUTATION_CHANCE_EGG, MUTATION_CHANCE_FUSION, findRecipe } from './fusion'
import type { GameProgress } from './gameProgress'
import {
  canAssignResident,
  computeHabitatSummary,
  createEmptyHabitats,
  dropUnavailableResidents,
  getHabitatDefinition,
  habitatCost,
  habitatSlots,
  type HabitatId,
  type HabitatState,
  type HabitatSummary,
} from './habitats'
import { loadGame, saveBackupSave, saveGame } from './saveGame'
import { resolveSaveConflict } from './saveMerge'
import { SAVE_VERSION, type PersistedGame } from './saveSchema'

/** Итог попытки слияния — интерфейс показывает по нему понятное сообщение. */
export type FusionOutcome =
  | { ok: true; resultId: string; mutated: boolean; cost: number }
  | { ok: false; reason: 'no-recipe' | 'not-owned' | 'not-enough-energy' }

type GameState = {
  energy: number
  clickPower: number
  energyPerSecond: number
  /** Сколько раз улучшали клик — из этого считается цена следующей покупки. */
  clickUpgradeLevel: number
  /** Цена следующего улучшения клика: производная от уровня, не хранится как истина. */
  clickUpgradeCost: number
  sunwellLevel: number
  /** Цена следующего солнечного источника: производная от уровня. */
  sunwellCost: number
  /** Цена следующего яйца: производная от числа вылуплений и дохода острова. */
  eggCost: number
  ownedCreatures: Record<string, number>
  /** Мутировавшие копии видов: id → количество. */
  mutations: Record<string, number>
  /** Жилища: уровень и жильцы. */
  habitats: Record<HabitatId, HabitatState>
  /** Суммарная прибавка к доходу от жилищ (0.35 = +35%). */
  habitatBonus: number
  /** Подробный расчёт бонусов — для интерфейса. */
  habitatSummary: HabitatSummary
  /** Открытые рецепты слияний. */
  discoveredRecipes: string[]
  fusionsDone: number
  lastHatchedId: string | null
  /** Вылупилась ли последняя особь мутировавшей. */
  lastHatchedMutated: boolean
  stars: number
  eggInventory: number
  totalEnergyEarned: number
  eggsOpened: number
  upgradesBought: number
  dailyTasks: DailyTask[]
  dailyTaskDate: string
  totalClicks: number
  unlockedAchievements: string[]
  achievementNotice: string | null
  /** Сообщение о результате слияния. */
  fusionNotice: string | null
  offlineEnergy: number
  hydrated: boolean
  /** Уведомление о работе с облачным сохранением. */
  cloudNotice: string | null
  addEnergy: () => void
  /**
   * Начисляет пассивный доход за `seconds` прошедшего времени.
   * Вызывается только из `passiveIncome` — там же ограничение по времени.
   */
  accruePassiveEnergy: (seconds: number) => void
  buyClickUpgrade: () => boolean
  buySunwell: () => boolean
  openEgg: () => boolean
  /** Соединяет двух существ. Порядок родителей не важен. */
  fuseCreatures: (aId: string, bId: string) => FusionOutcome
  /** Строит жилище (уровень 0 → 1) или повышает его уровень. */
  upgradeHabitat: (habitatId: HabitatId) => boolean
  /** Селяет существо (при необходимости переносит из другого жилища). */
  assignResident: (habitatId: HabitatId, creatureId: string) => boolean
  /** Выселяет существо из жилища. */
  removeResident: (habitatId: HabitatId, creatureId: string) => boolean
  claimTask: (taskId: string) => boolean
  dismissAchievementNotice: () => void
  dismissFusionNotice: () => void
  dismissCloudNotice: () => void
  hydrate: () => Promise<void>
  /** Перечитать облако после авторизации игрока. */
  syncCloudAfterAuthorization: () => Promise<void>
}

const emptyHabitatState = recomputeHabitats(createEmptyHabitats(), {})

/**
 * Цены покупок — производные от прогресса. Считаются при каждом обновлении
 * состояния, поэтому не могут «отстать» от счётчиков, а сохранение не может
 * назначить их самому себе (при загрузке они пересчитываются заново).
 */
function derivedPrices(state: {
  clickUpgradeLevel: number
  sunwellLevel: number
  eggsOpened: number
  clickPower: number
  energyPerSecond: number
  habitatBonus: number
}): Pick<GameState, 'clickUpgradeCost' | 'sunwellCost' | 'eggCost'> {
  const income = referenceIncome({
    clickPower: state.clickPower,
    energyPerSecond: state.energyPerSecond,
    habitatBonus: state.habitatBonus,
  })

  return {
    clickUpgradeCost: clickUpgradeCost(state.clickUpgradeLevel),
    sunwellCost: sunwellCost(state.sunwellLevel),
    eggCost: eggCostFor(state.eggsOpened, income),
  }
}

/**
 * Накладывает изменение на состояние и заново считает цены.
 * Единственный путь записи в стор: и действия игры, и внешние обновления
 * (например, из тестов) проходят здесь, поэтому цены не могут «отстать» от
 * прогресса, чем бы ни изменилось состояние.
 */
function withPrices(
  state: GameState,
  partial: Partial<GameState> | ((current: GameState) => Partial<GameState>),
): Partial<GameState> {
  const next = typeof partial === 'function' ? partial(state) : partial
  return { ...next, ...derivedPrices({ ...state, ...next }) }
}

export const useGameStore = create<GameState>((setBase, get) => {
  const set = (
    partial: Partial<GameState> | ((state: GameState) => Partial<GameState>),
  ): void => {
    setBase((state) => withPrices(state, partial))
  }

  return {
    energy: 0,
    clickPower: 1,
    energyPerSecond: 1,
    clickUpgradeLevel: 0,
    clickUpgradeCost: clickUpgradeCost(0),
    sunwellLevel: 0,
    sunwellCost: sunwellCost(0),
    eggCost: eggCostFor(0, referenceIncome({ clickPower: 1, energyPerSecond: 1, habitatBonus: 0 })),
    ownedCreatures: {},
    mutations: {},
    discoveredRecipes: [],
    fusionsDone: 0,
    lastHatchedId: null,
    lastHatchedMutated: false,
    fusionNotice: null,
    ...emptyHabitatState,
    stars: 0,
    eggInventory: 0,
    totalEnergyEarned: 0,
    eggsOpened: 0,
    upgradesBought: 0,
    dailyTasks: [],
    dailyTaskDate: '',
    totalClicks: 0,
    unlockedAchievements: [],
    achievementNotice: null,
    offlineEnergy: 0,
    hydrated: false,
    cloudNotice: null,
    addEnergy: () =>
      set((state) => {
        // Пейсинг рекламы: счётчик действий игрока (показ рекламы не запускает).
        noteGameAction()
        const gain = state.clickPower * incomeMultiplier(state)
        const nextState = {
          energy: state.energy + gain,
          totalClicks: state.totalClicks + 1,
          totalEnergyEarned: state.totalEnergyEarned + gain,
          dailyTasks: advanceDailyTasks(state.dailyTasks, 'earn_energy', gain),
        }
        const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
        void persistState({ ...state, ...finalState })
        return finalState
      }),
    accruePassiveEnergy: (seconds) =>
      set((state) => {
        const gained = state.energyPerSecond * incomeMultiplier(state) * seconds
        if (!Number.isFinite(gained) || gained <= 0) return state

        const nextState = {
          energy: state.energy + gained,
          totalEnergyEarned: state.totalEnergyEarned + gained,
          dailyTasks: advanceDailyTasks(state.dailyTasks, 'earn_energy', gained),
        }
        const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
        void persistState({ ...state, ...finalState })
        return finalState
      }),
    buyClickUpgrade: () => {
      const state = get()
      if (state.energy < state.clickUpgradeCost) return false
      noteGameAction()

      const nextState = {
        energy: state.energy - state.clickUpgradeCost,
        clickPower: state.clickPower + balance.click.powerGain,
        clickUpgradeLevel: state.clickUpgradeLevel + 1,
        upgradesBought: state.upgradesBought + 1,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'buy_upgrades', 1),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      set(finalState)
      void persistState({ ...state, ...finalState })
      return true
    },
    buySunwell: () => {
      const state = get()
      if (state.energy < state.sunwellCost) return false
      noteGameAction()

      const nextState = {
        energy: state.energy - state.sunwellCost,
        energyPerSecond: state.energyPerSecond + balance.sunwell.productionGain,
        sunwellLevel: state.sunwellLevel + 1,
        upgradesBought: state.upgradesBought + 1,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'buy_upgrades', 1),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      set(finalState)
      void persistState({ ...state, ...finalState })
      return true
    },
    openEgg: () => {
      const state = get()
      const usesInventoryEgg = state.eggInventory > 0
      if (!usesInventoryEgg && state.energy < state.eggCost) return false

      const roll = Math.random() * 100
      let threshold = 0
      const creature = eggPool.find((candidate) => {
        threshold += candidate.weight
        return roll < threshold
      })
      const hatched = creature ?? eggPool[0]
      if (!hatched) return false
      noteGameAction()

      // Мутация: шанс небольшой, но мутировавшая копия удваивает бонус вида.
      const mutated = Math.random() < MUTATION_CHANCE_EGG
      const units = mutated ? 2 : 1

      const ownedCreatures = {
        ...state.ownedCreatures,
        [hatched.id]: (state.ownedCreatures[hatched.id] ?? 0) + 1,
      }
      const nextState = {
        energy: usesInventoryEgg ? state.energy : state.energy - state.eggCost,
        eggInventory: usesInventoryEgg ? state.eggInventory - 1 : state.eggInventory,
        clickPower: state.clickPower + hatched.clickBonus * units,
        energyPerSecond: state.energyPerSecond + hatched.productionBonus * units,
        ownedCreatures,
        mutations: mutated
          ? { ...state.mutations, [hatched.id]: (state.mutations[hatched.id] ?? 0) + 1 }
          : state.mutations,
        lastHatchedId: hatched.id,
        lastHatchedMutated: mutated,
        eggsOpened: state.eggsOpened + 1,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'open_eggs', 1),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      set(finalState)
      void persistState({ ...state, ...finalState })
      return true
    },
    fuseCreatures: (aId, bId) => {
      const state = get()
      const recipe = findRecipe(aId, bId)
      if (!recipe) return { ok: false, reason: 'no-recipe' }

      const result = getCreature(recipe.result)
      if (!result) return { ok: false, reason: 'no-recipe' }

      // Для слияния одного и того же вида нужно две копии.
      const needed = aId === bId ? 2 : 1
      if ((state.ownedCreatures[aId] ?? 0) < needed) return { ok: false, reason: 'not-owned' }
      if (aId !== bId && (state.ownedCreatures[bId] ?? 0) < 1) return { ok: false, reason: 'not-owned' }
      const cost = fusionCostFor(recipe.cost)
      if (state.energy < cost) return { ok: false, reason: 'not-enough-energy' }
      noteGameAction()

      // Родители расходуются: обычные копии уходят первыми, мутировавшие — в последнюю очередь.
      let ownedCreatures = { ...state.ownedCreatures }
      let mutations = { ...state.mutations }
      let removedClick = 0
      let removedProduction = 0

      for (const parentId of recipe.ingredients) {
        const consumed = consumeCopy(ownedCreatures, mutations, parentId)
        if (!consumed) return { ok: false, reason: 'not-owned' }
        ownedCreatures = consumed.ownedCreatures
        mutations = consumed.mutations
        const parent = getCreature(parentId)
        removedClick += (parent?.clickBonus ?? 0) * consumed.units
        removedProduction += (parent?.productionBonus ?? 0) * consumed.units
      }

      const mutated = Math.random() < MUTATION_CHANCE_FUSION
      const units = mutated ? 2 : 1

      ownedCreatures[result.id] = (ownedCreatures[result.id] ?? 0) + 1
      if (mutated) mutations[result.id] = (mutations[result.id] ?? 0) + 1

      const nextState = {
        energy: state.energy - cost,
        clickPower: Math.max(0, state.clickPower - removedClick + result.clickBonus * units),
        energyPerSecond: Math.max(0, state.energyPerSecond - removedProduction + result.productionBonus * units),
        ownedCreatures,
        mutations,
        // Жильцы, чьи копии ушли в слияние, выселяются автоматически.
        ...recomputeHabitats(state.habitats, ownedCreatures),
        discoveredRecipes: state.discoveredRecipes.includes(recipe.id)
          ? state.discoveredRecipes
          : [...state.discoveredRecipes, recipe.id],
        fusionsDone: state.fusionsDone + 1,
        lastHatchedId: null,
        fusionNotice: mutated
          ? `Слияние удалось: ${result.name} ✦ мутация!`
          : `Слияние удалось: ${result.name}`,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'fuse', 1),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      set(finalState)
      void persistState({ ...state, ...finalState })
      return { ok: true, resultId: result.id, mutated, cost }
    },
    upgradeHabitat: (habitatId) => {
      const state = get()
      const definition = getHabitatDefinition(habitatId)
      const current = state.habitats[habitatId] ?? { level: 0, residents: [] }
      if (current.level >= definition.maxLevel) return false

      const cost = habitatCost(definition, current.level)
      if (!Number.isFinite(cost) || state.energy < cost) return false
      noteGameAction()

      const level = current.level + 1
      const habitats = {
        ...state.habitats,
        [habitatId]: { level, residents: current.residents.slice(0, habitatSlots(level)) },
      }
      const nextState = {
        energy: state.energy - cost,
        ...recomputeHabitats(habitats, state.ownedCreatures),
        upgradesBought: state.upgradesBought + 1,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'build_habitats', 1),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      set(finalState)
      void persistState({ ...state, ...finalState })
      return true
    },
    assignResident: (habitatId, creatureId) => {
      const state = get()
      const check = canAssignResident(state.habitats, state.ownedCreatures, habitatId, creatureId)
      // «Уже живёт» — это не ошибка: существо просто переезжает в другое жилище.
      if (!check.ok && check.reason !== 'already-resident') return false

      const habitats: Record<HabitatId, HabitatState> = { ...state.habitats }
      for (const id of Object.keys(habitats) as HabitatId[]) {
        habitats[id] = { ...habitats[id], residents: habitats[id].residents.filter((id2) => id2 !== creatureId) }
      }

      const target = habitats[habitatId]
      if (target.residents.length >= habitatSlots(target.level)) return false
      habitats[habitatId] = { ...target, residents: [...target.residents, creatureId] }

      const nextState = { ...recomputeHabitats(habitats, state.ownedCreatures) }
      set(nextState)
      void persistState({ ...get() })
      return true
    },
    removeResident: (habitatId, creatureId) => {
      const state = get()
      const habitat = state.habitats[habitatId]
      if (!habitat || !habitat.residents.includes(creatureId)) return false

      const habitats = {
        ...state.habitats,
        [habitatId]: { ...habitat, residents: habitat.residents.filter((id) => id !== creatureId) },
      }
      set({ ...recomputeHabitats(habitats, state.ownedCreatures) })
      void persistState({ ...get() })
      return true
    },
    claimTask: (taskId) => {
      const state = get()
      const task = state.dailyTasks.find((candidate) => candidate.id === taskId)
      if (!task || task.claimed || task.progress < task.target) return false

      const nextState = {
        stars: state.stars + task.rewardStars,
        eggInventory: state.eggInventory + task.rewardEggs,
        dailyTasks: state.dailyTasks.map((candidate) => candidate.id === taskId
          ? { ...candidate, claimed: true }
          : candidate),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      set(finalState)
      void persistState({ ...state, ...finalState })
      return true
    },
    dismissAchievementNotice: () => {
      set({ achievementNotice: null })
      void persistState(get())
    },
    dismissFusionNotice: () => {
      set({ fusionNotice: null })
      void persistState(get())
    },
    dismissCloudNotice: () => {
      set({ cloudNotice: null })
    },
    syncCloudAfterAuthorization: async () => {
      if (!get().hydrated) return
      const cloudSave = await readCloudSave()
      if (!cloudSave) {
        // Облако пустое — просто начинаем синхронизацию текущего прогресса.
        await pushCloudSave(buildPersistedSave(get()))
        return
      }

      const localSave = buildPersistedSave(get())
      // Сравниваем с прогрессом, который был ДО текущей сессии: иначе локальная
      // метка времени всегда «свежее» и облако никогда бы не загрузилось.
      const localForComparison = { ...localSave, savedAt: localBaselineSavedAt }
      const merged = resolveSaveConflict(localForComparison, cloudSave)
      if (!merged) return

      if (merged.source === 'cloud') {
        const nextState = applyPersistedSave(merged.save, 0)
        set({ ...nextState, cloudNotice: merged.notice })
        await persistBackup(localSave)
        // Локально сохраняем сразу, в облако не пишем: там уже эта версия.
        await persistState(get(), { cloud: false })
        return
      }

      set({ cloudNotice: merged.notice ?? 'Прогресс сохранён в облако.' })
      if (merged.backup) await persistBackup(merged.backup)
      await pushCloudSave(buildPersistedSave(get()))
    },
    hydrate: async () => {
      // Чтение сохранения не должно останавливать игру: при недоступном
      // хранилище (приватный режим, заблокированный IndexedDB) стартуем с нуля.
      const localSave = await safeLoadLocalSave()
      // Облако сравниваем ДО первой записи локального прогресса, иначе только что
      // сохранённые данные всегда выглядели бы свежее облачных.
      const session = await waitForSdkSession()
      authorizedAtHydrate = session?.isAuthorized ?? false
      const cloudSave = session?.isAuthorized ? await readCloudGuarded() : null
      const merged = resolveSaveConflict(localSave, cloudSave)

      if (!merged) {
        const today = getTodayKey()
        set({
          dailyTasks: createDailyTasks(today),
          dailyTaskDate: today,
          hydrated: true,
          cloudNotice: null,
        })
        void persistState(get())
        initCloudAutoSync()
        return
      }

      localBaselineSavedAt = merged.save.savedAt
      const nextState = applyPersistedSave(
        merged.save,
        calculateOfflineEnergy(merged.save.energyPerSecond, merged.save.habitats, merged.save.ownedCreatures, merged.save.savedAt),
      )
      const finalState = { ...nextState, ...applyAchievementRewards({ ...get(), ...nextState }) }

      set({
        ...finalState,
        cloudNotice: merged.notice,
        hydrated: true,
      })

      // Проигравшая версия уходит в резервный слот — старые сохранения не теряются.
      if (merged.backup) await persistBackup(merged.backup)

      await persistState(get())
      // Локальный прогресс новее облачного — обновляем облако.
      if (merged.source === 'local' && cloudSave) {
        await pushCloudSave(buildPersistedSave(get()))
      }
      initCloudAutoSync()
    },
  }
})

/**
 * Внешние обновления (тесты, отладочные инструменты) тоже проходят через
 * пересчёт цен — иначе засеянное состояние могло бы держать устаревшие цены.
 */
const rawSetState = useGameStore.setState.bind(useGameStore)
useGameStore.setState = ((partial, replace) => {
  if (replace) {
    rawSetState(partial as GameState, true)
    return
  }
  rawSetState((state: GameState) => withPrices(
    state,
    typeof partial === 'function'
      ? (partial as (current: GameState) => Partial<GameState>)
      : (partial as Partial<GameState>),
  ) as GameState)
}) as typeof useGameStore.setState

export const useEnergy = () => useGameStore((state) => state.energy)

/** Множитель дохода от жилищ: 1 — жилищ нет. */
export function incomeMultiplier(state: Pick<GameState, 'habitatBonus'>): number {
  return 1 + Math.max(0, state.habitatBonus)
}

/** Пересчитывает нормализованные жилища и их бонусы. */
function recomputeHabitats(
  habitats: Record<HabitatId, HabitatState>,
  ownedCreatures: Record<string, number>,
): Pick<GameState, 'habitats' | 'habitatBonus' | 'habitatSummary'> {
  const normalized = dropUnavailableResidents(habitats, ownedCreatures)
  const summary = computeHabitatSummary(normalized, ownedCreatures)
  return { habitats: normalized, habitatBonus: summary.totalBonus, habitatSummary: summary }
}

/**
 * Забирает одну копию существа, предпочитая обычные копии.
 * Возвращает, сколько «бонусных единиц» ушло: 1 за обычную копию и 2 за
 * мутировавшую (мутация удваивает бонус вида).
 */
function consumeCopy(
  ownedCreatures: Record<string, number>,
  mutations: Record<string, number>,
  creatureId: string,
): { ownedCreatures: Record<string, number>; mutations: Record<string, number>; units: number } | null {
  const count = ownedCreatures[creatureId] ?? 0
  if (count <= 0) return null

  const mutated = mutations[creatureId] ?? 0
  const nextOwned = { ...ownedCreatures, [creatureId]: count - 1 }
  if (nextOwned[creatureId] <= 0) delete nextOwned[creatureId]

  // Свободные (немутировавшие) копии закончились — уходит мутировавшая.
  if (count - mutated <= 0) {
    const nextMutations = { ...mutations }
    if (mutated - 1 > 0) nextMutations[creatureId] = mutated - 1
    else delete nextMutations[creatureId]
    return { ownedCreatures: nextOwned, mutations: nextMutations, units: 2 }
  }

  return { ownedCreatures: nextOwned, mutations, units: 1 }
}

/** Собирает сохраняемый снимок из состояния стора. */
function buildPersistedSave(state: GameState): PersistedGame {
  return {
    version: SAVE_VERSION,
    energy: state.energy,
    clickPower: state.clickPower,
    energyPerSecond: state.energyPerSecond,
    clickUpgradeLevel: state.clickUpgradeLevel,
    sunwellLevel: state.sunwellLevel,
    ...derivedPrices(state),
    ownedCreatures: state.ownedCreatures,
    mutations: state.mutations,
    habitats: state.habitats,
    discoveredRecipes: state.discoveredRecipes,
    fusionsDone: state.fusionsDone,
    lastHatchedId: state.lastHatchedId,
    stars: state.stars,
    eggInventory: state.eggInventory,
    totalEnergyEarned: state.totalEnergyEarned,
    eggsOpened: state.eggsOpened,
    upgradesBought: state.upgradesBought,
    totalClicks: state.totalClicks,
    unlockedAchievements: state.unlockedAchievements,
    dailyTasks: state.dailyTasks,
    dailyTaskDate: state.dailyTaskDate,
    savedAt: Date.now(),
  }
}

/**
 * Преобразует сохранение в состояние стора: добавляет офлайн-доход,
 * обновляет ежедневные задания по дате и сбрасывает достижения.
 */
function applyPersistedSave(
  save: PersistedGame,
  offlineEnergy: number,
): Partial<GameState> {
  const today = getTodayKey()
  const dailyTasks = save.dailyTaskDate === today && save.dailyTasks.length > 0
    ? save.dailyTasks
    : createDailyTasks(today)
  // `version` и `savedAt` — детали формата хранения, в состоянии стора не нужны.
  const { version: _version, savedAt: _savedAt, ...gameFields } = save

  return {
    ...gameFields,
    // Жилища нормализуются: жильцы, которых больше нет в коллекции, выселяются.
    ...recomputeHabitats(save.habitats, save.ownedCreatures),
    energy: save.energy + offlineEnergy,
    totalEnergyEarned: save.totalEnergyEarned + offlineEnergy,
    achievementNotice: null,
    fusionNotice: null,
    lastHatchedMutated: false,
    dailyTasks,
    dailyTaskDate: today,
    offlineEnergy,
    hydrated: true,
  }
}

/** Сколько ждём инициализацию SDK перед выбором сохранения. */
const SDK_SESSION_WAIT_MS = 2000

/** Был ли игрок авторизован на момент загрузки сохранения. */
let authorizedAtHydrate = false

/** `savedAt` прогресса, с которого началась текущая сессия (до первых записей). */
let localBaselineSavedAt = 0

/** Офлайн-доход за время отсутствия (не больше лимита из баланса), с бонусом жилищ. */
function calculateOfflineEnergy(
  energyPerSecond: number,
  habitats: Record<HabitatId, HabitatState>,
  ownedCreatures: Record<string, number>,
  savedAt: number,
): number {
  const elapsedSeconds = Math.min(
    Math.max(0, Math.floor((Date.now() - savedAt) / 1000)),
    offlineLimitSeconds(),
  )
  const bonus = computeHabitatSummary(habitats, ownedCreatures).totalBonus
  return elapsedSeconds * energyPerSecond * (1 + bonus)
}

async function safeLoadLocalSave(): Promise<PersistedGame | null> {
  try {
    return await loadGame()
  } catch (error) {
    console.info('[save] Не удалось прочитать локальное сохранение:', error)
    return null
  }
}

/** Облако читаем только для авторизованного игрока: гостю оно недоступно. */
async function readCloudGuarded(): Promise<PersistedGame | null> {
  try {
    return await readCloudSave()
  } catch (error) {
    console.info('[cloud] Облачное сохранение недоступно:', error)
    return null
  }
}

/**
 * Ждёт инициализацию SDK, но не дольше `SDK_SESSION_WAIT_MS`: игру нельзя
 * задерживать из-за платформы. Если сессия не успела — работаем с локальным
 * сохранением, а облако подтянется сразу после инициализации (см. ниже).
 */
async function waitForSdkSession(): Promise<SdkSession | null> {
  const resolved = getSdkSessionSync()
  if (resolved) return resolved

  return Promise.race([
    getSdkSession(),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), SDK_SESSION_WAIT_MS)
    }),
  ])
}

async function persistBackup(save: PersistedGame): Promise<void> {
  try {
    await saveBackupSave(save)
  } catch (error) {
    console.info('[save] Не удалось сохранить резервную копию:', error)
  }
}

/**
 * Записывает прогресс: локально — сразу, в облако — с задержкой,
 * чтобы не превысить лимиты SDK.
 */
async function persistState(state: GameState, options: { cloud?: boolean } = {}): Promise<void> {
  const persistedState = buildPersistedSave(state)

  try {
    await saveGame(persistedState)
  } catch (error) {
    console.info('[save] Не удалось записать прогресс:', error)
  }

  if (options.cloud !== false && getSdkSessionSync()?.isAuthorized) {
    queueCloudSave(persistedState)
  }
}

/**
 * Реагирует на появление авторизации (игрок вошёл сам или SDK ответил уже после
 * старта игры): подтягиваем облачный прогресс и начинаем синхронизацию.
 */
function bindCloudSyncOnAuthorization(): void {
  onSdkSessionChange((session) => {
    const becameAuthorized = session.isAuthorized && !authorizedAtHydrate
    authorizedAtHydrate = session.isAuthorized
    if (!becameAuthorized || !useGameStore.getState().hydrated) return
    void useGameStore.getState().syncCloudAfterAuthorization()
  })
}

bindCloudSyncOnAuthorization()

function applyAchievementRewards(state: GameState): Pick<GameState, 'stars' | 'eggInventory' | 'unlockedAchievements' | 'achievementNotice'> {
  const progress: GameProgress = {
    totalClicks: state.totalClicks,
    totalEnergyEarned: state.totalEnergyEarned,
    eggsOpened: state.eggsOpened,
    upgradesBought: state.upgradesBought,
    ownedCreatures: state.ownedCreatures,
    fusionsDone: state.fusionsDone,
    mutationsCount: Object.values(state.mutations).reduce((total, count) => total + count, 0),
    builtHabitats: Object.values(state.habitats).filter((habitat) => habitat.level > 0).length,
    habitatLevels: Object.values(state.habitats).reduce((total, habitat) => total + habitat.level, 0),
    secretDiscoveries: secretCreatures.filter((creature) => (state.ownedCreatures[creature.id] ?? 0) > 0).length,
  }
  const newlyUnlocked = achievements.filter((achievement) =>
    !state.unlockedAchievements.includes(achievement.id)
    && getAchievementProgress(achievement, progress) >= achievement.target,
  )

  if (newlyUnlocked.length === 0) {
    return {
      stars: state.stars,
      eggInventory: state.eggInventory,
      unlockedAchievements: state.unlockedAchievements,
      achievementNotice: state.achievementNotice,
    }
  }

  const stars = newlyUnlocked.reduce((total, achievement) => total + achievement.rewardStars, state.stars)
  const eggInventory = newlyUnlocked.reduce((total, achievement) => total + achievement.rewardEggs, state.eggInventory)
  return {
    stars,
    eggInventory,
    unlockedAchievements: [...state.unlockedAchievements, ...newlyUnlocked.map((achievement) => achievement.id)],
    achievementNotice: `Достижение: ${newlyUnlocked[newlyUnlocked.length - 1].title}`,
  }
}
