import type { YandexPlayer, YandexSdk } from '../../src/platform/sdkTypes'

export const CLOUD_KEY = 'evolution-isles-save'

export type CloudRecorder = {
  /** Все вызовы player.setData(). */
  writes: { save: Record<string, unknown>; flush: boolean }[]
  /** Содержимое «облака». */
  cloud: Record<string, unknown>
  failWrites: (fail: boolean) => void
  failReads: (fail: boolean) => void
  /** Меняет статус авторизации игрока (имитация входа через диалог Яндекса). */
  setAuthorized: (value: boolean) => void
  getPlayerCalls: () => number
}

type SdkOptions = {
  /** Авторизован ли игрок на платформе. */
  authorized?: boolean
  /** Начальное содержимое облака. */
  cloud?: Record<string, unknown>
}

/**
 * Устанавливает `window.YaGames` с записывающим облачным хранилищем —
 * используется вместо реального SDK в тестах.
 */
export function installFakeSdk(options: SdkOptions = {}): CloudRecorder {
  const { authorized = true, cloud = {} } = options
  let isAuthorized = authorized
  let writeFails = false
  let readFails = false
  let getPlayerCalls = 0

  const recorder: CloudRecorder = {
    writes: [],
    cloud: { ...cloud },
    failWrites: (fail) => {
      writeFails = fail
    },
    failReads: (fail) => {
      readFails = fail
    },
    setAuthorized: (value) => {
      isAuthorized = value
    },
    getPlayerCalls: () => getPlayerCalls,
  }

  const player: YandexPlayer = {
    async getData(keys) {
      if (readFails) throw new Error('network error')
      if (!keys?.length) return { ...recorder.cloud }
      return Object.fromEntries(keys.filter((key) => key in recorder.cloud).map((key) => [key, recorder.cloud[key]]))
    },
    async setData(data, flush) {
      if (writeFails) throw new Error('network error')
      recorder.writes.push({ save: data, flush: Boolean(flush) })
      Object.assign(recorder.cloud, data)
    },
    isAuthorized: () => isAuthorized,
  }

  const sdk: YandexSdk = {
    environment: { i18n: { lang: 'ru' } },
    features: {
      LoadingAPI: { ready: () => undefined },
      GameplayAPI: { start: () => undefined, stop: () => undefined },
    },
    async getPlayer() {
      getPlayerCalls += 1
      return player
    },
    on: () => undefined,
    off: () => undefined,
  }

  window.YaGames = {
    async init() {
      return sdk
    },
  }

  return recorder
}

/** Создаёт объект сохранения (актуальная версия схемы) для тестов. */
export function makeSave(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    energy: 1000,
    clickPower: 5,
    energyPerSecond: 3,
    clickUpgradeCost: 100,
    sunwellLevel: 2,
    sunwellCost: 200,
    eggCost: 100,
    ownedCreatures: { mossling: 2 },
    lastHatchedId: 'mossling',
    stars: 10,
    eggInventory: 1,
    totalEnergyEarned: 5000,
    eggsOpened: 3,
    upgradesBought: 4,
    totalClicks: 120,
    unlockedAchievements: ['first-click'],
    dailyTasks: [],
    dailyTaskDate: '',
    savedAt: 1_000_000,
    ...overrides,
  }
}
