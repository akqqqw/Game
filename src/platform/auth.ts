/**
 * Авторизация игрока на платформе.
 *
 * Требования платформы: п. 1.2.1 — авторизация запрашивается только после
 * осознанного действия игрока (кнопки в интерфейсе), п. 1.2.2 — игра полностью
 * доступна без авторизации, и прогресс при этом сохраняется (IndexedDB).
 */

import { getSdkSession, getSdkSessionSync, refreshSdkPlayer } from './yandexSdk'

export type AuthorizationResult = 'authorized' | 'declined' | 'unavailable'

/**
 * Открывает диалог авторизации Яндекс ID.
 * Вызывать только по нажатию кнопки игроком.
 */
export async function requestAuthorization(): Promise<AuthorizationResult> {
  const session = await getSdkSession()
  const ysdk = session.ysdk
  if (!ysdk?.auth?.openAuthDialog) return 'unavailable'
  if (session.isAuthorized) return 'authorized'

  try {
    await ysdk.auth.openAuthDialog()
  } catch (error) {
    console.info('[auth] Диалог авторизации закрыт:', error instanceof Error ? error.message : error)
    return 'declined'
  }

  return (await refreshSdkPlayer()) ? 'authorized' : 'declined'
}

/** Доступна ли авторизация: SDK инициализирован и игрок ещё не авторизован. */
export function isAuthorizationAvailable(): boolean {
  const session = getSdkSessionSync()
  if (!session || session.status !== 'ready' || session.isAuthorized) return false
  return Boolean(session.ysdk?.auth?.openAuthDialog)
}
