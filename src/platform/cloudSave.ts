/**
 * Облачные сохранения Яндекс Игр (`player.getData()` / `player.setData()`).
 *
 * Правила, заложенные в модуль:
 *  - облако работает только для авторизованного игрока; гостю прогресс
 *    сохраняет IndexedDB (п. 1.2.2 требований — игра доступна без авторизации);
 *  - запись идёт с задержкой: SDK разрешает 100 запросов за 5 минут, а игровые
 *    действия происходят десятки раз в секунду;
 *  - последнее сохранение принудительно отправляется при уходе со страницы;
 *  - любая ошибка (нет сети, отказ SDK, превышен лимит) не ломает игру,
 *    а планирует повторную попытку.
 *
 * Документация: https://yandex.ru/dev/games/doc/ru/sdk/sdk-player
 */

import {
  CLOUD_SAVE_KEY,
  CLOUD_SAVE_MAX_BYTES,
  normalizeSave,
  type PersistedGame,
} from '../game/saveSchema'
import type { YandexPlayer } from './sdkTypes'
import { getSdkSession, getSdkSessionSync } from './yandexSdk'

export type CloudSyncStatus =
  /** Синхронизация ещё не требовалась. */
  | 'idle'
  /** SDK недоступен или игрок не авторизован — облако не используется. */
  | 'unavailable'
  /** Есть что отправить, отправка ещё не начиналась. */
  | 'pending'
  | 'syncing'
  | 'synced'
  /** Нет сети — ждём восстановления соединения. */
  | 'offline'
  | 'error'

/** Задержка перед отправкой после последнего изменения. */
export const CLOUD_DEBOUNCE_MS = 5_000
/** Минимальный интервал между записями (лимит SDK — 100 запросов / 5 минут). */
export const CLOUD_MIN_INTERVAL_MS = 30_000
/** Пауза перед повтором после ошибки. */
export const CLOUD_RETRY_MS = 60_000
/** Собственный предохранитель: не больше 10 записей за 5 минут. */
export const CLOUD_WINDOW_MS = 5 * 60_000
export const CLOUD_MAX_WRITES_PER_WINDOW = 10

let status: CloudSyncStatus = 'idle'
let pendingSave: PersistedGame | null = null
let lastKnownSave: PersistedGame | null = null
let lastWrittenJson: string | null = null
let writeTimestamps: number[] = []
let writeTimer: number | null = null
let lastWriteAt = 0
let autoSyncBound = false

const statusListeners = new Set<(status: CloudSyncStatus) => void>()

function setStatus(next: CloudSyncStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener(status)
}

export function getCloudStatus(): CloudSyncStatus {
  return status
}

