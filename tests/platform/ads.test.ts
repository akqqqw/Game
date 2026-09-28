import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk } from '../helpers/fakeSdk'
import type { AdsConfig } from '../../src/platform/ads'

/** Настройки, при которых пейсинг не мешает проверять сами рекламные сценарии. */
const immediateAds: Partial<AdsConfig> = {
  firstAdDelayMs: 0,
  interstitialCooldownMs: 0,
  interstitialMinActions: 0,
  rewardedCooldownMs: 0,
}

async function loadModules() {
  vi.resetModules()
  return {
    ads: await import('../../src/platform/ads'),
    lifecycle: await import('../../src/platform/gameLifecycle'),
    platform: await import('../../src/platform/yandexSdk'),
  }
}

type Modules = Awaited<ReturnType<typeof loadModules>>

/** Поднимает SDK, включает рекламу и применяет к пейсингу указанные настройки. */
async function prepareAds(options: {
  withAds?: boolean
  config?: Partial<AdsConfig>
  enable?: boolean
  modules?: Modules
} = {}) {
  const sdk = installFakeSdk({ authorized: true, withAds: options.withAds ?? true })
  const modules = options.modules ?? (await loadModules())
  await modules.platform.getSdkSession()

  modules.ads.configureAds({ ...immediateAds, ...options.config })
  if (options.enable !== false) modules.ads.setAdsEnabled(true)

  return { sdk, ...modules }
}

/** Дожидается, пока модуль отметит начавшийся показ рекламы. */
async function waitForAdStart(ads: Modules['ads']): Promise<void> {
  await vi.waitFor(() => {
    expect(ads.getAdsState().adInProgress).toBe(true)
  })
}

beforeEach(() => {
  delete window.YaGames
})

afterEach(() => {
  delete window.YaGames
  vi.restoreAllMocks()
})

describe('реклама выключена (состояние по умолчанию)', () => {
  it('не обращается к SDK, пока реклама выключена', async () => {
    const { sdk, ads, lifecycle } = await prepareAds({ enable: false })

    expect(ads.isAdsEnabled()).toBe(false)
    expect(await ads.showInterstitial()).toBe('disabled')
    expect(await ads.showRewarded()).toBe('disabled')
    expect(sdk.ads.fullscreenCalls).toBe(0)
    expect(sdk.ads.rewardedCalls).toBe(0)
    expect(lifecycle.isGamePaused()).toBe(false)
  })

  it('недоступна без SDK', async () => {
    const { ads } = await loadModules()
    ads.setAdsEnabled(true)

    expect(ads.isAdsAvailable()).toBe(false)
    expect(await ads.showInterstitial()).toBe('unavailable')
    expect(await ads.showRewarded()).toBe('unavailable')
  })

  it('не вызывается, если рекламного модуля в SDK нет', async () => {
    const { ads } = await prepareAds({ withAds: false })

    expect(ads.isAdsAvailable()).toBe(false)
    expect(await ads.showInterstitial()).toBe('unavailable')
  })
})

describe('вознаграждаемая реклама', () => {
  it('выдаёт награду только после подтверждённого показа', async () => {
    const { sdk, ads } = await prepareAds()

    const result = ads.showRewarded()
    await waitForAdStart(ads)

    // Платформа подтверждает показ, затем реклама закрывается.
    sdk.ads.grantReward()
    sdk.ads.closeRewarded()

    expect(await result).toBe('completed')
    expect(ads.getAdsState().rewardedGranted).toBe(1)
  })

  it('не выдаёт награду, если реклама закрыта без просмотра', async () => {
    const { sdk, ads } = await prepareAds()

    const result = ads.showRewarded()
    await waitForAdStart(ads)
    sdk.ads.closeRewarded()

    expect(await result).toBe('skipped')
    expect(ads.getAdsState().rewardedGranted).toBe(0)
  })

  it('сообщает об ошибке показа', async () => {
    const { sdk, ads } = await prepareAds()

    const result = ads.showRewarded()
    await waitForAdStart(ads)
    sdk.ads.failRewarded()

    expect(await result).toBe('error')
    expect(ads.getAdsState().rewardedGranted).toBe(0)
  })
})

describe('полноэкранная реклама', () => {
  it('возвращает completed после показа и учитывает его в статистике', async () => {
    const { sdk, ads } = await prepareAds()

    const result = ads.showInterstitial()
    await waitForAdStart(ads)
    sdk.ads.closeFullscreen(true)

    expect(await result).toBe('completed')
    expect(ads.getAdsState().interstitialsShown).toBe(1)
  })

  it('различает закрытие и отсутствие рекламного контента', async () => {
    const { sdk, ads } = await prepareAds()

    const result = ads.showInterstitial()
    await waitForAdStart(ads)
    sdk.ads.closeFullscreen(false)

    expect(await result).toBe('no-content')
  })

  it('сообщает об ошибке показа', async () => {
    const { sdk, ads } = await prepareAds()

    const result = ads.showInterstitial()
    await waitForAdStart(ads)
    sdk.ads.failFullscreen()

    expect(await result).toBe('error')
  })
})

