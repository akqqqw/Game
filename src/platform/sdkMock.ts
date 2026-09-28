/**
 * Mock SDK Яндекс Игр для локальной разработки.
 *
 * Зачем: из локального окружения `/sdk.js` платформы недоступен, а проверять
 * интеграцию (Game Ready, пауза/возобновление, облачные сохранения, реклама)
 * нужно до публикации. Мок повторяет контракт реального SDK: те же методы,
 * те же колбэки, те же события `game_api_pause` / `game_api_resume`.
 *
 * Файл подключается ТОЛЬКО dev/preview-сервером Vite (см. `vite.config.ts`),
 * в production-сборку не попадает.
 */

import type { YandexAdv, YandexPlayer, YandexPlayerData, YandexSdk } from './sdkTypes'

const PLAYER_STORAGE_KEY = 'mock-yandex-player-data'
const AD_DURATION_MS = 4000

type MockEventName = 'game_api_pause' | 'game_api_resume' | string

type MockState = {
  authorized: boolean
  adInProgress: boolean
}

const state: MockState = { authorized: false, adInProgress: false }

const listeners = new Map<MockEventName, Set<() => void>>()

function debug(...args: unknown[]): void {
  console.info('[mock-sdk]', ...args)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function emit(event: MockEventName): void {
  debug('событие платформы →', event)
  for (const listener of listeners.get(event) ?? []) {
    try {
      listener()
    } catch (error) {
      console.warn('[mock-sdk] Ошибка в обработчике события', event, error)
    }
  }
}

function readPlayerData(): YandexPlayerData {
  try {
    const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as YandexPlayerData) : {}
  } catch {
    return {}
  }
}

function writePlayerData(data: YandexPlayerData): void {
  try {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('[mock-sdk] Не удалось записать данные игрока', error)
  }
}

function readMocksFromUrl(): Partial<{ isAuthorized: boolean }> {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('mocks')
    return raw ? (JSON.parse(raw) as Partial<{ isAuthorized: boolean }>) : {}
  } catch {
    return {}
  }
}

function createAdOverlay(title: string, description: string, actions: { id: string; label: string }[]): {
  overlay: HTMLDivElement
  onClick: (handler: (actionId: string) => void) => void
} {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-mock-sdk-ad', '')
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'gap:14px', 'padding:24px',
    'background:rgba(4,18,26,0.94)', 'color:#eef6df', 'text-align:center',
    'font-family:system-ui,sans-serif',
  ].join(';')

  const heading = document.createElement('strong')
  heading.textContent = title
  heading.style.cssText = 'font-size:20px;letter-spacing:0.4px'

  const caption = document.createElement('span')
  caption.textContent = description
  caption.style.cssText = 'font-size:13px;color:#9fc4b5;max-width:320px'

  overlay.append(heading, caption)

  let handler: (actionId: string) => void = () => {}
  for (const action of actions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    button.style.cssText = [
      'min-width:180px', 'padding:10px 16px', 'font:inherit', 'font-size:13px',
      'color:#0b3038', 'background:#e8cb73', 'border:0', 'border-radius:8px', 'cursor:pointer',
    ].join(';')
    button.addEventListener('click', () => handler(action.id))
    overlay.append(button)
  }

  document.body.append(overlay)

  return {
    overlay,
    onClick: (nextHandler) => {
      handler = nextHandler
    },
  }
}