export function onCloudStatusChange(listener: (status: CloudSyncStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function serialize(save: PersistedGame): string {
  try {
    return JSON.stringify(save)
  } catch {
    return ''
  }
}

function isPlayerAuthorized(player: YandexPlayer): boolean {
  try {
    return player.isAuthorized()
  } catch {
    return false
  }
}

/** Игрок для облачной синхронизации или `null`, если облако недоступно. */
async function getCloudPlayer(): Promise<YandexPlayer | null> {
  const session = await getSdkSession()
  const player = session.player
  if (!player || !isPlayerAuthorized(player)) return null
  return player
}

/** Быстрая синхронная проверка: есть ли смысл вообще ставить задачу на запись. */
export function isCloudSyncAvailable(): boolean {
  const session = getSdkSessionSync()
  return session?.status === 'ready' && session.isAuthorized
}

function parseCloudSave(value: unknown): PersistedGame | null {
  if (typeof value === 'string') {
    try {
      return normalizeSave(JSON.parse(value))
    } catch {
      return null
    }
  }
  return normalizeSave(value)
}

/**
 * Читает облачное сохранение.
 * Возвращает `null`, если облако недоступно, данных нет или они повреждены.
 */
export async function readCloudSave(): Promise<PersistedGame | null> {
  const player = await getCloudPlayer()
  if (!player) return null

  try {
    const data = await player.getData([CLOUD_SAVE_KEY])
    const save = parseCloudSave(data?.[CLOUD_SAVE_KEY])
    if (!save) return null
    // Данные из облака считаем отправленными: не перезаписываем их тем же содержимым.
    lastWrittenJson = serialize(save)
    return save
  } catch (error) {
    console.info('[cloud] Не удалось прочитать облачное сохранение:', describeError(error))
    return null
  }
}

function clearWriteTimer(): void {
  if (writeTimer === null) return
  window.clearTimeout(writeTimer)
  writeTimer = null
}

function scheduleWrite(delay: number): void {
  clearWriteTimer()
  writeTimer = window.setTimeout(() => {
    writeTimer = null
    void writePending(false)
  }, delay)
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** Сколько ждать, чтобы не превысить собственный лимит записей. */
function nextBudgetDelay(now: number): number {
  writeTimestamps = writeTimestamps.filter((timestamp) => now - timestamp < CLOUD_WINDOW_MS)
  if (writeTimestamps.length < CLOUD_MAX_WRITES_PER_WINDOW) return 0
  const oldest = writeTimestamps[0] ?? now
  return Math.max(1000, oldest + CLOUD_WINDOW_MS - now)
}

/** Ставит сохранение в очередь на отправку в облако (вызывается на каждое действие). */
export function queueCloudSave(save: PersistedGame): void {
  lastKnownSave = save
  if (!isCloudSyncAvailable()) {
    setStatus('unavailable')
    return
  }

  const json = serialize(save)
  if (!json) return
  if (json === lastWrittenJson && !pendingSave) {
    setStatus('synced')
    return
  }

  pendingSave = save
  setStatus('pending')
  // Если запись уже запланирована, новый таймер не создаём: отправим актуальные данные.
  if (writeTimer === null) scheduleWrite(CLOUD_DEBOUNCE_MS)
}

async function writePending(flush: boolean): Promise<void> {
  const save = pendingSave ?? lastKnownSave
  if (!save) return

  const player = await getCloudPlayer()
  if (!player) {
    setStatus('unavailable')
    return
  }

  const json = serialize(save)
  if (!json) return
  if (json === lastWrittenJson) {
    pendingSave = null
    setStatus('synced')
    return
  }

  if (json.length > CLOUD_SAVE_MAX_BYTES) {
    console.warn('[cloud] Сохранение больше лимита SDK (200 КБ) — отправка отменена')
    pendingSave = null
    setStatus('error')
    return
  }

  if (!isOnline()) {
    setStatus('offline')
    scheduleWrite(CLOUD_RETRY_MS)
    return
  }

  const now = Date.now()
  const budgetDelay = nextBudgetDelay(now)
  // Принудительная отправка (уход со страницы) лимит игнорирует: она редкая.
  if (!flush && budgetDelay > 0) {
    scheduleWrite(Math.max(budgetDelay, CLOUD_MIN_INTERVAL_MS))
    return
  }

  setStatus('syncing')
  try {
    await player.setData({ [CLOUD_SAVE_KEY]: save }, flush)
    lastWrittenJson = json
    pendingSave = null
    const stamp = Date.now()
    writeTimestamps.push(stamp)
    lastWriteAt = stamp
    setStatus('synced')
  } catch (error) {
    console.info('[cloud] Не удалось сохранить прогресс в облако:', describeError(error))
    setStatus('error')
    scheduleWrite(CLOUD_RETRY_MS)
  }
}

/** Немедленная отправка (уход со страницы, сворачивание вкладки, после авторизации). */
export async function flushCloudSave(): Promise<void> {
  clearWriteTimer()
  await writePending(true)
}

/** Принудительно отправляет конкретное сохранение (например, после авторизации). */
export async function pushCloudSave(save: PersistedGame): Promise<void> {
  lastKnownSave = save
  pendingSave = save
  await flushCloudSave()
}

/** Последнее известное сохранение (для отладки и тестов). */
export function getLastKnownCloudSave(): PersistedGame | null {
  return lastKnownSave
}

export function getLastCloudWriteAt(): number {
  return lastWriteAt
}

/**
 * Подписка на события страницы, после которых сохранение должно уйти в облако
 * немедленно. Вызывается один раз после загрузки прогресса.
 */
export function initCloudAutoSync(): void {
  if (autoSyncBound) return
  autoSyncBound = true
  if (typeof window === 'undefined') return

  window.addEventListener('pagehide', () => {
    void flushCloudSave()
  })
  window.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushCloudSave()
  })
  window.addEventListener('online', () => {
    if (pendingSave) void flushCloudSave()
  })
  window.addEventListener('offline', () => {
    if (pendingSave) setStatus('offline')
  })
}
