import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Проверяем порядок запуска игры целиком: экран загрузки → готовность сцены →
 * вызов Game Ready. Именно этот порядок требует п. 1.19.2 требований платформы.
 */

const platform = vi.hoisted(() => ({ notifyGameReady: vi.fn(async () => undefined) }))
const scene = vi.hoisted(() => ({ callOnReady: true }))

/**
 * Платформенный слой подменяется целиком: SDK в тестах не инициализируется,
 * игра должна запускаться в локальном режиме.
 */
vi.mock('../../src/platform/yandexSdk', () => ({
  notifyGameReady: platform.notifyGameReady,
  getSdkSession: async () => ({
    status: 'unavailable',
    source: 'none',
    ysdk: null,
    player: null,
    isAuthorized: false,
    lang: 'ru',
    reason: 'тестовый режим',
  }),
  getSdkSessionSync: () => null,
  onSdkSessionChange: () => () => undefined,
}))

vi.mock('../../src/game/PhaserGame', () => ({
  PhaserGame: ({ onReady }: { onReady?: () => void }) => {
    if (scene.callOnReady) queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

async function renderApp() {
  const { default: App } = await import('../../src/App')
  return render(<App />)
}

beforeEach(() => {
  platform.notifyGameReady.mockClear()
  scene.callOnReady = true
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('запуск игры', () => {
  it('показывает экран загрузки и снимает его перед вызовом Game Ready', async () => {
    await renderApp()

    expect(screen.getByText('Загружаем сохранение…')).toBeTruthy()
    expect(platform.notifyGameReady).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(platform.notifyGameReady).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByText('Загружаем сохранение…')).toBeNull()
    expect(screen.getByTestId('phaser-scene')).toBeTruthy()
  })

  it('вызывает Game Ready один раз, даже если сцена перерисовывается', async () => {
    await renderApp()

    await waitFor(() => {
      expect(platform.notifyGameReady).toHaveBeenCalled()
    })

    await new Promise((resolve) => window.setTimeout(resolve, 60))
    expect(platform.notifyGameReady).toHaveBeenCalledTimes(1)
  })

  it('запускает игру, даже если хранилище IndexedDB недоступно', async () => {
    // В jsdom нет indexedDB — это ровно тот случай, когда раньше игра зависала
    // на экране загрузки с заблокированными кнопками.
    await renderApp()

    await waitFor(() => {
      expect(platform.notifyGameReady).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByRole('navigation', { name: 'Игровая навигация' })).toBeTruthy()
    expect(screen.queryByText('Загружаем сохранение…')).toBeNull()
  })

  it('не сообщает о готовности, пока сцена не отрисована', async () => {
    scene.callOnReady = false
    await renderApp()

    await waitFor(() => {
      expect(screen.getByTestId('phaser-scene')).toBeTruthy()
    })
    await new Promise((resolve) => window.setTimeout(resolve, 60))

    expect(platform.notifyGameReady).not.toHaveBeenCalled()
    expect(screen.queryByText('Готовим остров…')).not.toBeNull()
  })
})
