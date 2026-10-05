import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fusionCostFor } from '../../src/game/balance'
import { useGameStore } from '../../src/game/gameStore'
import { computeHabitatSummary, createEmptyHabitats } from '../../src/game/habitats'
import { saveGame } from '../../src/game/saveGame'
import { normalizeSave } from '../../src/game/saveSchema'
import { makeSave } from '../helpers/fakeSdk'

/**
 * Проверки интерфейса новых механик: лаборатория слияний и жилища.
 *
 * Прогресс готовится так же, как у игрока: пишем сохранение в локальное
 * хранилище и запускаем игру — она загружает его при старте. Так тесты
 * проверяют настоящий путь загрузки и не зависят от порядка выполнения.
 */

vi.mock('../../src/platform/yandexSdk', () => ({
  notifyGameReady: vi.fn(async () => undefined),
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
    queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

function resetStore(): void {
  const habitats = createEmptyHabitats()
  useGameStore.setState({
    energy: 0,
    clickPower: 1,
    energyPerSecond: 0,
    clickUpgradeCost: 25,
    sunwellLevel: 0,
    sunwellCost: 75,
    eggCost: 100,
    ownedCreatures: {},
    mutations: {},
    habitats,
    habitatBonus: 0,
    habitatSummary: computeHabitatSummary(habitats, {}),
    discoveredRecipes: [],
    fusionsDone: 0,
    lastHatchedId: null,
    lastHatchedMutated: false,
    fusionNotice: null,
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
  })
}

/** Готовит прогресс игрока в локальном хранилище. */
async function seedSave(overrides: Record<string, unknown> = {}): Promise<void> {
  const save = normalizeSave(makeSave({ savedAt: Date.now(), ...overrides }))
  if (!save) throw new Error('не удалось собрать сохранение для теста')
  await saveGame(save)
}

async function renderIsland(): Promise<void> {
  const { default: App } = await import('../../src/App')
  render(<App />)
  // Экран загрузки снимается после гидратации и первого кадра сцены.
  await screen.findByRole('navigation', { name: 'Игровая навигация' })
  await screen.findByRole('region', { name: 'Среда обитания' })
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99)
  resetStore()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('лаборатория слияний в интерфейсе', () => {
  it('показывает результат слияния из примера: углехвост + каменный голем', async () => {
    await seedSave({ energy: 5000, clickPower: 4, ownedCreatures: { emberfox: 1, stonegolem: 1 } })
    await renderIsland()

    fireEvent.click(screen.getByRole('button', { name: /Существа/ }))

    const lab = screen.getByRole('region', { name: 'Лаборатория слияний' })
    expect(within(lab).getAllByRole('button', { name: /Выбрать/ })).toHaveLength(2)

    fireEvent.click(within(lab).getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор существа для слияния' })).getByRole('button', { name: /Углехвост/ }))

    fireEvent.click(within(lab).getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор существа для слияния' })).getByRole('button', { name: /Каменный голем/ }))

    // Предпросмотр показывает, кто получится, и сколько это стоит.
    expect(within(lab).getByRole('heading', { name: 'Магмовый голем' })).toBeTruthy()
    expect(lab.querySelector('.fusion-cost')?.textContent).toContain(fusionCostFor(400).toLocaleString())

    fireEvent.click(within(lab).getByRole('button', { name: 'Слить' }))

    expect(await within(lab).findByText(/Успех: Магмовый голем/)).toBeTruthy()
    const state = useGameStore.getState()
    expect(state.ownedCreatures).toEqual({ magmagolem: 1 })
    expect(state.fusionsDone).toBe(1)
    expect(state.energy).toBe(5000 - fusionCostFor(400))

    // Новое существо появилось в коллекции.
    const collection = screen.getByRole('region', { name: 'Коллекция существ' })
    expect(within(collection).getByText('Магмовый голем')).toBeTruthy()
  })

  it('подсказывает, когда пара не соединяется', async () => {
    await seedSave({ energy: 1000, ownedCreatures: { mossling: 1, dewfin: 1 } })
    await renderIsland()

    fireEvent.click(screen.getByRole('button', { name: /Существа/ }))
    const lab = screen.getByRole('region', { name: 'Лаборатория слияний' })

    fireEvent.click(within(lab).getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор существа для слияния' })).getByRole('button', { name: /Моховик/ }))

    fireEvent.click(within(lab).getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Выбор существа для слияния' })).getByRole('button', { name: /Росинка/ }))

    expect(within(lab).getByText(/не соединяются|Выберите двух существ/)).toBeTruthy()
  })

  it('секретное существо скрыто силуэтом и недоступно из яиц', async () => {
    await seedSave()
    await renderIsland()

    fireEvent.click(screen.getByRole('button', { name: /Существа/ }))
    const collection = screen.getByRole('region', { name: 'Коллекция существ' })
    fireEvent.click(within(collection).getByRole('button', { name: /Слияния/ }))

    const secretCards = within(collection).getAllByRole('button', { name: /Тайное существо/ })
    expect(secretCards.length).toBeGreaterThan(0)
    for (const card of secretCards) {
      expect((card as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('жилища в интерфейсе', () => {
  it('на острове видны четыре жилища, которые можно построить', async () => {
    await seedSave({ energy: 500, ownedCreatures: { mossling: 1 } })
    await renderIsland()

    const section = screen.getByRole('region', { name: 'Среда обитания' })
    for (const name of ['Лесная роща', 'Вулкан', 'Кристальная пещера', 'Облачный сад']) {
      expect(within(section).getByRole('heading', { name })).toBeTruthy()
    }
    expect(within(section).getAllByRole('button', { name: /Построить/ })).toHaveLength(4)
    expect(within(section).getAllByText(/Не построено/)).toHaveLength(4)
  })

  it('постройка лесной рощи открывает слоты и позволяет заселить существо', async () => {
    await seedSave({ energy: 100_000, ownedCreatures: { mossling: 1 } })
    await renderIsland()

    const section = screen.getByRole('region', { name: 'Среда обитания' })
    const forest = within(section).getByRole('heading', { name: 'Лесная роща' }).closest('article')!

    fireEvent.click(within(forest).getByRole('button', { name: /Построить/ }))

    expect(useGameStore.getState().habitats.forest.level).toBe(1)
    expect(within(forest).getByText(/Уровень 1 из 5/)).toBeTruthy()
    expect(within(forest).getAllByRole('button', { name: /слот/ })).toHaveLength(2)

    fireEvent.click(within(forest).getAllByRole('button', { name: /слот/ })[0])
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Заселить в Лесная роща' })).getByRole('button', { name: /Моховик/ }))

    expect(useGameStore.getState().habitatBonus).toBeCloseTo(0.05, 6)
    expect(within(forest).getByRole('button', { name: /Моховик/ })).toBeTruthy()
    expect(within(section).getByText(/Доход \+5%/)).toBeTruthy()
  })

  it('без энергии кнопка постройки неактивна', async () => {
    await seedSave({ energy: 10 })
    await renderIsland()

    const section = screen.getByRole('region', { name: 'Среда обитания' })
    for (const button of within(section).getAllByRole('button', { name: /Построить/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
