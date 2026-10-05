/**
 * Единая точка приостановки и возобновления игры.
 *
 * Источники паузы (причины) могут накладываться друг на друга: например, игрок
 * свернул вкладку (`hidden`) в момент показа рекламы (`ad`). Чтобы не потерять
 * состояние, причины хранятся в множестве, а события `pause` / `resume`
 * возникают только на переходах «работает → пауза» и «пауза → работает».
 *
 * Это же правило защищает от двойного начисления ресурсов при возврате из рекламы
 * или переключении вкладок: подписчики получают ровно одно событие на переход.
 * Требования платформы: п. 1.3, 1.19.3, 1.19.4, 4.7.
 */

export type PauseReason =
  /** Вкладка или окно скрыты (`visibilitychange`, `pagehide`). */
  | 'hidden'
  /** Окно потеряло фокус (`blur`). */
  | 'focus'
  /** Платформа попросила паузу: `game_api_pause`, окно покупки. */
  | 'sdk'
  /** Показ рекламы: игра и звук обязаны остановиться (п. 4.7 требований). */
  | 'ad'
  /** Пауза, инициированная игровым интерфейсом (меню, модальное окно). */
  | 'ui'
  /** Игра ещё не готова либо потеряла данные для продолжения. */
  | 'system'

export type PausePayload = { reason: PauseReason }

type PauseListener = (payload: PausePayload) => void

const pauseReasons = new Set<PauseReason>()
const pauseListeners = new Set<PauseListener>()
const resumeListeners = new Set<PauseListener>()

let initialized = false

/** Игра приостановлена хотя бы по одной причине. */
export function isGamePaused(): boolean {
  return pauseReasons.size > 0
}

export function getPauseReasons(): PauseReason[] {
  return [...pauseReasons]
}

/**
 * Приостанавливает игру. Событие `pause` отправляется только при переходе
 * из активного состояния в паузу.
 */
export function pauseGame(reason: PauseReason): void {
  if (pauseReasons.has(reason)) return
  const wasRunning = pauseReasons.size === 0
  pauseReasons.add(reason)
  if (!wasRunning) return

  for (const listener of pauseListeners) {
    listener({ reason })
  }
}

/**
 * Снимает конкретную причину паузы. Событие `resume` отправляется только
 * когда не осталось ни одной причины.
 */
export function resumeGame(reason: PauseReason): void {
  if (!pauseReasons.has(reason)) return
  pauseReasons.delete(reason)
  if (pauseReasons.size > 0) return

  for (const listener of resumeListeners) {
    listener({ reason })
  }
}

/** Подписка на переход игры в паузу. Возвращает функцию отписки. */
export function onGamePause(listener: PauseListener): () => void {
  pauseListeners.add(listener)
  return () => pauseListeners.delete(listener)
}

/** Подписка на возобновление игры. Возвращает функцию отписки. */
export function onGameResume(listener: PauseListener): () => void {
  resumeListeners.add(listener)
  return () => resumeListeners.delete(listener)
}

/**
 * Подключает браузерные события, влияющие на игровой цикл.
 * Вызывается один раз при старте приложения и не зависит от SDK.
 */
export function initGameLifecycle(): void {
  if (initialized) return
  initialized = true

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pauseGame('hidden')
      } else {
        resumeGame('hidden')
      }
    })
  }

  if (typeof window !== 'undefined') {
    // Страница уходит в кэш/закрывается — фиксируем паузу до восстановления.
    window.addEventListener('pagehide', () => pauseGame('hidden'))
    window.addEventListener('pageshow', () => resumeGame('hidden'))

    window.addEventListener('blur', () => pauseGame('focus'))
    window.addEventListener('focus', () => resumeGame('focus'))

    // Игрок вернулся на вкладку, но документ всё ещё не в фокусе —
    // не снимаем паузу «hidden», пока страница действительно не станет видимой.
    window.addEventListener('orientationchange', () => {
      if (document.hidden) pauseGame('hidden')
    })
  }
}
