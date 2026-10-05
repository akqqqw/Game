import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk, makeSave } from '../helpers/fakeSdk'

/**
 * Добровольная реклама глазами игрока: кнопки «за просмотр» (удвоение
 * офлайн-дохода и бесплатное яйцо) дают награду только после подтверждённого
 * показа платформой (п. 4.5) и никогда не показываются автоматически.
 */

vi.mock('../../src/game/PhaserGame', () => ({
  PhaserGame: ({ onReady }: { onReady?: () => void }) => {
    queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

const waitFor = (
  callback: () => void | Promise<void>,
  timeout = 5000,
): Promise<void> => vi.waitFor(callback, { timeout, interval: 20 })

/** Поднимает игру с фейковым SDK и сохранением (по умолчанию — час отсутствия). */
async function prepare(saveOverrides: Record<string, unknown> = {}) {
  const sdk = installFakeSdk({ authorized: true, withAds: true })
  vi.resetModules()

  const ads = await import('../../src/platform/ads')
  const platform = await import('../../src/platform/yandexSdk')
  const store = await import('../../src/game/gameStore')
  const storage = await import('../../src/game/saveGame')
  const schema = await import('../../src/game/saveSchema')

  await platform.getSdkSession()
  ads.configureAds({
    enabled: true,
    firstAdDelayMs: 0,
    interstitialCooldownMs: 0,
    interstitialMinActions: 0,
    rewardedCooldownMs: 0,
  })

  const save = schema.normalizeSave(makeSave({ savedAt: Date.now() - 3_600_000, ...saveOverrides }))
  if (!save) throw new Error('не удалось собрать сохранение для теста')
  await storage.saveGame(save)

  const { default: App } = await import('../../src/App')
  return { sdk, store, App }
}

type Prepared = Awaited<ReturnType<typeof prepare>>

async function renderGame(prepared: Prepared): Promise<void> {
  render(<prepared.App />)
  await screen.findByRole('navigation', { name: 'Игровая навигация' })
  await waitFor(() => expect(prepared.store.useGameStore.getState().hydrated).toBe(true))
}

beforeEach(() => {
  delete window.YaGames
  vi.spyOn(Math, 'random').mockReturnValue(0.99)
})

afterEach(() => {
  cleanup()
  delete window.YaGames
  vi.restoreAllMocks()
})

describe('удвоение офлайн-дохода за рекламу', () => {
  it('показывает кнопку и начисляет бонус после подтверждённого просмотра', async () => {
    const prepared = await prepare()
    const { sdk, store } = prepared
    await renderGame(prepared)

    const offline = store.useGameStore.getState().offlineEnergy
    expect(offline).toBeGreaterThan(0)
    // Офлайн-доход уже начислен при загрузке — за просмотр игрок получает его ещё раз.
    const energyBefore = store.useGameStore.getState().energy

    const button = screen.getByRole('button', { name: /Смотреть рекламу · ×2/ })
    fireEvent.click(button)

    await waitFor(() => expect(sdk.ads.rewardedCalls).toBe(1))
    expect(sdk.ads.pending()).toBe('rewarded')

    sdk.ads.grantReward()
    sdk.ads.closeRewarded()

    await waitFor(() => expect(store.useGameStore.getState().offlineBonusClaimed).toBe(true))
    expect(store.useGameStore.getState().energy).toBeGreaterThanOrEqual(energyBefore + offline)
    // Повторно бонус не предлагается.
    expect(screen.queryByRole('button', { name: /Смотреть рекламу · ×2/ })).toBeNull()
    await screen.findByText('Бонус ×2 получен')
  })

  it('не начисляет бонус, если показ не подтверждён', async () => {
    const prepared = await prepare()
    const { sdk, store } = prepared
    await renderGame(prepared)

    const energyBefore = store.useGameStore.getState().energy
    fireEvent.click(screen.getByRole('button', { name: /Смотреть рекламу · ×2/ }))
    await waitFor(() => expect(sdk.ads.rewardedCalls).toBe(1))

    // Игрок закрыл рекламу, не досмотрев: награды нет (п. 4.5).
    sdk.ads.closeRewarded()

    await new Promise((resolve) => window.setTimeout(resolve, 40))
    expect(store.useGameStore.getState().offlineBonusClaimed).toBe(false)
    expect(store.useGameStore.getState().energy).toBeLessThan(energyBefore + store.useGameStore.getState().offlineEnergy)
    expect(screen.getByRole('button', { name: /Смотреть рекламу · ×2/ })).toBeTruthy()
  })
})

describe('бесплатное яйцо за рекламу', () => {
  it('выдаёт яйцо после подтверждённого просмотра и закрывает кнопку кулдауном', async () => {
    const prepared = await prepare({ eggInventory: 0 })
    const { sdk, store } = prepared
    await renderGame(prepared)

    const inventoryBefore = store.useGameStore.getState().eggInventory
    const button = screen.getByRole('button', { name: /Смотреть рекламу · 🥚/ })
    fireEvent.click(button)

    await waitFor(() => expect(sdk.ads.rewardedCalls).toBe(1))
    sdk.ads.grantReward()
    sdk.ads.closeRewarded()

    await waitFor(() => expect(store.useGameStore.getState().eggInventory).toBe(inventoryBefore + 1))
    // Кнопка остаётся, но с кулдауном: второе яйцо сразу не выдать.
    const cooled = await screen.findByRole('button', { name: /Яйцо через/ })
    expect((cooled as HTMLButtonElement).disabled).toBe(true)
  })

  it('не выдаёт яйцо, если показ не подтверждён', async () => {
    const prepared = await prepare({ eggInventory: 0 })
    const { sdk, store } = prepared
    await renderGame(prepared)

    const inventoryBefore = store.useGameStore.getState().eggInventory
    fireEvent.click(screen.getByRole('button', { name: /Смотреть рекламу · 🥚/ }))
    await waitFor(() => expect(sdk.ads.rewardedCalls).toBe(1))
    sdk.ads.failRewarded()

    await new Promise((resolve) => window.setTimeout(resolve, 40))
    expect(store.useGameStore.getState().eggInventory).toBe(inventoryBefore)
  })

  it('без рекламного модуля кнопки награды не показываются', async () => {
    const sdk = installFakeSdk({ authorized: true, withAds: false })
    vi.resetModules()

    const platform = await import('../../src/platform/yandexSdk')
    const storage = await import('../../src/game/saveGame')
    const schema = await import('../../src/game/saveSchema')
    await platform.getSdkSession()

    const save = schema.normalizeSave(makeSave({ savedAt: Date.now() - 3_600_000 }))
    if (!save) throw new Error('не удалось собрать сохранение для теста')
    await storage.saveGame(save)

    const { default: App } = await import('../../src/App')
    render(<App />)
    await screen.findByRole('navigation', { name: 'Игровая навигация' })
    await new Promise((resolve) => window.setTimeout(resolve, 60))

    expect(sdk.ads.rewardedCalls).toBe(0)
    expect(screen.queryByRole('button', { name: /Смотреть рекламу/ })).toBeNull()
  })
})
