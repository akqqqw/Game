import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk } from '../helpers/fakeSdk'
import type { AdsConfig } from '../../src/platform/ads'

/**
 * Точки показа рекламы: где игра может включить полноэкранную рекламу
 * и какие гарантии она при этом даёт (п. 4.4 и 4.7 требований платформы).
 */

/** Настройки без пейсинга: проверяем сами точки, а не расписание показов. */
const immediateAds: Partial<AdsConfig> = {
  firstAdDelayMs: 0,
  interstitialCooldownMs: 0,
  interstitialMinActions: 0,
}

async function loadModules() {
  vi.resetModules()
  return {
    ads: await import('../../src/platform/ads'),
    adPoints: await import('../../src/platform/adPoints'),
    lifecycle: await import('../../src/platform/gameLifecycle'),
    platform: await import('../../src/platform/yandexSdk'),
  }
}

type Modules = Awaited<ReturnType<typeof loadModules>>

async function prepare(options: {
  withAds?: boolean
  enable?: boolean
  config?: Partial<AdsConfig>
} = {}) {
  const sdk = installFakeSdk({ authorized: true, withAds: options.withAds ?? true })
  const modules = await loadModules()
  await modules.platform.getSdkSession()

  modules.ads.configureAds({ ...immediateAds, ...options.config })
  if (options.enable !== false) modules.ads.setAdsEnabled(true)
  // Показ не должен ждать паузу «интерфейс показывает результат».
  modules.adPoints.configureAdPoints({ delayMs: 0 })

  return { sdk, ...modules }
}

/** Дожидается начала показа рекламы. */
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

describe('реклама включается при запуске игры', () => {
  it('bootstrapPlatform включает рекламный модуль', async () => {
    installFakeSdk({ authorized: true, withAds: true })
    vi.resetModules()
    const ads = await import('../../src/platform/ads')
    const bootstrap = await import('../../src/platform/bootstrap')

    expect(ads.isAdsEnabled()).toBe(false)
    bootstrap.bootstrapPlatform()

    // Монетизация — требование платформы (п. 1.12): реклама должна быть включена,
    // показ при этом ограничен точками и пейсингом.
    expect(ads.isAdsEnabled()).toBe(true)
  })
})

describe('точка показа срабатывает в логической паузе', () => {
  it('после завершённого действия показывает рекламу и ставит игру на паузу', async () => {
    const { sdk, ads, adPoints, lifecycle } = await prepare()

    expect(adPoints.requestAdPoint('egg-hatched')).toBe(true)
    await waitForAdStart(ads)

    expect(sdk.ads.fullscreenCalls).toBe(1)
    // Игра и звук остановлены, пока идёт показ (п. 4.7).
    expect(lifecycle.isGamePaused()).toBe(true)

    sdk.ads.closeFullscreen(true)
    await vi.waitFor(() => {
      expect(lifecycle.isGamePaused()).toBe(false)
    })
    expect(adPoints.getAdPointsState().shows).toBe(1)
    expect(adPoints.getAdPointsState().lastOutcome).toBe('completed')
    expect(adPoints.getAdPointsState().lastPoint).toBe('egg-hatched')
  })

  it('показывает рекламу после каждого типа точки', async () => {
    const points = ['egg-hatched', 'fusion-done', 'upgrade-bought', 'habitat-upgraded', 'screen-change'] as const

    for (const point of points) {
      const { sdk, ads, adPoints } = await prepare({ config: { interstitialCooldownMs: 0 } })
      expect(adPoints.requestAdPoint(point)).toBe(true)
      await waitForAdStart(ads)
      expect(sdk.ads.fullscreenCalls).toBe(1)
      expect(adPoints.getAdPointsState().lastPoint).toBe(point)
      sdk.ads.closeFullscreen(true)
      await vi.waitFor(() => expect(ads.getAdsState().adInProgress).toBe(false))
      delete window.YaGames
    }
  })

  it('одновременно запланирован только один показ', async () => {
    const { ads, adPoints } = await prepare()

    expect(adPoints.requestAdPoint('egg-hatched')).toBe(true)
    expect(adPoints.requestAdPoint('fusion-done')).toBe(false)
    await waitForAdStart(ads)

    expect(adPoints.getAdPointsState().requests).toBe(1)
  })

  it('повторная точка во время кулдауна не планируется', async () => {
    const { sdk, ads, adPoints } = await prepare({ config: { interstitialCooldownMs: 60_000 } })

    expect(adPoints.requestAdPoint('egg-hatched')).toBe(true)
    await waitForAdStart(ads)
    sdk.ads.closeFullscreen(true)
    await vi.waitFor(() => expect(ads.getAdsState().adInProgress).toBe(false))

    expect(adPoints.requestAdPoint('upgrade-bought')).toBe(false)
    expect(sdk.ads.fullscreenCalls).toBe(1)
  })

  it('до истечения задержки первого показа реклама не планируется', async () => {
    const { sdk, adPoints } = await prepare({ config: { firstAdDelayMs: 60_000 } })

    expect(adPoints.requestAdPoint('egg-hatched')).toBe(false)
    expect(adPoints.getAdPointsState().pending).toBe(false)
    expect(sdk.ads.fullscreenCalls).toBe(0)
  })
})

describe('точка показа уважает выключенную рекламу и отсутствие SDK', () => {
  it('при выключенной рекламе ничего не происходит', async () => {
    const { sdk, adPoints, lifecycle } = await prepare({ enable: false })

    expect(adPoints.requestAdPoint('egg-hatched')).toBe(false)
    expect(sdk.ads.fullscreenCalls).toBe(0)
    expect(lifecycle.isGamePaused()).toBe(false)
    expect(adPoints.getAdPointsState().requests).toBe(0)
  })

  it('без рекламного модуля в SDK показ не запрашивается', async () => {
    const { sdk, adPoints } = await prepare({ withAds: false })

    expect(adPoints.requestAdPoint('screen-change')).toBe(false)
    expect(sdk.ads.fullscreenCalls).toBe(0)
  })
})

describe('точка показа не ломает игру', () => {
  it('закрытие без показа не считается показом', async () => {
    const { sdk, ads, adPoints, lifecycle } = await prepare()

    adPoints.requestAdPoint('egg-hatched')
    await waitForAdStart(ads)
    sdk.ads.closeFullscreen(false)

    await vi.waitFor(() => expect(lifecycle.isGamePaused()).toBe(false))
    expect(adPoints.getAdPointsState().shows).toBe(0)
    expect(adPoints.getAdPointsState().lastOutcome).toBe('no-content')
  })

  it('ошибка показа возвращает управление игроку', async () => {
    const { sdk, ads, adPoints, lifecycle } = await prepare()

    adPoints.requestAdPoint('fusion-done')
    await waitForAdStart(ads)
    sdk.ads.failFullscreen()

    await vi.waitFor(() => expect(lifecycle.isGamePaused()).toBe(false))
    expect(adPoints.getAdPointsState().lastOutcome).toBe('error')
    expect(adPoints.getAdPointsState().shows).toBe(0)
  })

  it('запланированный показ можно отменить', async () => {
    const { sdk, adPoints } = await prepare()
    adPoints.configureAdPoints({ delayMs: 50 })

    expect(adPoints.requestAdPoint('egg-hatched')).toBe(true)
    adPoints.cancelPendingAdPoint()

    await new Promise((resolve) => window.setTimeout(resolve, 80))
    expect(sdk.ads.fullscreenCalls).toBe(0)
    expect(adPoints.getAdPointsState().pending).toBe(false)
  })
})
