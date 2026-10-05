/**
 * Локальное хранилище прогресса (IndexedDB) — остаётся основным источником
 * данных. Облако Яндекс Игр работает поверх него и никогда его не отменяет.
 *
 * Кроме текущего сохранения хранится резервный слот `backup`: в него попадает
 * версия, проигравшая разрешение конфликта локального и облачного прогресса,
 * чтобы старые сохранения не терялись.
 */

import { normalizeSave, type PersistedGame } from './saveSchema'

const databaseName = 'evolution-isles'
const storeName = 'game-state'
const databaseVersion = 1
const stateKey = 'current'
const backupKey = 'backup'

/** IndexedDB может «зависнуть» (известная проблема Safari) — ограничиваем ожидание. */
const operationTimeoutMs = 4000

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен в этом окружении'))
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(databaseName, databaseVersion)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName)
      }
    }
    request.onsuccess = () => {
      const database = request.result
      // Другая вкладка обновила схему — закрываем соединение без потери данных.
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB заблокирован другой вкладкой'))
  })

  // Неудачную попытку не кэшируем — следующая может пройти.
  void databasePromise.catch(() => {
    databasePromise = null
  })

  return databasePromise
}

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Операция «${label}» не завершилась за ${operationTimeoutMs} мс`))
    }, operationTimeoutMs)

    operation.then(
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

async function readKey(key: string): Promise<unknown> {
  const database = await openDatabase()
  return withTimeout(
    new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error ?? new Error(`Ошибка чтения «${key}»`))
    }),
    `чтение ${key}`,
  )
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const database = await openDatabase()
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      const request = database.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error(`Ошибка записи «${key}»`))
    }),
    `запись ${key}`,
  )
}

/**
 * Читает и нормализует текущее сохранение.
 * Возвращает `null`, если записи нет или данные не похожи на сохранение игры.
 */
export async function loadGame(): Promise<PersistedGame | null> {
  return normalizeSave(await readKey(stateKey))
}

export async function saveGame(save: PersistedGame): Promise<void> {
  await writeKey(stateKey, save)
}

/** Резервная копия: сюда складывается версия, проигравшая слияние с облаком. */
export async function saveBackupSave(save: PersistedGame): Promise<void> {
  await writeKey(backupKey, save)
}

export async function loadBackupSave(): Promise<PersistedGame | null> {
  return normalizeSave(await readKey(backupKey))
}

/** Доступно ли локальное хранилище (используется в диагностике и тестах). */
export async function isSaveStorageAvailable(): Promise<boolean> {
  try {
    await openDatabase()
    return true
  } catch {
    return false
  }
}
