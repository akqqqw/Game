/**
 * Рекламный модуль Яндекс Игр.
 *
 * Модуль полностью изолирован: игровая логика о нём ничего не знает, кроме
 * двух вызовов — `noteGameAction()` (счётчик активности для пейсинга) и
 * `showInterstitial()` / `showRewarded()` в точках показа. Если модуль удалить
 * или оставить выключенным, игра продолжит работать без изменений.
 *
 * Правила, заложенные в реализацию:
 *  - реклама НЕ включается автоматически: `enabled: false` по умолчанию, показ
 *    возможен только по явному вызову из разрешённой точки;
 *  - никакой рекламы на старте, при каждом клике и в первые минуты сессии —
 *    работают задержка первого показа, кулдаун и счётчик действий игрока;
 *  - игра и звук останавливаются на время показа и возобновляются после него
 *    (п. 4.7); страховочный таймаут вернёт управление, если колбэки не пришли;
 *  - награда за вознаграждаемую рекламу выдаётся только при подтверждённом
 *    показе (`onRewarded`), п. 4.5;
 *  - при отсутствии SDK, рекламного контента или ошибке игра не ломается.
 *
 * Документация: https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
 */

import { pauseGame, resumeGame } from './gameLifecycle'
import type { YandexAdv } from './sdkTypes'
import { getSdkSessionSync } from './yandexSdk'

export type AdOutcome =
  /** Реклама показана (для rewarded — подтверждён показ и награда заслужена). */
  | 'completed'
  /** Реклама закрыта без результата: награда НЕ выдаётся. */
  | 'skipped'
  /** Ошибка показа или страховочный таймаут. */
  | 'error'
  /** SDK недоступен либо рекламный модуль отсутствует. */
  | 'unavailable'
  /** Реклама выключена настройкой. */
  | 'disabled'
  /** Показ отклонён пейсингом (кулдаун, мало действий, идёт другая реклама). */
  | 'throttled'
  /** Нет рекламного контента. */
  | 'no-content'

export type AdsConfig = {
  /** Главный выключатель. Пока `false`, ни один рекламный вызов не уходит в SDK. */
  enabled: boolean
  /** Минимальный интервал между полноэкранными показами. */
  interstitialCooldownMs: number
  /** Сколько игровых действий должно пройти между полноэкранными показами. */
  interstitialMinActions: number
  /** Запрет на рекламу в первые минуты сессии (игрок осваивается). */
  firstAdDelayMs: number
  /** Минимальный интервал между вознаграждаемыми показами. */
  rewardedCooldownMs: number
  /** Страховка: сколько ждать колбэки полноэкранной рекламы. */
  interstitialTimeoutMs: number
  /** Страховка: сколько ждать колбэки вознаграждаемой рекламы. */
  rewardedTimeoutMs: number
}

/**
 * Пейсинг по умолчанию — это и есть продакшен-режим: реклама включается
 * отдельно (`enabled: false`), а частоту задают эти числа. Кулдаун и порог
 * действий дают примерно показ раз в 1,5–2 минуты активной игры, но никогда —
 * «на каждый клик»: сначала должно пройти не меньше 12 действий, пауза между
 * показами и первые 45 секунд сессии.
 */
const defaultConfig: AdsConfig = {
  enabled: false,
  interstitialCooldownMs: 90_000,
  interstitialMinActions: 12,
  firstAdDelayMs: 45_000,
  rewardedCooldownMs: 30_000,
  interstitialTimeoutMs: 60_000,
  rewardedTimeoutMs: 120_000,
}

let config: AdsConfig = { ...defaultConfig }

const sessionStartedAt = Date.now()
let actionsSinceLastInterstitial = 0
let lastInterstitialAt = 0
let lastRewardedAt = 0
let adInProgress = false
let interstitialsShown = 0
let rewardedShown = 0
let rewardedGranted = 0

/** Настраивает модуль (например, при подключении рекламы в консоли разработчика). */
export function configureAds(partial: Partial<AdsConfig>): AdsConfig {
  config = { ...config, ...partial }
  return config
}

