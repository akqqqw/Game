import { useSyncExternalStore } from 'react'
import { getCloudStatus, onCloudStatusChange, type CloudSyncStatus } from './cloudSave'
import { getSdkSession, getSdkSessionSync, onSdkSessionChange, type SdkSession } from './yandexSdk'

/**
 * Подписка на внешние источники состояния (сессия SDK и статус облака)
 * через `useSyncExternalStore`: без промежуточного состояния в React.
 */

function subscribeToSession(onStoreChange: () => void): () => void {
  const unsubscribe = onSdkSessionChange(onStoreChange)
  // Инициализация идемпотентна: если она уже запущена, промис вернётся сразу.
  void getSdkSession()
  return unsubscribe
}

function getSessionSnapshot(): SdkSession | null {
  return getSdkSessionSync()
}

function subscribeToCloudStatus(onStoreChange: () => void): () => void {
  return onCloudStatusChange(onStoreChange)
}

function getCloudStatusSnapshot(): CloudSyncStatus {
  return getCloudStatus()
}

/** Текущее состояние платформенной сессии для интерфейса. */
export function useSdkSession(): SdkSession | null {
  return useSyncExternalStore(subscribeToSession, getSessionSnapshot, getSessionSnapshot)
}

/** Статус синхронизации с облаком для индикатора в интерфейсе. */
export function useCloudStatus(): CloudSyncStatus {
  return useSyncExternalStore(subscribeToCloudStatus, getCloudStatusSnapshot, getCloudStatusSnapshot)
}
