import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk, makeSave } from '../helpers/fakeSdk'

/**
 * Точки показа рекламы глазами игрока: полноэкранная реклама появляется после
 * завершённого действия, но не по кликам и не по нажатию на неактивные кнопки.
 *
 * Игра рендерится целиком с фейковым SDK (без Phaser), поэтому проверяется
 * настоящая связка «экран → игровое действие → точка показа».
 */

vi.mock('../../src/game/PhaserGame', () => ({
  PhaserGame: ({ onReady }: { onReady?: () => void }) => {
    queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

/** Поднимает свежий модульный граф игры с фейковым SDK и готовит сохранение. */
async function prepare(saveOverrides: Record<string, unknown> = {}) {
  const sdk = installFakeSdk({ authorized: true, withAds: true })
  vi.resetModules()

  const ads = await import('../../src/platform/ads')
  const adPoints = await import('../../src/platform/adPoints')
  const lifecycle = await import('../../src/platform/gameLifecycle')
  const platform = await import('../../src/platform/yandexSdk')
  const store = await import('../../src/game/gameStore')
  const storage = await import('../../src/game/saveGame')
  const schema = await import('../../src/game/saveSchema')

  await platform.getSdkSession()
  // Пейсинг отключён: проверяем сами точки показа, а не расписание.
  ads.configureAds({ enabled: true, firstAdDelayMs: 0, interstitialCooldownMs: 0, interstitialMinActions: 0 })
  adPoints.configureAdPoints({ delayMs: 0 })

  const save = schema.normalizeSave(makeSave({ savedAt: Date.now(), ...saveOverrides }))
  if (!save) throw new Error('не удалось собрать сохранение для теста')
  await storage.saveGame(save)

  const { default: App } = await import('../../src/App')
  return { sdk, ads, adPoints, lifecycle, store, App }
}

type Prepared = Awaited<ReturnType<typeof prepare>>

async function renderGame(prepared: Prepared): Promise<void> {
  render(<prepared.App />)
  await screen.findByRole('navigation', { name: 'Игровая навигация' })
}

/** Кнопка внутри блока с указанным заголовком (карточка или панель). */
function buttonInBlock(heading: string): HTMLButtonElement {
  const block = screen.getByRole('heading', { name: heading }).closest('article, section')
  if (!block) throw new Error(`не найден блок «${heading}»`)
  return within(block).getByRole('button')
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

describe('реклама после завершённого действия', () => {
  it('открытие яйца показывает рекламу и ставит игру на паузу', async () => {
    const prepared = await prepare({ energy: 1000 })
    const { sdk, lifecycle, store } = prepared
    await renderGame(prepared)

    fireEvent.click(buttonInBlock('Лунное яйцо'))

    await vi.waitFor(() => expect(sdk.ads.fullscreenCalls).toBe(1))
    // Сначала игрок получил существо, и только потом включилась реклама.
    expect(store.useGameStore.getState().lastHatchedId).toBeTruthy()
    expect(lifecycle.isGamePaused()).toBe(true)

    sdk.ads.closeFullscreen(true)
    await vi.waitFor(() => expect(lifecycle.isGamePaused()).toBe(false))
  })

  it('покупка улучшения показывает рекламу', async () => {
    const prepared = await prepare({ energy: 5000 })
    const { sdk, store } = prepared
    await renderGame(prepared)

    const energyBefore = store.useGameStore.getState().energy
    const clickPowerBefore = store.useGameStore.getState().clickPower
    fireEvent.click(buttonInBlock('Корни силы'))

    await vi.waitFor(() => expect(sdk.ads.fullscreenCalls).toBe(1))
    // Улучшение действительно куплено: энергия списана, сила клика выросла.
    expect(store.useGameStore.getState().energy).toBeLessThan(energyBefore)
    expect(store.useGameStore.getState().clickPower).toBe(clickPowerBefore + 1)

    sdk.ads.closeFullscreen(true)
  })

  it('переход на другой экран показывает рекламу, повторный тап — нет', async () => {
    const prepared = await prepare({ energy: 100 })
    const { sdk } = prepared
    await renderGame(prepared)

    fireEvent.click(screen.getByRole('button', { name: /Существа/ }))
    await vi.waitFor(() => expect(sdk.ads.fullscreenCalls).toBe(1))

    sdk.ads.closeFullscreen(true)
    await vi.waitFor(() => expect(sdk.ads.pending()).toBe('none'))

    // Тап по уже открытому экрану — не переход, рекламы быть не должно.
    fireEvent.click(screen.getByRole('button', { name: /Существа/ }))
    await new Promise((resolve) => window.setTimeout(resolve, 40))
    expect(sdk.ads.fullscreenCalls).toBe(1)
  })
})

describe('рекламы нет там, где она не нужна', () => {
  it('клики по дереву не показывают рекламу даже без пейсинга', async () => {
    // Счётчик кликов обнуляем: в сохранении по умолчанию уже есть история.
    const prepared = await prepare({ energy: 0, clickPower: 1, totalClicks: 0 })
    const { sdk, store } = prepared
    await renderGame(prepared)

    for (let index = 0; index < 40; index += 1) {
      store.useGameStore.getState().addEnergy()
    }

    await new Promise((resolve) => window.setTimeout(resolve, 60))
    expect(sdk.ads.fullscreenCalls).toBe(0)
    expect(store.useGameStore.getState().totalClicks).toBe(40)
  })

  it('нажатие на неактивную кнопку не запускает показ', async () => {
    // Энергии нет и пассивного дохода нет — обе кнопки улучшений недоступны.
    const prepared = await prepare({ energy: 0, energyPerSecond: 0 })
    const { sdk } = prepared
    await renderGame(prepared)

    const eggButton = buttonInBlock('Лунное яйцо')
    const upgradeButton = buttonInBlock('Корни силы')
    expect(eggButton.disabled).toBe(true)
    expect(upgradeButton.disabled).toBe(true)

    fireEvent.click(eggButton)
    fireEvent.click(upgradeButton)

    await new Promise((resolve) => window.setTimeout(resolve, 40))
    expect(sdk.ads.fullscreenCalls).toBe(0)
  })

  it('реклама не показывается сразу при запуске игры', async () => {
    const prepared = await prepare({ energy: 1000 })
    const { sdk, adPoints } = prepared
    await renderGame(prepared)

    await new Promise((resolve) => window.setTimeout(resolve, 60))
    expect(sdk.ads.fullscreenCalls).toBe(0)
    expect(adPoints.getAdPointsState().requests).toBe(0)
  })
})
