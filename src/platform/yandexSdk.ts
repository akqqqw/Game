/**
 * Интеграция с JS SDK Яндекс Игр.
 *
 * Принципы:
 *  1. Инициализация никогда не блокирует запуск игры. Если SDK недоступен
 *     (локальная разработка, нет сети, скрипт не отдался) — игра продолжает
 *     работать в локальном режиме, все вызовы SDK становятся безопасными заглушками.
 *  2. Скрипт подключается динамически по относительному пути `/sdk.js` —
 *     это рекомендованный платформой способ (`base` сборки не влияет на путь).
 *  3. `LoadingAPI.ready()` вызывается ровно один раз и только после того, как
 *     игрок реально может играть (см. `notifyGameReady`).
 *  4. `GameplayAPI.start()/stop()` синхронизированы с единым состоянием паузы.
 *
 * Документация: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
 */

import { isGamePaused, onGamePause, onGameResume, pauseGame, resumeGame } from './gameLifecycle'
import { SDK_PAUSE_EVENT, SDK_RESUME_EVENT, type YandexPlayer, type YandexSdk } from './sdkTypes'

const SDK_SCRIPT_ID = 'yandex-games-sdk'
/** Относительный путь: работает и в архиве на сервере Яндекса, и локально. */
const SDK_SCRIPT_URL = `${import.meta.env.BASE_URL}sdk.js`

/** Сколько ждём загрузку самого скрипта `/sdk.js`. */
const SCRIPT_LOAD_TIMEOUT_MS = 8000
/** Сколько ждём появление глобального объекта `YaGames` после загрузки скрипта. */
const GLOBAL_WAIT_TIMEOUT_MS = 5000
/** Сколько ждём `YaGames.init()` (метод может обращаться к серверу платформы). */
const SDK_INIT_TIMEOUT_MS = 10000
/**
 * Сколько «грации» даём SDK после готовности игры. Экран загрузки не должен
 * ждать SDK: если платформа отвечает медленно, игру показываем, а `ready()`
 * отправим, как только сессия появится.
 */
const GAME_READY_SDK_GRACE_MS = 2500

export type SdkStatus = 'ready' | 'unavailable'

export type SdkSession = {
  status: SdkStatus
  /** `yandex` — платформа ответила; `none` — локальный режим. */
  source: 'yandex' | 'none'
  ysdk: YandexSdk | null
  player: YandexPlayer | null
  isAuthorized: boolean
  /** Язык интерфейса, который сообщила платформа (`ysdk.environment.i18n.lang`). */
  lang: string
  /** Причина недоступности SDK — для отладки, не показывается игроку. */
  reason: string | null
}

let sessionPromise: Promise<SdkSession> | null = null
let currentSession: SdkSession | null = null
let gameReadyRequested = false
let gameplayActive = false
let sdkListenersBound = false
let markupBound = false

const sessionListeners = new Set<(session: SdkSession) => void>()

