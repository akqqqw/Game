import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YandexSdk } from '../../src/platform/sdkTypes'

/** Управление полноэкранным режимом в фейковом SDK. */
type FullscreenRecorder = {
  requests: number
  exits: number
  status: 'on' | 'off'
}

/**
 * Ставит фейковый SDK с настраиваемым `deviceInfo` и `screen.fullscreen`,
 * чтобы проверить поведение на мобильных и десктопе.
 */
function installSdkWithScreen(options: {
  device?: 'mobile' | 'tablet' | 'desktop'
  fullscreenStatus?: 'on' | 'off'
  withScreen?: boolean
}): FullscreenRecorder {
  const { device = 'mobile', fullscreenStatus = 'off', withScreen = true } = options
  const recorder: FullscreenRecorder = { requests: 0, exits: 0, status: fullscreenStatus }

  const sdk = {
    environment: { i18n: { lang: 'ru' } },
    deviceInfo: {
      type: device,
      isMobile: () => device === 'mobile',
      isTablet: () => device === 'tablet',
      isDesktop: () => device === 'desktop',
      isTV: () => false,
    },
    ...(withScreen
      ? {
          screen: {
            fullscreen: {
              // В SDK это живое свойство: состояние меняется после запросов.
              get status() {
                return recorder.status
              },
              async request() {
                recorder.requests += 1
                recorder.status = 'on'
              },
              async exit() {
                recorder.exits += 1
                recorder.status = 'off'
              },
            },
          },
        }
      : {}),
  } as unknown as YandexSdk

  window.YaGames = {
    async init() {
      return sdk
    },
  }

  return recorder
}

async function loadModules() {
  vi.resetModules()
  return {
    fullscreen: await import('../../src/platform/fullscreen'),
    platform: await import('../../src/platform/yandexSdk'),
  }
}

beforeEach(() => {
  delete window.YaGames
})

afterEach(() => {
  delete window.YaGames
  vi.restoreAllMocks()
})

describe('полноэкранный режим', () => {
  it('запрашивает полный экран на мобильном при первом касании', async () => {
    const recorder = installSdkWithScreen({ device: 'mobile' })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    fullscreen.initMobileFullscreen()
    window.dispatchEvent(new Event('pointerdown'))

    await vi.waitFor(() => expect(recorder.requests).toBe(1))
  })

  it('не запрашивает полный экран на десктопе', async () => {
    const recorder = installSdkWithScreen({ device: 'desktop' })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    fullscreen.initMobileFullscreen()
    window.dispatchEvent(new Event('pointerdown'))
    await new Promise((resolve) => window.setTimeout(resolve, 30))

    expect(recorder.requests).toBe(0)
  })

  it('не запрашивает повторно, если режим уже включён', async () => {
    const recorder = installSdkWithScreen({ device: 'mobile', fullscreenStatus: 'on' })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    fullscreen.initMobileFullscreen()
    window.dispatchEvent(new Event('pointerdown'))
    await new Promise((resolve) => window.setTimeout(resolve, 30))

    expect(recorder.requests).toBe(0)
  })

  it('запрашивает только один раз на первую попытку', async () => {
    const recorder = installSdkWithScreen({ device: 'mobile' })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    fullscreen.initMobileFullscreen()
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('touchstart'))
    await vi.waitFor(() => expect(recorder.requests).toBe(1))

    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(recorder.requests).toBe(1)
  })

  it('работает без объекта screen в SDK', async () => {
    const recorder = installSdkWithScreen({ device: 'mobile', withScreen: false })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    fullscreen.initMobileFullscreen()
    window.dispatchEvent(new Event('pointerdown'))
    await new Promise((resolve) => window.setTimeout(resolve, 30))

    expect(recorder.requests).toBe(0)
    expect(fullscreen.getFullscreenStatus()).not.toBe('on')
  })

  it('сообщает состояние режима', async () => {
    installSdkWithScreen({ device: 'mobile', fullscreenStatus: 'on' })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    expect(fullscreen.getFullscreenStatus()).toBe('on')
    await fullscreen.exitFullscreen()
  })

  it('переключает режим: включение и выключение', async () => {
    const recorder = installSdkWithScreen({ device: 'mobile' })
    const { fullscreen, platform } = await loadModules()
    await platform.getSdkSession()

    await fullscreen.toggleFullscreen()
    expect(recorder.requests).toBe(1)

    await fullscreen.toggleFullscreen()
    expect(recorder.exits).toBe(1)
  })
})
