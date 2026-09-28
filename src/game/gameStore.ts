import { create } from 'zustand'
import { achievements, getAchievementProgress } from './achievements'
import { creatures } from './creatures'
import { advanceDailyTasks, createDailyTasks, getTodayKey, type DailyTask } from './dailyTasks'
import type { GameProgress } from './gameProgress'
import { loadGame, saveGame, type PersistedGame } from './saveGame'

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
  addEnergy: () => void
  addPassiveEnergy: () => void
  buyClickUpgrade: () => boolean
  buySunwell: () => boolean
  openEgg: () => boolean
  claimTask: (taskId: string) => boolean
  dismissAchievementNotice: () => void
  hydrate: () => Promise<void>
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
  addPassiveEnergy: () =>
    set((state) => {
      const nextState = {
        energy: state.energy + state.energyPerSecond,
        totalEnergyEarned: state.totalEnergyEarned + state.energyPerSecond,
        dailyTasks: advanceDailyTasks(state.dailyTasks, 'earn_energy', state.energyPerSecond),
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
  hydrate: async () => {
    const savedGame = await loadGame()
    if (!savedGame) {
      const today = getTodayKey()
      set({ dailyTasks: createDailyTasks(today), dailyTaskDate: today, hydrated: true })
      void persistState(get())
      return
    }

    const offlineSeconds = Math.min(
      Math.max(0, Math.floor((Date.now() - savedGame.savedAt) / 1000)),
      8 * 60 * 60,
    )
    const offlineEnergy = offlineSeconds * savedGame.energyPerSecond
    const today = getTodayKey()
    const dailyTasks = savedGame.dailyTaskDate === today && savedGame.dailyTasks?.length
      ? savedGame.dailyTasks
      : createDailyTasks(today)
    const nextState = {
      ...savedGame,
      energy: savedGame.energy + offlineEnergy,
      sunwellLevel: savedGame.sunwellLevel ?? 0,
      sunwellCost: savedGame.sunwellCost ?? 75,
      eggCost: savedGame.eggCost ?? 100,
      ownedCreatures: savedGame.ownedCreatures ?? {},
      lastHatchedId: savedGame.lastHatchedId ?? null,
      stars: savedGame.stars ?? 0,
      eggInventory: savedGame.eggInventory ?? 0,
      totalEnergyEarned: savedGame.totalEnergyEarned ?? 0,
      eggsOpened: savedGame.eggsOpened ?? 0,
      upgradesBought: savedGame.upgradesBought ?? 0,
      totalClicks: savedGame.totalClicks ?? 0,
      unlockedAchievements: savedGame.unlockedAchievements ?? [],
      achievementNotice: null,
      dailyTasks,
      dailyTaskDate: today,
      offlineEnergy,
      hydrated: true,
    }
    const finalState = { ...nextState, ...applyAchievementRewards({ ...get(), ...nextState }) }
    set(finalState)
    void persistState(get())
  }
}))

export const useEnergy = () => useGameStore((state) => state.energy)

async function persistState(state: GameState): Promise<void> {
  const persistedState: PersistedGame = {
    energy: state.energy,
    clickPower: state.clickPower,
    energyPerSecond: state.energyPerSecond,
    clickUpgradeCost: state.clickUpgradeCost,
    sunwellLevel: state.sunwellLevel,
    sunwellCost: state.sunwellCost,
    eggCost: state.eggCost,
    ownedCreatures: state.ownedCreatures,
    lastHatchedId: state.lastHatchedId ?? undefined,
    stars: state.stars,
    eggInventory: state.eggInventory,
    totalEnergyEarned: state.totalEnergyEarned,
    eggsOpened: state.eggsOpened,
    upgradesBought: state.upgradesBought,
    dailyTasks: state.dailyTasks,
    dailyTaskDate: state.dailyTaskDate,
    totalClicks: state.totalClicks,
    unlockedAchievements: state.unlockedAchievements,
    savedAt: Date.now(),
  }
  await saveGame(persistedState)
}

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
