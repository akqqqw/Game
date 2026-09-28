import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk, makeSave } from '../helpers/fakeSdk'
import { normalizeSave } from '../../src/game/saveSchema'

const CLOUD_KEY = 'evolution-isles-save'
const DATABASE_NAME = 'evolution-isles'

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** Имитирует недоступность /sdk.js — тогда сессия SDK резолвится сразу. */
function failSdkScript(): void {
  vi.spyOn(document.head, 'append').mockImplementation(((node: Node) => {
    if (node instanceof HTMLScriptElement) {
      queueMicrotask(() => node.dispatchEvent(new Event('error')))
    }
    return node
  }) as typeof document.head.append)
}

async function loadModules() {
  vi.resetModules()
  const [storage, store] = await Promise.all([
    import('../../src/game/saveGame'),
    import('../../src/game/gameStore'),
  ])
  return { storage, store }
}

beforeEach(async () => {
  delete window.YaGames
  await deleteDatabase()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('загрузка прогресса при старте', () => {
  it('берёт более свежее облачное сохранение и кладёт локальное в резерв', async () => {
    const cloudSave = makeSave({ energy: 9000, savedAt: Date.now() - 5000, energyPerSecond: 0 })
    installFakeSdk({ authorized: true, cloud: { [CLOUD_KEY]: cloudSave } })

    const { storage, store } = await loadModules()
    await storage.saveGame(normalizeSave(makeSave({ energy: 300, energyPerSecond: 0, savedAt: Date.now() - 600_000 }))!)

    await store.useGameStore.getState().hydrate()

    const state = store.useGameStore.getState()
    expect(state.energy).toBe(9000)
    expect(state.hydrated).toBe(true)
    expect(state.cloudNotice).toContain('облак')
    expect((await storage.loadBackupSave())?.energy).toBe(300)
  })

  it('оставляет локальный прогресс, если он свежее, и отправляет его в облако', async () => {
    const cloud = installFakeSdk({
      authorized: true,
      cloud: { [CLOUD_KEY]: makeSave({ energy: 100, savedAt: Date.now() - 3_600_000, energyPerSecond: 0 }) },
    })

    const { storage, store } = await loadModules()
    await storage.saveGame(normalizeSave(makeSave({ energy: 5000, savedAt: Date.now() - 1000, energyPerSecond: 0 }))!)

    await store.useGameStore.getState().hydrate()

    expect(store.useGameStore.getState().energy).toBe(5000)
    expect((await storage.loadBackupSave())?.energy).toBe(100)

    const pushed = cloud.writes.at(-1)?.save[CLOUD_KEY] as { energy: number } | undefined
    expect(pushed?.energy).toBe(5000)
  })

  it('не перезаписывает прогресс пустым облачным сохранением', async () => {
    const emptyCloud = makeSave({
      energy: 0,
      clickPower: 1,
      energyPerSecond: 0,
      stars: 0,
      eggInventory: 0,
      totalEnergyEarned: 0,
      eggsOpened: 0,
      upgradesBought: 0,
      totalClicks: 0,
      ownedCreatures: {},
      unlockedAchievements: [],
      savedAt: Date.now(),
    })
    installFakeSdk({ authorized: true, cloud: { [CLOUD_KEY]: emptyCloud } })

    const { storage, store } = await loadModules()
    await storage.saveGame(normalizeSave(makeSave({ energy: 750, savedAt: Date.now() - 10_000, energyPerSecond: 0 }))!)

    await store.useGameStore.getState().hydrate()

    const state = store.useGameStore.getState()
    expect(state.energy).toBe(750)
    expect(state.cloudNotice).toContain('Пустое облачное сохранение')
  })

  it('загружает прогресс из облака на новом устройстве', async () => {
    installFakeSdk({
      authorized: true,
      cloud: { [CLOUD_KEY]: makeSave({ energy: 12_345, savedAt: Date.now() - 60_000, energyPerSecond: 0 }) },
    })

    const { store } = await loadModules()
    await store.useGameStore.getState().hydrate()

    expect(store.useGameStore.getState().energy).toBe(12_345)
  })

  it('начисляет офлайн-доход от выбранного сохранения', async () => {
    failSdkScript()
    const { storage, store } = await loadModules()
    await storage.saveGame(normalizeSave(makeSave({
      energy: 0,
      energyPerSecond: 2,
      savedAt: Date.now() - 3600_000,
    }))!)

    await store.useGameStore.getState().hydrate()

    const state = store.useGameStore.getState()
    expect(state.offlineEnergy).toBeGreaterThanOrEqual(7198)
    expect(state.offlineEnergy).toBeLessThanOrEqual(7202)
    expect(state.energy).toBe(state.offlineEnergy)
  })

  it('работает без SDK: гостевой режим с локальным сохранением', async () => {
    failSdkScript()
    const { storage, store } = await loadModules()
    await storage.saveGame(normalizeSave(makeSave({ energy: 88, savedAt: Date.now(), energyPerSecond: 0 }))!)

    await store.useGameStore.getState().hydrate()

    const state = store.useGameStore.getState()
    expect(state.energy).toBe(88)
    expect(state.hydrated).toBe(true)
    expect(state.cloudNotice).toBeNull()
  })

  it('подтягивает облачный прогресс после авторизации гостя', async () => {
    const cloud = installFakeSdk({
      authorized: false,
      cloud: { [CLOUD_KEY]: makeSave({ energy: 4321, savedAt: Date.now() - 1000, energyPerSecond: 0 }) },
    })

    const { storage, store } = await loadModules()
    await storage.saveGame(normalizeSave(makeSave({ energy: 10, savedAt: Date.now() - 60_000, energyPerSecond: 0 }))!)

    await store.useGameStore.getState().hydrate()
    expect(store.useGameStore.getState().energy).toBe(10)

    // Игрок вошёл в Яндекс — сессия обновляется, стор подхватывает облако.
    cloud.setAuthorized(true)
    const { refreshSdkPlayer } = await import('../../src/platform/yandexSdk')
    await refreshSdkPlayer()
    await vi.waitFor(() => {
      expect(store.useGameStore.getState().energy).toBe(4321)
    })
  })

  it('стартует новую игру, если сохранений нет', async () => {
    installFakeSdk({ authorized: true })

    const { store } = await loadModules()
    await store.useGameStore.getState().hydrate()

    const state = store.useGameStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.energy).toBe(0)
    expect(state.dailyTasks.length).toBeGreaterThan(0)
  })
})