export function getAdsConfig(): AdsConfig {
  return { ...config }
}

/** Включает или выключает рекламу. По умолчанию реклама выключена. */
export function setAdsEnabled(enabled: boolean): void {
  config = { ...config, enabled }
  console.info(`[ads] Реклама ${enabled ? 'включена' : 'выключена'}`)
}

export function isAdsEnabled(): boolean {
  return config.enabled
}

function getAdv(): YandexAdv | null {
  const session = getSdkSessionSync()
  if (session?.status !== 'ready') return null
  return session.ysdk?.adv ?? null
}

/** Доступен ли рекламный модуль прямо сейчас (без учёта пейсинга). */
export function isAdsAvailable(): boolean {
  return getAdv() !== null
}

/**
 * Отмечает игровое действие (клик, покупка, открытие яйца).
 * Используется только для пейсинга полноэкранной рекламы.
 */
export function noteGameAction(count = 1): void {
  actionsSinceLastInterstitial += count
}

/** Можно ли сейчас показать полноэкранную рекламу (без самого показа). */
export function canShowInterstitial(): boolean {
  if (!config.enabled) return false
  if (!getAdv() || adInProgress) return false
  if (typeof document !== 'undefined' && document.hidden) return false

  const now = Date.now()
  if (now - sessionStartedAt < config.firstAdDelayMs) return false
  if (now - lastInterstitialAt < config.interstitialCooldownMs) return false
  if (actionsSinceLastInterstitial < config.interstitialMinActions) return false

  return true
}

/** Можно ли сейчас показать вознаграждаемую рекламу. */
export function canShowRewarded(): boolean {
  if (!config.enabled) return false
  if (!getAdv() || adInProgress) return false
  if (typeof document !== 'undefined' && document.hidden) return false
  return Date.now() - lastRewardedAt >= config.rewardedCooldownMs
}

type AdRunOptions = {
  /** Зовётся при открытии рекламы (например, чтобы показать заглушку). */
  onOpen?: () => void
}

type AdRunResult = { outcome: AdOutcome; rewarded: boolean }

/**
 * Общий сценарий показа: пауза игры, страховочный таймаут, гарантированное
 * возобновление и разбор колбэков SDK.
 */
async function runAd(
  kind: 'interstitial' | 'rewarded',
  timeoutMs: number,
  start: (adv: YandexAdv, finish: (result: AdRunResult) => void) => void,
  options: AdRunOptions = {},
): Promise<AdOutcome> {
  const adv = getAdv()
  if (!adv) return 'unavailable'
  if (adInProgress) return 'throttled'

  adInProgress = true
  // Останавливаем игру и звук: п. 4.7 требований платформы.
  pauseGame('ad')
  options.onOpen?.()

  const outcome = await new Promise<AdOutcome>((resolve) => {
    let settled = false
    const finish = (result: AdRunResult): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(result.outcome)
    }

    const timer = window.setTimeout(() => {
      // Колбэки не пришли (нет сети, сбой SDK) — возвращаем управление игроку.
      console.info('[ads] Колбэки рекламы не получены, возобновляем игру')
      finish({ outcome: 'error', rewarded: false })
    }, timeoutMs)

    try {
      start(adv, finish)
    } catch (error) {
      console.info('[ads] Не удалось вызвать рекламу:', error instanceof Error ? error.message : error)
      finish({ outcome: 'error', rewarded: false })
    }
  })

  adInProgress = false
  resumeGame('ad')

  if (kind === 'interstitial' && (outcome === 'completed' || outcome === 'skipped')) {
    lastInterstitialAt = Date.now()
    actionsSinceLastInterstitial = 0
    interstitialsShown += 1
  }
  if (kind === 'rewarded' && outcome !== 'disabled' && outcome !== 'unavailable') {
    lastRewardedAt = Date.now()
    rewardedShown += 1
  }
  if (outcome === 'completed' && kind === 'rewarded') {
    rewardedGranted += 1
  }

  return outcome
}

