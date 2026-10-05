import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Modules = Awaited<ReturnType<typeof loadModules>>

async function loadModules() {
  vi.resetModules()
  const [income, lifecycle, store] = await Promise.all([
    import('../../src/game/passiveIncome'),
    import('../../src/platform/gameLifecycle'),
    import('../../src/game/gameStore'),
  ])
  return { income, lifecycle, store }
}

/** Готовит игру: 2 энергии в секунду, без сохранений. */
function prepareGame(modules: Modules): void {
  modules.store.useGameStore.setState({
    energy: 0,
    energyPerSecond: 2,
    hydrated: true,
    dailyTasks: [],
    totalEnergyEarned: 0,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('начисление пассивного дохода', () => {
  it('начисляет доход за прошедшие секунды', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(5000)

    expect(modules.store.useGameStore.getState().energy).toBe(10)
    modules.income.stopPassiveIncome()
  })

  it('не начисляет доход дважды за один и тот же период', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(3000)

    const afterFirst = modules.store.useGameStore.getState().energy
    expect(afterFirst).toBe(6)

    // Повторные запуски не создают второй таймер (StrictMode и HMR).
    modules.income.startPassiveIncome()
    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(2000)

    expect(modules.store.useGameStore.getState().energy).toBe(10)
    modules.income.stopPassiveIncome()
  })

  it('останавливает начисление на паузе и отдаёт пропущенное время при возобновлении', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(2000)
    expect(modules.store.useGameStore.getState().energy).toBe(4)

    // Реклама: пауза на 30 секунд.
    modules.lifecycle.pauseGame('sdk')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(modules.store.useGameStore.getState().energy).toBe(4)

    modules.lifecycle.resumeGame('sdk')
    await vi.advanceTimersByTimeAsync(100)

    // Пропущенное время начислено ровно один раз: 4 + 30 * 2 = 64.
    expect(modules.store.useGameStore.getState().energy).toBe(64)
    modules.income.stopPassiveIncome()
  })

  it('не начисляет дважды при переключении вкладки и возврате из рекламы', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(1000)

    modules.lifecycle.pauseGame('hidden')
    await vi.advanceTimersByTimeAsync(10_000)
    modules.lifecycle.pauseGame('sdk')
    await vi.advanceTimersByTimeAsync(5000)
    modules.lifecycle.resumeGame('sdk')
    await vi.advanceTimersByTimeAsync(1000)
    modules.lifecycle.resumeGame('hidden')
    await vi.advanceTimersByTimeAsync(1000)

    // 1 с до паузы + 16 с паузы + 1 с после = 18 секунд по 2 энергии.
    expect(modules.store.useGameStore.getState().energy).toBe(36)
    modules.income.stopPassiveIncome()
  })

  it('ограничивает начисление за раз восемью часами', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    modules.income.startPassiveIncome()
    modules.lifecycle.pauseGame('hidden')
    // Отсутствие длиной двое суток.
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
    modules.lifecycle.resumeGame('hidden')
    await vi.advanceTimersByTimeAsync(100)

    const expected = modules.income.MAX_ACCRUAL_SECONDS * 2
    expect(modules.store.useGameStore.getState().energy).toBe(expected)
    modules.income.stopPassiveIncome()
  })

  it('не начисляет доход, если пассивный доход нулевой', async () => {
    const modules = await loadModules()
    prepareGame(modules)
    modules.store.useGameStore.setState({ energyPerSecond: 0 })

    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(5000)

    expect(modules.store.useGameStore.getState().energy).toBe(0)
    modules.income.stopPassiveIncome()
  })

  it('после остановки не начисляет доход', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    modules.income.startPassiveIncome()
    await vi.advanceTimersByTimeAsync(3000)
    modules.income.stopPassiveIncome()

    const frozen = modules.store.useGameStore.getState().energy
    await vi.advanceTimersByTimeAsync(5000)

    expect(modules.store.useGameStore.getState().energy).toBe(frozen)
  })

  it('сообщает состояние движка начисления', async () => {
    const modules = await loadModules()
    prepareGame(modules)

    expect(modules.income.getPassiveIncomeState().running).toBe(false)
    modules.income.startPassiveIncome()
    expect(modules.income.getPassiveIncomeState().running).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(modules.income.getPassiveIncomeState().accruals).toBeGreaterThan(0)
    modules.income.stopPassiveIncome()
    expect(modules.income.getPassiveIncomeState().running).toBe(false)
  })
})
