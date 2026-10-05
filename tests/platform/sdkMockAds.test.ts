import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMockSdk } from '../../src/platform/sdkMock'

/**
 * Сквозная проверка dev-режима: мок SDK (`/sdk.js`) + рекламный модуль.
 * Именно этим путём реклама проверяется локально, до публикации на платформе.
 */

const immediateAds = {
  firstAdDelayMs: 0,
  interstitialCooldownMs: 0,
  interstitialMinActions: 0,
  rewardedCooldownMs: 0,
}

/** Нажимает кнопку мок-оверлея рекламы по её тексту. */
async function clickAdButton(label: string): Promise<void> {
  const button = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('[data-mock-sdk-ad] button')]
      .find((candidate) => candidate.textContent?.includes(label))
    expect(found).toBeTruthy()
    return found as HTMLButtonElement
  })
  button.click()
}

function cleanupOverlays(): void {
  for (const overlay of document.querySelectorAll('[data-mock-sdk-ad]')) overlay.remove()
}

beforeEach(() => {
  delete window.YaGames
  window.localStorage.clear()
})

afterEach(() => {
  cleanupOverlays()
  vi.restoreAllMocks()
  delete window.YaGames
})

async function prepare() {
  installMockSdk()
  vi.resetModules()
  const [ads, lifecycle, platform] = await Promise.all([
    import('../../src/platform/ads'),
    import('../../src/platform/gameLifecycle'),
    import('../../src/platform/yandexSdk'),
  ])
  await platform.getSdkSession()
  ads.configureAds(immediateAds)
  ads.setAdsEnabled(true)
  return { ads, lifecycle, platform }
}

describe('мок SDK и реклама', () => {
  it('показывает мок вознаграждаемой рекламы и выдаёт награду после просмотра', async () => {
    const { ads, lifecycle } = await prepare()

    const result = ads.showRewarded()
    await vi.waitFor(() => expect(lifecycle.isGamePaused()).toBe(true))

    // Игра остановлена, пока реклама на экране (п. 4.7 требований).
    expect(ads.getAdsState().adInProgress).toBe(true)

    await clickAdButton('Досмотреть и получить награду')

    expect(await result).toBe('completed')
    expect(ads.getAdsState().rewardedGranted).toBe(1)
    expect(lifecycle.isGamePaused()).toBe(false)
  })

  it('не выдаёт награду при закрытии мок-рекламы без просмотра', async () => {
    const { ads } = await prepare()

    const result = ads.showRewarded()
    await vi.waitFor(() => expect(ads.getAdsState().adInProgress).toBe(true))

    await clickAdButton('Закрыть без награды')

    expect(await result).toBe('skipped')
    expect(ads.getAdsState().rewardedGranted).toBe(0)
  })

  it('показывает мок полноэкранной рекламы и возобновляет игру после закрытия', async () => {
    const { ads, lifecycle } = await prepare()

    const result = ads.showInterstitial()
    await vi.waitFor(() => expect(lifecycle.isGamePaused()).toBe(true))

    await clickAdButton('Закрыть рекламу')

    expect(await result).toBe('completed')
    expect(lifecycle.isGamePaused()).toBe(false)
  })
})
