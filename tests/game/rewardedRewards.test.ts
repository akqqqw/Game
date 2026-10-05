import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk, makeSave } from '../helpers/fakeSdk'
import { normalizeSave } from '../../src/game/saveSchema'

/**
 * Награды за добровольную рекламу (`showRewarded` → `'completed'`):
 *  - удвоение офлайн-дохода — один раз за сессию;
 *  - бесплатное яйцо — с кулдауном из баланса.
 *
 * Стор ничего не знает о рекламе: интерфейс вызывает награду только после
 * подтверждённого показа, поэтому проверяются сами действия и их ограничители.
 */

const DATABASE_NAME = 'evolution-isles'

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

async function loadModules() {
  vi.resetModules()
  const [store, storage] = await Promise.all([
    import('../../src/game/gameStore'),
    import('../../src/game/saveGame'),
  ])
  return { store, storage }
}

/** Загружает сохранение (по умолчанию — час отсутствия) и возвращает стор. */
async function hydrateWith(saveOverrides: Record<string, unknown> = {}) {
  installFakeSdk({ authorized: true })
  const { store, storage } = await loadModules()
  const save = normalizeSave(makeSave({ savedAt: Date.now() - 3_600_000, ...saveOverrides }))
  if (!save) throw new Error('не удалось собрать сохранение для теста')
  await storage.saveGame(save)
  await store.useGameStore.getState().hydrate()
  return store
}

beforeEach(async () => {
  delete window.YaGames
  await deleteDatabase()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('удвоение офлайн-дохода за рекламу', () => {
  it('начисляет офлайн-доход ещё раз и только один раз за сессию', async () => {
    const store = await hydrateWith()
    const state = store.useGameStore.getState()

    expect(state.offlineEnergy).toBeGreaterThan(0)
    const energyBefore = state.energy
    const offline = state.offlineEnergy

    expect(state.grantOfflineBonus()).toBe(true)
    expect(store.useGameStore.getState().offlineBonusClaimed).toBe(true)
    expect(store.useGameStore.getState().energy).toBeGreaterThanOrEqual(energyBefore + offline)

    const energyAfterBonus = store.useGameStore.getState().energy
    expect(store.useGameStore.getState().grantOfflineBonus()).toBe(false)
    expect(store.useGameStore.getState().energy).toBe(energyAfterBonus)
  })

  it('не начисляет бонус, если офлайна не было', async () => {
    const store = await hydrateWith({ savedAt: Date.now() })
    expect(store.useGameStore.getState().offlineEnergy).toBe(0)
    expect(store.useGameStore.getState().grantOfflineBonus()).toBe(false)
  })
})

describe('бесплатное яйцо за рекламу', () => {
  it('выдаёт яйцо и держит кулдаун из баланса', async () => {
    const store = await hydrateWith()
    const { balance } = await import('../../src/game/balance')
    const inventoryBefore = store.useGameStore.getState().eggInventory
    const now = Date.now()

    expect(store.useGameStore.getState().grantBonusEgg()).toBe(true)
    expect(store.useGameStore.getState().eggInventory).toBe(inventoryBefore + 1)
    expect(store.useGameStore.getState().bonusEggReadyAt)
      .toBeGreaterThanOrEqual(now + balance.egg.rewardedCooldownMs)

    // Сразу второй раз — нельзя: кулдаун не истёк.
    expect(store.useGameStore.getState().grantBonusEgg()).toBe(false)
    expect(store.useGameStore.getState().eggInventory).toBe(inventoryBefore + 1)

    // Через кулдаун награда снова доступна.
    vi.spyOn(Date, 'now').mockReturnValue(now + balance.egg.rewardedCooldownMs + 1)
    expect(store.useGameStore.getState().grantBonusEgg()).toBe(true)
    expect(store.useGameStore.getState().eggInventory).toBe(inventoryBefore + 2)
  })

  it('кулдаун больше потолка цены яйца — реклама не выгоднее игры', async () => {
    const { balance } = await import('../../src/game/balance')
    expect(balance.egg.rewardedCooldownMs).toBeGreaterThan(balance.egg.maxIncomeSeconds * 1000)
  })
})