/**
 * Полноэкранная (межстраничная) реклама.
 *
 * Вызывать только из логических пауз игрового процесса: завершение сессии
 * улучшений, возврат на остров после раскрытия яйца, переход между экранами.
 * Никогда — по клику, на старте игры или по таймеру без действий игрока.
 */
export function showInterstitial(options: AdRunOptions = {}): Promise<AdOutcome> {
  if (!config.enabled) return Promise.resolve('disabled')
  // Порядок важен: сначала объясняем, почему показа нет в принципе,
  // и только потом — почему он отложен пейсингом.
  if (!getAdv()) return Promise.resolve('unavailable')
  if (!canShowInterstitial()) return Promise.resolve('throttled')

  return runAd('interstitial', config.interstitialTimeoutMs, (adv, finish) => {
    adv.showFullscreenAdv({
      callbacks: {
        onClose: (wasShown) => {
          // `wasShown === false` — показ не состоялся (нет контента или лимит).
          finish({ outcome: wasShown ? 'completed' : 'no-content', rewarded: false })
        },
        onError: () => finish({ outcome: 'error', rewarded: false }),
      },
    })
  }, options)
}

/**
 * Вознаграждаемая реклама.
 *
 * Возвращает `'completed'` только если платформа подтвердила показ (`onRewarded`).
 * Награду следует выдавать исключительно на этот результат.
 */
export function showRewarded(options: AdRunOptions = {}): Promise<AdOutcome> {
  if (!config.enabled) return Promise.resolve('disabled')
  if (!getAdv()) return Promise.resolve('unavailable')
  if (!canShowRewarded()) return Promise.resolve('throttled')

  return runAd('rewarded', config.rewardedTimeoutMs, (adv, finish) => {
    let rewarded = false
    adv.showRewardedVideo({
      callbacks: {
        onRewarded: () => {
          rewarded = true
        },
        onClose: () => {
          // Награда учитывается только при подтверждённом показе.
          finish({ outcome: rewarded ? 'completed' : 'skipped', rewarded })
        },
        onError: () => finish({ outcome: 'error', rewarded: false }),
      },
    })
  }, options)
}

/** Состояние модуля — для отладки, диагностики и тестов. */
export function getAdsState(): {
  enabled: boolean
  available: boolean
  adInProgress: boolean
  actionsSinceLastInterstitial: number
  interstitialsShown: number
  rewardedShown: number
  rewardedGranted: number
  lastInterstitialAt: number
  lastRewardedAt: number
} {
  return {
    enabled: config.enabled,
    available: isAdsAvailable(),
    adInProgress,
    actionsSinceLastInterstitial,
    interstitialsShown,
    rewardedShown,
    rewardedGranted,
    lastInterstitialAt,
    lastRewardedAt,
  }
}

/** Только для тестов: возвращает модуль в исходное состояние. */
export function resetAdsStateForTests(): void {
  config = { ...defaultConfig }
  actionsSinceLastInterstitial = 0
  lastInterstitialAt = 0
  lastRewardedAt = 0
  adInProgress = false
  interstitialsShown = 0
  rewardedShown = 0
  rewardedGranted = 0
}

declare global {
  interface Window {
    /** Помощник для ручной проверки рекламы в режиме разработки. */
    __adsDebug?: {
      enable: () => void
      disable: () => void
      showInterstitial: () => Promise<AdOutcome>
      showRewarded: () => Promise<AdOutcome>
      state: typeof getAdsState
      canShowInterstitial: typeof canShowInterstitial
      canShowRewarded: typeof canShowRewarded
    }
  }
}

/**
 * Публикует команды для ручной проверки рекламы: `window.__adsDebug`.
 * Подключается только в режиме разработки — в production-сборке недоступно.
 */
export function installAdsDebugHelper(): void {
  window.__adsDebug = {
    enable: () => setAdsEnabled(true),
    disable: () => setAdsEnabled(false),
    showInterstitial: () => showInterstitial(),
    showRewarded: () => showRewarded(),
    state: getAdsState,
    canShowInterstitial,
    canShowRewarded,
  }
  console.info('[ads] Отладка: window.__adsDebug (enable, showInterstitial, showRewarded, state)')
}
