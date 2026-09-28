import { useCallback, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import { requestAuthorization } from '../platform/auth'
import { useCloudStatus, useSdkSession } from '../platform/useSdkSession'
import './CloudBar.css'

const statusLabels: Record<string, string> = {
  idle: 'Облако подключено',
  pending: 'Сохраняем в облако…',
  syncing: 'Отправляем в облако…',
  synced: 'Сохранено в облаке',
  offline: 'Нет сети — сохраним, когда связь вернётся',
  error: 'Не удалось сохранить в облако — повторим позже',
  unavailable: 'Облако недоступно',
}

/**
 * Строка состояния облачных сохранений.
 *
 * Показывается только когда SDK Яндекс Игр доступен. Для неавторизованного
 * игрока предлагает вход — по осознанному нажатию кнопки и с объяснением
 * выгоды (п. 1.2.1 требований платформы). Гостевая игра при этом не ограничена.
 */
export function CloudBar() {
  const session = useSdkSession()
  const cloudStatus = useCloudStatus()
  const cloudNotice = useGameStore((state) => state.cloudNotice)
  const dismissCloudNotice = useGameStore((state) => state.dismissCloudNotice)
  const [loginPending, setLoginPending] = useState(false)

  const handleLogin = useCallback(async () => {
    setLoginPending(true)
    try {
      await requestAuthorization()
      // Синхронизация после авторизации запускается подпиской на сессию в сторе.
    } finally {
      setLoginPending(false)
    }
  }, [])

  if (!session || session.status !== 'ready') return null

  return (
    <div className="cloud-stack">
      {cloudNotice && (
        <div className="cloud-notice" role="status">
          <span>☁</span>
          <p>{cloudNotice}</p>
          <button type="button" aria-label="Закрыть уведомление" onClick={dismissCloudNotice}>
            ×
          </button>
        </div>
      )}

      {session.isAuthorized ? (
        <p className={`cloud-bar cloud-bar-${cloudStatus}`}>
          <span aria-hidden="true">☁</span>
          {statusLabels[cloudStatus] ?? statusLabels.idle}
        </p>
      ) : (
        <div className="cloud-bar cloud-bar-guest">
          <span aria-hidden="true">☁</span>
          <p>Прогресс хранится в этом браузере. Войдите в Яндекс, чтобы продолжить игру на другом устройстве.</p>
          <button type="button" className="cloud-login" onClick={handleLogin} disabled={loginPending}>
            {loginPending ? 'Подключаем…' : 'Войти в Яндекс'}
          </button>
        </div>
      )}
    </div>
  )
}
