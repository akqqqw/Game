import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSave } from '../helpers/fakeSdk'
import { installFakeSdk } from '../helpers/fakeSdk'
import { normalizeSave } from '../../src/game/saveSchema'

const CLOUD_KEY = 'evolution-isles-save'

/** Загружает свежий модуль облака: так сбрасывается его внутреннее состояние. */
async function loadCloudModule() {
  vi.resetModules()
  return import('../../src/platform/cloudSave')
}

async function startSession() {
  const { getSdkSession } = await import('../../src/platform/yandexSdk')
  return getSdkSession()
}

beforeEach(() => {
  delete window.YaGames
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('чтение облачного сохранения', () => {
  it('возвращает прогресс авторизованного игрока', async () => {
    const cloud = installFakeSdk({ authorized: true, cloud: { [CLOUD_KEY]: makeSave({ energy: 777 }) } })
    void cloud
    const module = await loadCloudModule()
    await startSession()

    const save = await module.readCloudSave()

    expect(save?.energy).toBe(777)
  })

  it('не обращается к облаку для гостя', async () => {
    const cloud = installFakeSdk({ authorized: false, cloud: { [CLOUD_KEY]: makeSave({ energy: 777 }) } })
    const module = await loadCloudModule()
    await startSession()

    expect(await module.readCloudSave()).toBeNull()
    expect(cloud.getPlayerCalls()).toBe(1)
  })

  it('возвращает null, если данных нет или они повреждены', async () => {
    installFakeSdk({ authorized: true, cloud: { [CLOUD_KEY]: { something: 'else' } } })
    const module = await loadCloudModule()
    await startSession()

    expect(await module.readCloudSave()).toBeNull()
  })

  it('переживает ошибку чтения', async () => {
    const cloud = installFakeSdk({ authorized: true, cloud: { [CLOUD_KEY]: makeSave() } })
    cloud.failReads(true)
    const module = await loadCloudModule()
    await startSession()

    await expect(module.readCloudSave()).resolves.toBeNull()
  })
})

describe('запись в облако', () => {
  it('не пишет в облако без авторизации', async () => {
    const cloud = installFakeSdk({ authorized: false })
    const module = await loadCloudModule()
    await startSession()

    module.queueCloudSave(normalizeSave(makeSave())!)
    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)

    expect(cloud.writes).toHaveLength(0)
    expect(module.getCloudStatus()).toBe('unavailable')
  })

  it('отправляет прогресс с задержкой и без флага flush', async () => {
    const cloud = installFakeSdk({ authorized: true })
    const module = await loadCloudModule()
    await startSession()

    module.queueCloudSave(normalizeSave(makeSave({ energy: 321 }))!)
    expect(cloud.writes).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)

    expect(cloud.writes).toHaveLength(1)
    expect(cloud.writes[0].flush).toBe(false)
    expect((cloud.writes[0].save[CLOUD_KEY] as { energy: number }).energy).toBe(321)
    expect(module.getCloudStatus()).toBe('synced')
  })

  it('склеивает частые изменения в одну отправку', async () => {
    const cloud = installFakeSdk({ authorized: true })
    const module = await loadCloudModule()
    await startSession()

    for (let index = 0; index < 20; index += 1) {
      module.queueCloudSave(normalizeSave(makeSave({ energy: index }))!)
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)

    expect(cloud.writes).toHaveLength(1)
    expect((cloud.writes[0].save[CLOUD_KEY] as { energy: number }).energy).toBe(19)
  })

  it('не отправляет одно и то же сохранение повторно', async () => {
    const cloud = installFakeSdk({ authorized: true })
    const module = await loadCloudModule()
    await startSession()
    const save = normalizeSave(makeSave({ energy: 50 }))!

    module.queueCloudSave(save)
    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)
    module.queueCloudSave(save)
    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)

    expect(cloud.writes).toHaveLength(1)
  })

  it('отправляет последнее сохранение немедленно при уходе со страницы', async () => {
    const cloud = installFakeSdk({ authorized: true })
    const module = await loadCloudModule()
    await startSession()

    module.queueCloudSave(normalizeSave(makeSave({ energy: 9 }))!)
    await module.flushCloudSave()

    expect(cloud.writes).toHaveLength(1)
    expect(cloud.writes[0].flush).toBe(true)
  })

  it('не отправляет данные без сети и повторяет попытку после восстановления', async () => {
    const cloud = installFakeSdk({ authorized: true })
    const module = await loadCloudModule()
    await startSession()

    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    module.queueCloudSave(normalizeSave(makeSave({ energy: 15 }))!)
    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)

    expect(cloud.writes).toHaveLength(0)
    expect(module.getCloudStatus()).toBe('offline')

    online.mockReturnValue(true)
    await module.flushCloudSave()

    expect(cloud.writes).toHaveLength(1)
    expect(module.getCloudStatus()).toBe('synced')
  })

  it('переживает ошибку отправки и планирует повтор', async () => {
    const cloud = installFakeSdk({ authorized: true })
    cloud.failWrites(true)
    const module = await loadCloudModule()
    await startSession()

    module.queueCloudSave(normalizeSave(makeSave({ energy: 42 }))!)
    await vi.advanceTimersByTimeAsync(module.CLOUD_DEBOUNCE_MS + 100)

    expect(module.getCloudStatus()).toBe('error')

    cloud.failWrites(false)
    await vi.advanceTimersByTimeAsync(module.CLOUD_RETRY_MS + 100)

    expect(cloud.writes).toHaveLength(1)
    expect(module.getCloudStatus()).toBe('synced')
  })
})
