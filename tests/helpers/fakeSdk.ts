import type { YandexAdCallbacks, YandexPlayer, YandexRewardedCallbacks, YandexSdk } from '../../src/platform/sdkTypes'

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
  /** Подключать ли рекламный модуль. */
  withAds?: boolean
}

/**
 * Управление рекламой в фейковом SDK: тест сам решает, как завершится показ,
 * — так проверяются все ветки (закрытие, награда, ошибка, отсутствие контента).
 */
export type AdsRecorder = {
  fullscreenCalls: number
  rewardedCalls: number
  /** Закрыть полноэкранную рекламу (`wasShown` — была ли она показана). */
  closeFullscreen: (wasShown?: boolean) => void
  /** Сообщить об ошибке полноэкранной рекламы. */
  failFullscreen: () => void
  /** Подтвердить показ вознаграждаемой рекламы. */
  grantReward: () => void
  /** Закрыть вознаграждаемую рекламу (награда — только если `grantReward` вызван). */
  closeRewarded: () => void
  /** Сообщить об ошибке вознаграждаемой рекламы. */
  failRewarded: () => void
  /** Есть ли активный показ, колбэки которого ещё не вызваны. */
  pending: () => 'none' | 'fullscreen' | 'rewarded'
}

/**
 * Устанавливает `window.YaGames` с записывающим облачным хранилищем —
 * используется вместо реального SDK в тестах.
 */
export function installFakeSdk(options: SdkOptions = {}): CloudRecorder {
  const { authorized = true, cloud = {}, withAds = true } = options
  let isAuthorized = authorized
  let writeFails = false
  let readFails = false
  let getPlayerCalls = 0

  let pendingAd: 'none' | 'fullscreen' | 'rewarded' = 'none'
  let fullscreenCallbacks: YandexAdCallbacks | null = null
  let rewardedCallbacks: YandexRewardedCallbacks | null = null

  const adsRecorder: AdsRecorder = {
    fullscreenCalls: 0,
    rewardedCalls: 0,
    closeFullscreen: (wasShown = true) => {
      pendingAd = 'none'
      fullscreenCallbacks?.onClose?.(wasShown)
    },
    failFullscreen: () => {
      pendingAd = 'none'
      fullscreenCallbacks?.onError?.({ code: 'mock' })
    },
    grantReward: () => {
      rewardedCallbacks?.onRewarded?.()
    },
    closeRewarded: () => {
      pendingAd = 'none'
      rewardedCallbacks?.onClose?.(true)
    },
    failRewarded: () => {
      pendingAd = 'none'
      rewardedCallbacks?.onError?.({ code: 'mock' })
    },
    pending: () => pendingAd,
  }

  const ads = {
    showFullscreenAdv({ callbacks }: { callbacks?: YandexAdCallbacks } = {}) {
      adsRecorder.fullscreenCalls += 1
      pendingAd = 'fullscreen'
      fullscreenCallbacks = callbacks ?? null
      callbacks?.onOpen?.()
    },
    showRewardedVideo({ callbacks }: { callbacks?: YandexRewardedCallbacks } = {}) {
      adsRecorder.rewardedCalls += 1
      pendingAd = 'rewarded'
      rewardedCallbacks = callbacks ?? null
      callbacks?.onOpen?.()
    },
  }

  const recorder: CloudRecorder & { ads: AdsRecorder } = {
    ads: adsRecorder,
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
    ...(withAds ? { adv: ads } : {}),
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
