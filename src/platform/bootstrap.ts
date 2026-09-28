/**
 * Точка входа платформенного слоя.
 *
 * Вызывается один раз до рендера приложения и намеренно не возвращает промис:
 * инициализация SDK идёт в фоне и ни при каких условиях не блокирует запуск игры.
 */

import { installAdsDebugHelper } from './ads'
import { initAudio } from './audio'
import { initGameLifecycle } from './gameLifecycle'
import { getSdkSession } from './yandexSdk'

let started = false

export function bootstrapPlatform(): void {
  if (started) return
  started = true

  initGameLifecycle()
  // Звук: модуль сам останавливает звучание при паузе и рекламе (п. 1.3, 4.7).
  initAudio()
  // Рекламный модуль выключен по умолчанию; в dev доступны команды для проверки.
  if (import.meta.env.DEV) installAdsDebugHelper()

  // Ошибка внутри уже обработана: промис всегда резолвится локальной сессией.
  void getSdkSession().then((session) => {
    if (session.status === 'unavailable') {
      console.info('[platform] Локальный режим: облачные сохранения и реклама недоступны')
    }
  })
}
