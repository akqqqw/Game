import type { DailyTask } from './dailyTasks'

export type PersistedGame = {
  energy: number
  clickPower: number
  energyPerSecond: number
  clickUpgradeCost: number
  sunwellLevel?: number
  sunwellCost?: number
  eggCost?: number
  ownedCreatures?: Record<string, number>
  lastHatchedId?: string
  stars?: number
  eggInventory?: number
  totalClicks?: number
  totalEnergyEarned?: number
  eggsOpened?: number
  upgradesBought?: number
  dailyTasks?: DailyTask[]
  dailyTaskDate?: string
  unlockedAchievements?: string[]
  savedAt: number
}

const databaseName = 'evolution-isles'
const storeName = 'game-state'
const stateKey = 'current'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)

    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadGame(): Promise<PersistedGame | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(stateKey)
    request.onsuccess = () => resolve((request.result as PersistedGame | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function saveGame(state: PersistedGame): Promise<void> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const request = database
      .transaction(storeName, 'readwrite')
      .objectStore(storeName)
      .put(state, stateKey)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
