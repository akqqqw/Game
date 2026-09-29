/**
 * Пассивный доход — единственная точка начисления энергии «за время».
 *
 * Почему так: раньше энергия начислялась по тику `setInterval` (по +1 секунде),
 * из-за чего при сворачивании вкладки браузер троттлил таймеры, а офлайн-доход
 * считался отдельно при загрузке сохранения. Вместе это давало рассинхрон и риск
 * двойного начисления при переключении вкладок и возврате из рекламы.
 *
 * Теперь правило одно: доход начисляется за фактически прошедшее время, ровно
 * один раз. Таймер лишь «подталкивает» начисление, а сумма всегда вычисляется
 * как разница между текущим моментом и моментом последнего начисления:
 *  - пока игра не на паузе — раз в секунду начисляется прошедшая секунда;
 *  - при паузе (реклама, свёрнутая вкладка, меню) таймер останавливается;
 *  - при возобновлении начисляется всё «пропущенное» время одним разом, с тем же
 *    ограничением, что и офлайн-доход (см. `balance.offline`).
 *
 * Требования платформы: п. 1.3, 1.9, 1.14, 4.4, 4.7.
 */

import { onGamePause, onGameResume } from '../platform/gameLifecycle'
import { offlineLimitSeconds } from './balance'
import { useGameStore } from './gameStore'

/**
 * Максимум времени, за которое начисляется доход одним разом.
 * Совпадает с офлайн-лимитом из баланса: правила начисления одни и те же.
 */
export const MAX_ACCRUAL_SECONDS = offlineLimitSeconds()

/** Период «подталкивания» начисления. */
export const ACCRUAL_TICK_MS = 1000

let running = false
let lastAccrualAt = 0
let timer: number | null = null
let lifecycleBound = false
/** Дневной счётчик начислений — только для диагностики в консоли. */
let accrualsCount = 0

function clearTimer(): void {
  if (timer === null) return
  window.clearInterval(timer)
  timer = null
}

/**
 * Начисляет доход за время, прошедшее с предыдущего начисления.
 * Дробный «остаток» меньше секунды сохраняется — энергия всегда целая,
 * а время не теряется.
 */
function accrue(now: number): void {
  if (lastAccrualAt === 0) {
    lastAccrualAt = now
    return
  }

  const elapsedMs = now - lastAccrualAt
  if (elapsedMs < 1000) return

  const cappedMs = Math.min(elapsedMs, MAX_ACCRUAL_SECONDS * 1000)
  const seconds = Math.floor(cappedMs / 1000)

  if (seconds > 0) {
    useGameStore.getState().accruePassiveEnergy(seconds)
    accrualsCount += 1
  }

  // Если время «обрезано» лимитом — сдвигаем точку отсчёта к текущему моменту,
  // иначе игрок накапливал бы долг за пределами лимита.
  lastAccrualAt = elapsedMs > cappedMs ? now : lastAccrualAt + seconds * 1000
}

/** Запускает начисление пассивного дохода (идемпотентно). */
export function startPassiveIncome(): void {
  if (running) return
  running = true
  lastAccrualAt = Date.now()

  timer = window.setInterval(() => accrue(Date.now()), ACCRUAL_TICK_MS)

  if (!lifecycleBound) {
    lifecycleBound = true
    // Пауза: сначала фиксируем доход до текущего момента, потом останавливаем таймер.
    onGamePause(() => {
      if (running) accrue(Date.now())
      clearTimer()
    })
    // Возобновление: начисляем «пропущенное» время (ограничение — офлайн-лимит) и
    // возвращаем таймер. Двойного начисления нет: точка отсчёта уже сдвинута.
    onGameResume(() => {
      if (!running) return
      accrue(Date.now())
      clearTimer()
      timer = window.setInterval(() => accrue(Date.now()), ACCRUAL_TICK_MS)
    })
  }
}

/** Останавливает начисление (используется при размонтировании и в тестах). */
export function stopPassiveIncome(): void {
  if (!running) {
    clearTimer()
    return
  }
  running = false
  accrue(Date.now())
  clearTimer()
}

/** Служебная информация для отладки. */
export function getPassiveIncomeState(): { running: boolean; lastAccrualAt: number; accruals: number } {
  return { running, lastAccrualAt, accruals: accrualsCount }
}
