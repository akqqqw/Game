import './LoadingScreen.css'

type LoadingScreenProps = {
  /** Текст статуса для игрока: описывает текущий этап загрузки. */
  status?: string
}

/**
 * Экран загрузки.
 *
 * Показывается до момента, когда игрок реально может играть, и скрывается
 * строго до вызова `LoadingAPI.ready()` — так требует Game Ready
 * (п. 1.19.2 требований платформы).
 */
export function LoadingScreen({ status = 'Пробуждаем остров…' }: LoadingScreenProps) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-orb">✦</div>
      <p className="loading-title">Острова Эволюции</p>
      <p className="loading-status">{status}</p>
      <div className="loading-bar" aria-hidden="true">
        <i />
      </div>
    </div>
  )
}