function mockAdv(): YandexAdv {
  const readAdMode = (): 'normal' | 'error' | 'empty' => {
    const mode = new URLSearchParams(window.location.search).get('mockAds')
    return mode === 'error' || mode === 'empty' ? mode : 'normal'
  }

  return {
    showFullscreenAdv({ callbacks } = {}) {
      const mode = readAdMode()
      if (mode === 'error') {
        debug('интерстишл: имитация ошибки')
        callbacks?.onError?.({ code: 'mock-error', message: 'Имитация ошибки показа рекламы' })
        return
      }
      if (mode === 'empty') {
        debug('интерстишл: реклама не найдена')
        callbacks?.onClose?.(false)
        return
      }

      state.adInProgress = true
      emit('game_api_pause')
      callbacks?.onOpen?.()
      debug('интерстишл показан (мок)')

      const overlay = createAdOverlay(
        'Мок полноэкранной рекламы',
        'Здесь платформа показывает interstitial. Игра на паузе, звук отключён.',
        [{ id: 'close', label: 'Закрыть рекламу' }],
      )
      overlay.onClick(() => {
        overlay.overlay.remove()
        state.adInProgress = false
        callbacks?.onClose?.(true)
        emit('game_api_resume')
        debug('интерстишл закрыт (мок)')
      })
    },

    showRewardedVideo({ callbacks } = {}) {
      const mode = readAdMode()
      if (mode === 'error') {
        debug('rewarded: имитация ошибки')
        callbacks?.onError?.({ code: 'mock-error', message: 'Имитация ошибки rewarded-видео' })
        return
      }
      if (mode === 'empty') {
        debug('rewarded: нет рекламного контента')
        callbacks?.onError?.({ code: 'no-ads', message: 'Нет доступных рекламных материалов' })
        return
      }

      state.adInProgress = true
      emit('game_api_pause')
      callbacks?.onOpen?.()
      debug('rewarded видео показано (мок)')

      const overlay = createAdOverlay(
        'Мок рекламы за вознаграждение',
        `Награда выдаётся только после полного просмотра (мок: ${AD_DURATION_MS / 1000} с).`,
        [
          { id: 'reward', label: 'Досмотреть и получить награду' },
          { id: 'close', label: 'Закрыть без награды' },
        ],
      )

      overlay.onClick((actionId) => {
        overlay.overlay.remove()
        state.adInProgress = false
        const rewarded = actionId === 'reward'
        if (rewarded) callbacks?.onRewarded?.()
        callbacks?.onClose?.(true)
        emit('game_api_resume')
        debug(rewarded ? 'rewarded: награда засчитана' : 'rewarded: закрыто без награды')
      })
    },
  }
}

function createMockSdk(): YandexSdk {
  const mocks = readMocksFromUrl()
  if (typeof mocks.isAuthorized === 'boolean') state.authorized = mocks.isAuthorized

  const player: YandexPlayer = {
    async getData(keys?: string[]) {
      await delay(60)
      const data = readPlayerData()
      if (!keys?.length) return data
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
    },
    async setData(data: YandexPlayerData) {
      await delay(80)
      writePlayerData({ ...readPlayerData(), ...data })
    },
    isAuthorized: () => state.authorized,
    getUniqueID: () => 'mock-player-0001',
    getName: () => 'Тестовый игрок',
    getMode: () => 'lite',
  }

  const sdk: YandexSdk = {
    environment: {
      i18n: { lang: new URLSearchParams(window.location.search).get('lang') ?? 'ru', tld: 'ru' },
      app: { id: 'mock-app' },
    },
    features: {
      LoadingAPI: {
        ready() {
          debug('LoadingAPI.ready() — игра сообщила о готовности')
        },
      },
      GameplayAPI: {
        start() {
          debug('GameplayAPI.start()')
        },
        stop() {
          debug('GameplayAPI.stop()')
        },
      },
    },
    adv: mockAdv(),
    screen: {
      fullscreen: {
        status: 'off',
        async request() {
          debug('screen.fullscreen.request()')
          try {
            await document.documentElement.requestFullscreen()
          } catch {
            debug('полноэкранный режим недоступен в этом окружении')
          }
        },
        async exit() {
          debug('screen.fullscreen.exit()')
          if (document.fullscreenElement) await document.exitFullscreen()
        },
      },
    },
    auth: {
      async openAuthDialog() {
        debug('auth.openAuthDialog() — мок: игрок считается авторизованным')
        state.authorized = true
      },
    },
    async getPlayer() {
      debug('getPlayer() → игрок', state.authorized ? 'авторизован' : 'гость')
      return player
    },
    on(event, callback) {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
    },
    off(event, callback) {
      listeners.get(event)?.delete(callback)
    },
  }

  return sdk
}

/** Управление моком из консоли браузера: удобно для проверки паузы и рекламы. */
export type MockSdkControls = {
  emit: (event: MockEventName) => void
  pause: () => void
  resume: () => void
  setAuthorized: (value: boolean) => void
  resetCloudData: () => void
  isAdInProgress: () => boolean
}

declare global {
  interface Window {
    __yaMock?: MockSdkControls
  }
}

/** Устанавливает `window.YaGames` с моком и вспомогательными командами. */
export function installMockSdk(): void {
  if (window.YaGames?.init) return

  window.YaGames = {
    async init() {
      debug('YaGames.init() — инициализация мока')
      await delay(80)
      return createMockSdk()
    },
  }

  window.__yaMock = {
    emit,
    pause: () => emit('game_api_pause'),
    resume: () => emit('game_api_resume'),
    setAuthorized: (value: boolean) => {
      state.authorized = value
      debug('авторизация игрока:', value)
    },
    resetCloudData: () => {
      window.localStorage.removeItem(PLAYER_STORAGE_KEY)
      debug('облачные данные игрока очищены')
    },
    isAdInProgress: () => state.adInProgress,
  }

  debug('мок SDK установлен. Команды: window.__yaMock')
}