/** Подписка на изменения сессии (появление SDK, результат авторизации). */
export function onSdkSessionChange(listener: (session: SdkSession) => void): () => void {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

function publishSession(session: SdkSession): SdkSession {
  currentSession = session
  for (const listener of sessionListeners) listener(session)
  return session
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Таймаут операции «${label}» (${timeoutMs} мс)`))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function createScriptElement(): { script: HTMLScriptElement; isNew: boolean } {
  const existing = document.getElementById(SDK_SCRIPT_ID)
  if (existing instanceof HTMLScriptElement) return { script: existing, isNew: false }

  const script = document.createElement('script')
  script.id = SDK_SCRIPT_ID
  script.src = SDK_SCRIPT_URL
  script.async = true
  document.head.append(script)
  return { script, isNew: true }
}

async function waitForGlobal(): Promise<void> {
  const deadline = Date.now() + GLOBAL_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (typeof window.YaGames?.init === 'function') return
    await delay(50)
  }
  throw new Error('Объект YaGames не появился после загрузки /sdk.js')
}

async function ensureSdkScript(): Promise<void> {
  if (typeof window.YaGames?.init === 'function') return

  const { script, isNew } = createScriptElement()
  if (!isNew) {
    // Тег уже был в документе — ждём только появления глобального объекта.
    await waitForGlobal()
    return
  }

  await new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Не удалось загрузить ${SDK_SCRIPT_URL}`))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Скрипт ${SDK_SCRIPT_URL} не загрузился за ${SCRIPT_LOAD_TIMEOUT_MS} мс`))
    }, SCRIPT_LOAD_TIMEOUT_MS)
    function cleanup() {
      window.clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
  })

  await waitForGlobal()
}

function safeIsAuthorized(player: YandexPlayer | null): boolean {
  if (!player) return false
  try {
    return player.isAuthorized()
  } catch {
    return false
  }
}

async function loadPlayer(ysdk: YandexSdk): Promise<YandexPlayer | null> {
  try {
    // `scopes: false` — не запрашиваем персональные данные, авторизация
    // предлагается игроку отдельно (п. 1.2.1 требований).
    return await ysdk.getPlayer({ scopes: false })
  } catch (error) {
    console.info('[yandex] Игрок недоступен, продолжаем в гостевом режиме:', describeError(error))
    return null
  }
}

function bindSdkEvents(ysdk: YandexSdk): void {
  if (sdkListenersBound) return
  sdkListenersBound = true

  try {
    ysdk.on?.(SDK_PAUSE_EVENT, () => pauseGame('sdk'))
    ysdk.on?.(SDK_RESUME_EVENT, () => resumeGame('sdk'))
  } catch (error) {
    console.info('[yandex] Не удалось подписаться на события паузы:', describeError(error))
  }
}

async function bootstrapSdk(): Promise<SdkSession> {
  try {
    await ensureSdkScript()
    const yaGames = window.YaGames
    if (typeof yaGames?.init !== 'function') {
      return unavailableSession('Объект YaGames недоступен')
    }

    const ysdk = await withTimeout(yaGames.init(), SDK_INIT_TIMEOUT_MS, 'YaGames.init()')
    const player = await loadPlayer(ysdk)
    bindSdkEvents(ysdk)
    bindGameplayMarkup()

    console.info('[yandex] SDK Яндекс Игр инициализирован, язык:', ysdk.environment?.i18n?.lang ?? 'неизвестен')

    return {
      status: 'ready',
      source: 'yandex',
      ysdk,
      player,
      isAuthorized: safeIsAuthorized(player),
      lang: ysdk.environment?.i18n?.lang ?? 'ru',
      reason: null,
    }
  } catch (error) {
    console.info('[yandex] SDK недоступен, игра запущена в локальном режиме:', describeError(error))
    return unavailableSession(describeError(error))
  }
}

function unavailableSession(reason: string): SdkSession {
  return {
    status: 'unavailable',
    source: 'none',
    ysdk: null,
    player: null,
    isAuthorized: false,
    lang: 'ru',
    reason,
  }
}

/** Возвращает сессию SDK. Промис не отклоняется: недоступность SDK — штатный сценарий. */
export function getSdkSession(): Promise<SdkSession> {
  if (!sessionPromise) {
    sessionPromise = bootstrapSdk().then((result) => {
      const session = publishSession(result)
      syncGameplayState()
      return session
    })
  }
  return sessionPromise
}

/**
 * Перечитывает объект игрока (например, после авторизации) и сообщает,
 * авторизован ли игрок сейчас.
 */
export async function refreshSdkPlayer(): Promise<boolean> {
  const session = currentSession ?? (await getSdkSession())
  if (!session.ysdk) return false

  const player = await loadPlayer(session.ysdk)
  const updated: SdkSession = {
    ...session,
    player,
    isAuthorized: safeIsAuthorized(player),
  }
  publishSession(updated)
  return updated.isAuthorized
}

/** Уже полученная сессия (или `null`, если инициализация ещё идёт). */
export function getSdkSessionSync(): SdkSession | null {
  return currentSession
}

export function isSdkReady(): boolean {
  return currentSession?.status === 'ready'
}

/**
 * Синхронизирует разметку геймплея с состоянием игры.
 * `start()` отправляется, когда игра готова и не находится на паузе.
 */
function syncGameplayState(): void {
  const api = currentSession?.ysdk?.features?.GameplayAPI
  if (!api) return

  const shouldBeActive = gameReadyRequested && !isGamePaused()
  if (shouldBeActive === gameplayActive) return

  try {
    if (shouldBeActive) {
      api.start()
    } else {
      api.stop()
    }
    gameplayActive = shouldBeActive
  } catch (error) {
    console.info('[yandex] Ошибка разметки геймплея:', describeError(error))
  }
}

/**
 * Сообщает платформе, что игра готова к взаимодействию (Game Ready).
 * Вызывать строго после скрытия экрана загрузки — метод идемпотентен.
 */
export async function notifyGameReady(): Promise<void> {
  if (gameReadyRequested) return
  gameReadyRequested = true

  const session = await Promise.race([
    getSdkSession(),
    delay(GAME_READY_SDK_GRACE_MS).then(() => null),
  ])

  const resolved = session ?? (await getSdkSession())
  if (!resolved || resolved.status !== 'ready') return

  try {
    resolved.ysdk?.features?.LoadingAPI?.ready()
    gameplayActive = false
    syncGameplayState()
  } catch (error) {
    console.info('[yandex] Не удалось вызвать LoadingAPI.ready():', describeError(error))
  }
}

/**
 * Связывает разметку геймплея (`GameplayAPI.start/stop`) с единым состоянием
 * паузы. Подписка создаётся один раз при успешной инициализации SDK.
 */
function bindGameplayMarkup(): void {
  if (markupBound) return
  markupBound = true
  onGamePause(() => syncGameplayState())
  onGameResume(() => syncGameplayState())
}

/** Язык интерфейса от платформы (или `ru` локально). */
export function getSdkLanguage(): string {
  return currentSession?.lang ?? 'ru'
}
