/**
 * Полноэкранный режим.
 *
 * Требование п. 1.6.1.1: на мобильных устройствах игра идёт в полноэкранном
 * режиме. Браузеры разрешают включать его только по команде пользователя,
 * поэтому запрос отправляется на первом касании игрового поля.
 *
 * Отдельной кнопки в интерфейсе нет намеренно: у Яндекс Игр уже есть своя
 * кнопка в правом верхнем углу, а дублирующий элемент управления не нужен
 * (п. 6.7 требований). Когда SDK недоступен (локальный запуск), используется
 * стандартный API браузера, а на обычном десктопе ничего не происходит.
 */

import { getSdkSession, getSdkSessionSync } from './yandexSdk'

type FullscreenStatus = 'on' | 'off' | 'unsupported'

/** Текущее состояние полноэкранного режима. */
export function getFullscreenStatus(): FullscreenStatus {
  const session = getSdkSessionSync()
  const status = session?.ysdk?.screen?.fullscreen?.status
  if (status === 'on' || status === 'off') return status
  if (typeof document !== 'undefined' && document.fullscreenElement) return 'on'
  return 'unsupported'
}

/** Считается ли текущее устройство мобильным или планшетом. */
export async function isMobileDevice(): Promise<boolean> {
  const session = await getSdkSession()
  const deviceInfo = session.ysdk?.deviceInfo
  if (!deviceInfo) {
    // Локальный запуск: ориентируемся на сам браузер.
    return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  }
  try {
    if (deviceInfo.isMobile?.()) return true
    if (deviceInfo.isTablet?.()) return true
    const type = deviceInfo.type
    return type === 'mobile' || type === 'tablet'
  } catch {
    return false
  }
}

/** Включает полноэкранный режим. Возвращает `true`, если запрос отправлен. */
export async function requestFullscreen(): Promise<boolean> {
  const session = await getSdkSession()
  const sdkFullscreen = session.ysdk?.screen?.fullscreen
  if (sdkFullscreen?.request) {
    try {
      await sdkFullscreen.request()
      return true
    } catch (error) {
      console.info('[fullscreen] SDK не смог включить полноэкранный режим:', describe(error))
    }
  }

  // Запасной вариант: стандартный API браузера (локальный запуск).
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
      return true
    }
  } catch (error) {
    console.info('[fullscreen] Браузер отклонил полноэкранный режим:', describe(error))
  }
  return false
}

/** Выключает полноэкранный режим. */
export async function exitFullscreen(): Promise<void> {
  const session = await getSdkSession()
  try {
    if (session.ysdk?.screen?.fullscreen?.exit) {
      await session.ysdk.screen.fullscreen.exit()
      return
    }
    if (document.fullscreenElement) await document.exitFullscreen()
  } catch (error) {
    console.info('[fullscreen] Не удалось выйти из полноэкранного режима:', describe(error))
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Переключает полноэкранный режим (используется в отладочном помощнике). */
export async function toggleFullscreen(): Promise<void> {
  if (getFullscreenStatus() === 'on') {
    await exitFullscreen()
    return
  }
  await requestFullscreen()
}

/**
 * Включает полноэкранный режим на первом касании на мобильных устройствах.
 * Слушатель снимается после первой попытки — повторных запросов не будет.
 */
export function initMobileFullscreen(): void {
  if (typeof window === 'undefined') return

  const onFirstInteraction = (): void => {
    window.removeEventListener('pointerdown', onFirstInteraction)
    window.removeEventListener('touchstart', onFirstInteraction)
    void enterIfNeeded()
  }

  window.addEventListener('pointerdown', onFirstInteraction, { once: true, passive: true })
  window.addEventListener('touchstart', onFirstInteraction, { once: true, passive: true })
}

async function enterIfNeeded(): Promise<void> {
  if (!(await isMobileDevice())) return
  if (getFullscreenStatus() === 'on') return
  await requestFullscreen()
}
