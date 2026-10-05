/**
 * Точки показа рекламы.
 *
 * Это единственное место, где описано, в какие моменты игра может показать
 * полноэкранную рекламу. Игровая логика о рекламе не знает: экраны вызывают
 * `requestAdPoint('...')` в логической паузе, а решение о самом показе
 * принимает рекламный модуль (`ads.ts`) с учётом пейсинга. Если убрать эти
 * вызовы или выключить рекламу, игра работает точно так же.
 *
 * Правила (п. 4.4 требований платформы):
 *  - точка показа — только что-то завершённое: открылось яйцо, собралось
 *    существо, построилось жилище, купилось улучшение, сменился экран;
 *  - клики по дереву, наведение, прокрутка точками не являются — реклама
 *    никогда не показывается по клику;
 *  - показ откладывается на короткую паузу, чтобы игрок успел увидеть
 *    результат своего действия (баннер вылупления, уведомление о слиянии);
 *  - одновременно запланирован максимум один показ;
 *  - при выключенной рекламе, отсутствии SDK или пейсинге не планируется
 *    ничего — лишних таймеров и вызовов не остаётся.
 */

import { canShowInterstitial, isAdsEnabled, showInterstitial, type AdOutcome } from './ads'

export type AdPointId =
  /** Игрок открыл яйцо и получил существо. */
  | 'egg-hatched'
  /** Слияние завершилось и появилось новое существо. */
  | 'fusion-done'
  /** Куплено улучшение (корни силы или солнечный источник). */
  | 'upgrade-bought'
  /** Жилище построено или повышено в уровне. */
  | 'habitat-upgraded'
  /** Игрок перешёл на другой экран игры. */
  | 'screen-change'

/**
 * Пауза перед показом: интерфейс должен успеть показать результат действия.
 * Слишком большая задержка выглядит как «зависание», слишком маленькая —
 * обрывает анимацию награды.
 */
export const AD_POINT_DELAY_MS = 700

const pointIds: AdPointId[] = [
  'egg-hatched',
  'fusion-done',
  'upgrade-bought',
  'habitat-upgraded',
  'screen-change',
]

/** Задержка по умолчанию; меняется через `configureAdPoints` (тесты, отладка). */
let delayMs = AD_POINT_DELAY_MS
let pendingTimer: number | null = null
let lastPoint: AdPointId | null = null
let lastPointAt = 0
let requestsCount = 0
let showsCount = 0
let lastOutcome: AdOutcome | null = null

/**
 * Просит показать полноэкранную рекламу в логической паузе.
 *
 * Возвращает `true`, если показ запланирован. Само решение — за рекламным
 * модулем: он может отклонить показ из-за кулдауна или малого числа действий.
 * Функция никогда не бросает исключений и не блокирует вызывающий код.
 */
export function requestAdPoint(
  point: AdPointId,
  options: { delayMs?: number } = {},
): boolean {
  // Один показ за раз: пока предыдущий не завершён, новые не планируем.
  if (pendingTimer !== null) return false
  if (!isAdsEnabled()) return false
  // Пейсинг проверяем сразу, чтобы не держать таймер впустую.
  if (!canShowInterstitial()) return false

  const delay = options.delayMs ?? delayMs
  requestsCount += 1
  lastPoint = point
  lastPointAt = Date.now()

  pendingTimer = window.setTimeout(() => {
    pendingTimer = null
    void showInterstitial()
      .then((outcome) => {
        lastOutcome = outcome
        if (outcome === 'completed') showsCount += 1
      })
      .catch((error: unknown) => {
        // Ошибка рекламы не должна влиять на игру.
        console.info('[ads] Точка показа не сработала:', error)
      })
  }, delay)

  return true
}

/**
 * Настраивает точки показа. Задержка нужна, чтобы показать игроку результат
 * действия; в тестах её обнуляют, чтобы не ждать.
 */
export function configureAdPoints(options: { delayMs?: number }): void {
  if (options.delayMs !== undefined) delayMs = Math.max(0, options.delayMs)
}

/** Состояние точек показа — для отладки, диагностики и тестов. */
export function getAdPointsState(): {
  points: AdPointId[]
  pending: boolean
  requests: number
  shows: number
  lastPoint: AdPointId | null
  lastPointAt: number
  lastOutcome: AdOutcome | null
} {
  return {
    points: [...pointIds],
    pending: pendingTimer !== null,
    requests: requestsCount,
    shows: showsCount,
    lastPoint,
    lastPointAt,
    lastOutcome,
  }
}

/** Отменяет запланированный показ (используется при размонтировании и в тестах). */
export function cancelPendingAdPoint(): void {
  if (pendingTimer === null) return
  window.clearTimeout(pendingTimer)
  pendingTimer = null
}

/** Только для тестов: сбрасывает состояние и снимает запланированный показ. */
export function resetAdPointsForTests(): void {
  cancelPendingAdPoint()
  delayMs = AD_POINT_DELAY_MS
  lastPoint = null
  lastPointAt = 0
  requestsCount = 0
  showsCount = 0
  lastOutcome = null
}
