import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeSave } from '../../src/game/saveSchema'
import { makeSave } from '../helpers/fakeSdk'

const DATABASE_NAME = 'evolution-isles'
const STORE_NAME = 'game-state'

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** Пишет произвольные данные прямо в хранилище — имитация повреждённого сохранения. */
function writeRaw(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME)) open.result.createObjectStore(STORE_NAME)
    }
    open.onsuccess = () => {
      const database = open.result
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
      request.onsuccess = () => {
        database.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    }
    open.onerror = () => reject(open.error)
  })
}

/** Свежий модуль хранилища: сбрасывает кэш соединения между тестами. */
async function loadStorageModule() {
  vi.resetModules()
  return import('../../src/game/saveGame')
}

beforeEach(async () => {
  await deleteDatabase()
})

describe('локальное хранилище прогресса', () => {
  it('сохраняет и читает прогресс', async () => {
    const storage = await loadStorageModule()
    const save = normalizeSave(makeSave({ energy: 4242 }))!

    await storage.saveGame(save)
    const loaded = await storage.loadGame()

    expect(loaded).not.toBeNull()
    expect(loaded?.energy).toBe(4242)
    expect(loaded?.version).toBe(save.version)
    expect(loaded?.ownedCreatures).toEqual({ mossling: 2 })
  })

  it('хранит резервную копию отдельно от текущего сохранения', async () => {
    const storage = await loadStorageModule()
    const current = normalizeSave(makeSave({ energy: 500 }))!
    const backup = normalizeSave(makeSave({ energy: 111, savedAt: 10 }))!

    await storage.saveGame(current)
    await storage.saveBackupSave(backup)

    expect((await storage.loadGame())?.energy).toBe(500)
    expect((await storage.loadBackupSave())?.energy).toBe(111)
  })

  it('возвращает null, если сохранения ещё нет', async () => {
    const storage = await loadStorageModule()
    expect(await storage.loadGame()).toBeNull()
  })

  it('возвращает null вместо падения, если в хранилище мусор', async () => {
    await writeRaw('current', { achievements: ['x'], note: 'не сохранение' })
    const storage = await loadStorageModule()

    expect(await storage.loadGame()).toBeNull()
  })

  it('сообщает о доступности хранилища', async () => {
    const storage = await loadStorageModule()
    expect(await storage.isSaveStorageAvailable()).toBe(true)
  })
})
