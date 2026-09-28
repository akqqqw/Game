import { create } from 'zustand'
import { initCloudAutoSync, pushCloudSave, queueCloudSave, readCloudSave } from '../platform/cloudSave'
import { getSdkSession, getSdkSessionSync, onSdkSessionChange, type SdkSession } from '../platform/yandexSdk'
import { achievements, getAchievementProgress } from './achievements'
import { creatures } from './creatures'
import { advanceDailyTasks, createDailyTasks, getTodayKey, type DailyTask } from './dailyTasks'
import type { GameProgress } from './gameProgress'
import { loadGame, saveBackupSave, saveGame } from './saveGame'
import { resolveSaveConflict } from './saveMerge'
import { SAVE_VERSION, type PersistedGame } from './saveSchema'

type GameState = {
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
  dailyTasks: DailyTask[]
  dailyTaskDate: string
  totalClicks: number
  unlockedAchievements: string[]
  achievementNotice: string | null
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
  claimTask: (taskId: string) => boolean
  dismissAchievementNotice: () => void
  dismissCloudNotice: () => void
  hydrate: () => Promise<void>
  /** Перечитать облако после авторизации игрока. */
  syncCloudAfterAuthorization: () => Promise<void>
}

export const useGameStore = create<GameState>((set, get) => ({
  energy: 0,
  clickPower: 1,
  energyPerSecond: 1,
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
      const nextState = {
        energy: state.energy + state.clickPower,
        totalClicks: state.totalClicks + 1,
        totalEnergyEarned: state.totalEnergyEarned + state.clickPower,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'earn_energy', state.clickPower),
      }
      const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
      void persistState({ ...state, ...finalState })
      return finalState
    }),
  accruePassiveEnergy: (seconds) =>
    set((state) => {
      const gained = state.energyPerSecond * seconds
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

    const nextState = {
      energy: state.energy - state.clickUpgradeCost,
      clickPower: state.clickPower + 1,
      clickUpgradeCost: Math.ceil(state.clickUpgradeCost * 1.65),
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

    const nextState = {
      energy: state.energy - state.sunwellCost,
      energyPerSecond: state.energyPerSecond + 2,
      sunwellLevel: state.sunwellLevel + 1,
      sunwellCost: Math.ceil(state.sunwellCost * 1.7),
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
    const creature = creatures.find((candidate) => {
      threshold += candidate.weight
      return roll < threshold
    })
    const hatched = creature ?? creatures[0]
    if (!hatched) return false

    const ownedCreatures = {
      ...state.ownedCreatures,
      [hatched.id]: (state.ownedCreatures[hatched.id] ?? 0) + 1,
    }
    const nextState = {
      energy: usesInventoryEgg ? state.energy : state.energy - state.eggCost,
      eggInventory: usesInventoryEgg ? state.eggInventory - 1 : state.eggInventory,
      clickPower: state.clickPower + hatched.clickBonus,
      energyPerSecond: state.energyPerSecond + hatched.productionBonus,
      ownedCreatures,
      lastHatchedId: hatched.id,
      eggsOpened: state.eggsOpened + 1,
      dailyTasks: advanceDailyTasks(state.dailyTasks, 'open_eggs', 1),
    }
    const finalState = { ...nextState, ...applyAchievementRewards({ ...state, ...nextState }) }
    set(finalState)
    void persistState({ ...state, ...finalState })
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
    const offlineEnergy = calculateOfflineEnergy(merged.save.energyPerSecond, merged.save.savedAt)
    const nextState = applyPersistedSave(merged.save, offlineEnergy)
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
}))

export const useEnergy = () => useGameStore((state) => state.energy)

/** Собирает сохраняемый снимок из состояния стора. */
function buildPersistedSave(state: GameState): PersistedGame {
  return {
    version: SAVE_VERSION,
    energy: state.energy,
    clickPower: state.clickPower,
    energyPerSecond: state.energyPerSecond,
    clickUpgradeCost: state.clickUpgradeCost,
    sunwellLevel: state.sunwellLevel,
    sunwellCost: state.sunwellCost,
    eggCost: state.eggCost,
    ownedCreatures: state.ownedCreatures,
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
    energy: save.energy + offlineEnergy,
    totalEnergyEarned: save.totalEnergyEarned + offlineEnergy,
    achievementNotice: null,
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

/** Офлайн-доход: не больше 8 часов отсутствия. */
function calculateOfflineEnergy(energyPerSecond: number, savedAt: number): number {
  const elapsedSeconds = Math.min(
    Math.max(0, Math.floor((Date.now() - savedAt) / 1000)),
    8 * 60 * 60,
  )
  return elapsedSeconds * energyPerSecond
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
