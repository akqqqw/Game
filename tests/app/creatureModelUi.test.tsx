import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSave } from '../helpers/fakeSdk'

/**
 * Витрина существа в карточке: 3D-модель и её запасные варианты.
 *
 * Проверяются обе стороны: когда WebGL есть (витрина модуля подменена — в jsdom
 * графики нет) и когда его нет (настоящий модуль). Второй случай важнее: игрок
 * без WebGL должен увидеть эмодзи, а не пустое место.
 */

vi.mock('../../src/game/PhaserGame', () => ({
  PhaserGame: ({ onReady }: { onReady?: () => void }) => {
    queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

vi.mock('../../src/platform/yandexSdk', () => ({
  notifyGameReady: vi.fn(async () => undefined),
  getSdkSession: async () => null,
  getSdkSessionSync: () => null,
  onSdkSessionChange: () => () => undefined,
}))

/**
 * Ожидание с запасом по времени: под параллельной нагрузкой полного прогона
 * асинхронные шаги (динамический импорт, таймеры рекламы) могут занять больше
 * секунды — таймаут по умолчанию делает такие проверки «мигающими».
 */
const waitFor = (
  callback: () => void | Promise<void>,
  timeout = 5000,
): Promise<void> => vi.waitFor(callback, { timeout, interval: 20 })

/** Поднимает игру с готовым сохранением, где Моховик уже открыт. */
async function prepare() {
  vi.resetModules()
  const store = await import('../../src/game/gameStore')
  const storage = await import('../../src/game/saveGame')
  const schema = await import('../../src/game/saveSchema')

  const save = schema.normalizeSave(makeSave({
    savedAt: Date.now(),
    energy: 5000,
    ownedCreatures: { mossling: 1 },
  }))
  if (!save) throw new Error('не удалось собрать сохранение для теста')
  await storage.saveGame(save)

  const { default: App } = await import('../../src/App')
  return { App, store }
}

/** Открывает «Существа» и карточку Моховика. */
function openMosslingCard(): void {
  fireEvent.click(screen.getByRole('button', { name: /Существа/ }))
  const collection = screen.getByRole('region', { name: 'Коллекция существ' })
  fireEvent.click(within(collection).getByRole('button', { name: /Моховик/ }))
}

/** Ждёт загрузки сохранения: до неё коллекция пуста. */
async function waitForHydration(store: { useGameStore: { getState: () => { hydrated: boolean } } }): Promise<void> {
  await waitFor(() => expect(store.useGameStore.getState().hydrated).toBe(true))
}

beforeEach(() => {
  vi.doUnmock('../../src/game/creatureViewer')
  vi.spyOn(Math, 'random').mockReturnValue(0.99)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('витрина существа без WebGL', () => {
  it('оставляет эмодзи и не ломает карточку', async () => {
    const { App, store } = await prepare()
    render(<App />)
    await screen.findByRole('navigation', { name: 'Игровая навигация' })
    await waitForHydration(store)

    openMosslingCard()

    const viewer = await screen.findByRole('img', { name: 'Модель существа Моховик' })
    // Витрина поднимается асинхронно: ждём решения «3D нет — оставляем эмодзи».
    await waitFor(() => expect(viewer.className).toContain('creature-model-fallback'))
    expect(viewer.querySelector('.creature-model-emoji')?.textContent).toBe('🌿')

    // Характеристики существа показываются как обычно.
    expect(screen.getByRole('dialog', { name: 'Характеристики: Моховик' })).toBeTruthy()
  })
})

describe('витрина существа с WebGL', () => {
  it('монтирует модель и освобождает её при закрытии карточки', async () => {
    const setPaused = vi.fn()
    // Подмена ведёт себя как настоящая витрина: при освобождении canvas уходит.
    const dispose = vi.fn((canvas: HTMLCanvasElement) => canvas.remove())
    const mountCreatureViewer = vi.fn(async (container: HTMLElement) => {
      const canvas = document.createElement('canvas')
      container.appendChild(canvas)
      return { model: 'procedural' as const, setPaused, dispose: () => dispose(canvas) }
    })

    vi.doMock('../../src/game/creatureViewer', () => ({
      mountCreatureViewer,
      supportsWebgl: () => true,
    }))

    const { App, store } = await prepare()
    render(<App />)
    await screen.findByRole('navigation', { name: 'Игровая навигация' })
    await waitForHydration(store)

    openMosslingCard()

    const viewer = await screen.findByRole('img', { name: 'Модель существа Моховик' })
    await waitFor(() => expect(viewer.querySelector('canvas')).toBeTruthy())

    // Витрина получила именно это существо.
    expect(mountCreatureViewer).toHaveBeenCalledTimes(1)
    expect(mountCreatureViewer.mock.calls[0][1]).toMatchObject({ id: 'mossling', elements: ['nature'] })
    // При готовой модели эмодзи-заглушка убирается, чтобы не светиться под 3D.
    expect(viewer.querySelector('.creature-model-emoji')).toBeNull()
    expect(viewer.className).toContain('creature-model-ready')

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть характеристики существа' }))

    // Ресурсы освобождаются: окно WebGL-контекстов в браузере ограничено.
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(viewer.querySelector('canvas')).toBeNull()
  })
})