describe('пауза игры во время рекламы', () => {
  it('останавливает игру на время показа и возобновляет после', async () => {
    const { sdk, ads, lifecycle } = await prepareAds()

    expect(lifecycle.isGamePaused()).toBe(false)

    const result = ads.showInterstitial()
    await vi.waitFor(() => expect(lifecycle.isGamePaused()).toBe(true))
    expect(lifecycle.getPauseReasons()).toContain('ad')

    sdk.ads.closeFullscreen(true)
    await result

    expect(lifecycle.isGamePaused()).toBe(false)
  })

  it('оставляет игру на паузе, если активна другая причина', async () => {
    const { sdk, ads, lifecycle } = await prepareAds()

    lifecycle.pauseGame('hidden')
    const result = ads.showInterstitial()
    await waitForAdStart(ads)

    sdk.ads.closeFullscreen(true)
    await result

    expect(lifecycle.isGamePaused()).toBe(true)
    lifecycle.resumeGame('hidden')
    expect(lifecycle.isGamePaused()).toBe(false)
  })

  it('возвращает управление по страховочному таймауту, если колбэки не пришли', async () => {
    vi.useFakeTimers()
    try {
      const { ads, lifecycle } = await prepareAds({ config: { interstitialTimeoutMs: 5000 } })

      const result = ads.showInterstitial()
      await vi.advanceTimersByTimeAsync(10)
      expect(lifecycle.isGamePaused()).toBe(true)

      await vi.advanceTimersByTimeAsync(5100)

      expect(await result).toBe('error')
      expect(lifecycle.isGamePaused()).toBe(false)
      expect(ads.getAdsState().adInProgress).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('не запускает вторую рекламу во время показа', async () => {
    const { sdk, ads } = await prepareAds()

    const first = ads.showInterstitial()
    await waitForAdStart(ads)

    expect(await ads.showRewarded()).toBe('throttled')
    expect(await ads.showInterstitial()).toBe('throttled')

    sdk.ads.closeFullscreen(true)
    expect(await first).toBe('completed')
  })
})

describe('пейсинг показов', () => {
  it('не показывает рекламу в первые минуты сессии', async () => {
    const { sdk, ads } = await prepareAds({ config: { firstAdDelayMs: 120_000 } })

    expect(ads.canShowInterstitial()).toBe(false)
    expect(await ads.showInterstitial()).toBe('throttled')
    expect(sdk.ads.fullscreenCalls).toBe(0)
  })

  it('требует минимальное число действий игрока', async () => {
    const { sdk, ads } = await prepareAds({ config: { interstitialMinActions: 10 } })

    ads.noteGameAction(9)
    expect(ads.canShowInterstitial()).toBe(false)
    expect(await ads.showInterstitial()).toBe('throttled')

    ads.noteGameAction()
    expect(ads.canShowInterstitial()).toBe(true)

    const result = ads.showInterstitial()
    await waitForAdStart(ads)
    sdk.ads.closeFullscreen(true)
    expect(await result).toBe('completed')
  })

  it('соблюдает кулдаун и сбрасывает счётчик действий после показа', async () => {
    const { sdk, ads } = await prepareAds({ config: { interstitialCooldownMs: 60_000 } })

    const first = ads.showInterstitial()
    await waitForAdStart(ads)
    sdk.ads.closeFullscreen(true)
    expect(await first).toBe('completed')

    expect(ads.getAdsState().actionsSinceLastInterstitial).toBe(0)
    expect(ads.canShowInterstitial()).toBe(false)
    expect(await ads.showInterstitial()).toBe('throttled')
  })

  it('не показывает рекламу, когда вкладка скрыта', async () => {
    const { ads } = await prepareAds()
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })

    expect(await ads.showInterstitial()).toBe('throttled')
    expect(await ads.showRewarded()).toBe('throttled')

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('считает действия игрока из игровой логики', async () => {
    const { ads } = await prepareAds({ config: { interstitialMinActions: 3 } })
    const store = await import('../../src/game/gameStore')

    expect(ads.getAdsState().actionsSinceLastInterstitial).toBe(0)

    store.useGameStore.getState().addEnergy()
    store.useGameStore.getState().addEnergy()
    expect(ads.canShowInterstitial()).toBe(false)

    store.useGameStore.getState().addEnergy()
    expect(ads.getAdsState().actionsSinceLastInterstitial).toBe(3)
    expect(ads.canShowInterstitial()).toBe(true)
  })

  it('соблюдает кулдаун вознаграждаемой рекламы', async () => {
    const { sdk, ads } = await prepareAds({ config: { rewardedCooldownMs: 30_000 } })

    const first = ads.showRewarded()
    await waitForAdStart(ads)
    sdk.ads.grantReward()
    sdk.ads.closeRewarded()
    expect(await first).toBe('completed')

    expect(ads.canShowRewarded()).toBe(false)
    expect(await ads.showRewarded()).toBe('throttled')
  })
})
