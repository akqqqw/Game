import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YaGamesGlobal, YandexPlayer, YandexSdk } from '../../src/platform/sdkTypes'

type Calls = {
  ready: number
  gameplayStart: number
  gameplayStop: number
  getPlayer: number
}

type FakeSdk = {
  calls: Calls
  yaGames: YaGamesGlobal
  emit: (event: string) => void
  setAuthorized: (value: boolean) => void
  playerData: Record<string, unknown>
}

/**
 * Подменяет `window.YaGames` на записывающий фейк, повторяющий контракт SDK.
 * Используется вместо реального `/sdk.js`, который в тестах недоступен.
 */
function installFakeSdk(options: { lang?: string; initError?: Error } = {}): FakeSdk {
  const calls: Calls = { ready: 0, gameplayStart: 0, gameplayStop: 0, getPlayer: 0 }
  const listeners = new Map<string, Set<() => void>>()
  const state = { authorized: false }
  const playerData: Record<string, unknown> = {}

  const player: YandexPlayer = {
    async getData(keys) {
      if (!keys?.length) return { ...playerData }
      return Object.fromEntries(keys.filter((key) => key in playerData).map((key) => [key, playerData[key]]))
    },
    async setData(data) {
      Object.assign(playerData, data)
    },
    isAuthorized: () => state.authorized,
  }

  const sdk: YandexSdk = {
    environment: { i18n: { lang: options.lang ?? 'ru' } },
    features: {
      LoadingAPI: { ready: () => { calls.ready += 1 } },
      GameplayAPI: {
        start: () => { calls.gameplayStart += 1 },
        stop: () => { calls.gameplayStop += 1 },
      },
    },
    async getPlayer() {
      calls.getPlayer += 1
      return player
    },
    on(event, callback) {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
    },
    off(event, callback) {
      listeners.get(event)?.delete(callback)
    },
  }

  const yaGames: YaGamesGlobal = {
    async init() {
      if (options.initError) throw options.initError
      return sdk
    },
  }

  window.YaGames = yaGames

  return {
    calls,
    yaGames,
    playerData,
    emit: (event) => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    setAuthorized: (value) => {
      state.authorized = value
    },
  }
}

/** Заставляет динамически созданный тег `<script>` сразу упасть с ошибкой. */
function failScriptLoading(): void {
  vi.spyOn(document.head, 'append').mockImplementation(((node: Node) => {
    if (node instanceof HTMLScriptElement) {
      queueMicrotask(() => node.dispatchEvent(new Event('error')))
    }
    return node
  }) as typeof document.head.append)
}

/**
 * Эмулирует загрузку `/sdk.js` платформой: как только игра вставляет тег,
 * появляется глобальный объект `YaGames` и приходит событие `load`.
 */
function loadSdkScriptWith(fake: FakeSdk): void {
  const appendNode = document.head.append.bind(document.head)
  vi.spyOn(document.head, 'append').mockImplementation(((node: Node) => {
    appendNode(node)
    if (node instanceof HTMLScriptElement) {
      window.YaGames = fake.yaGames
      queueMicrotask(() => node.dispatchEvent(new Event('load')))
    }
  }) as typeof document.head.append)
}

async function loadPlatform() {
  vi.resetModules()
  const [sdk, lifecycle] = await Promise.all([
    import('../../src/platform/yandexSdk'),
    import('../../src/platform/gameLifecycle'),
  ])
  return { sdk, lifecycle }
}

beforeEach(() => {
  delete window.YaGames
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('инициализация SDK Яндекс Игр', () => {
  it('подключает /sdk.js относительным путём и дожидается объекта YaGames', async () => {
    delete window.YaGames
    const fake = installFakeSdk({ lang: 'en' })
    delete window.YaGames
    loadSdkScriptWith(fake)

    const { sdk } = await loadPlatform()
    const session = await sdk.getSdkSession()

    const script = document.getElementById('yandex-games-sdk')
    expect(script).toBeInstanceOf(HTMLScriptElement)
    expect((script as HTMLScriptElement).getAttribute('src')).toMatch(/sdk\.js$/)
    expect(session.status).toBe('ready')
  })

  it('читает окружение платформы и игрока', async () => {
    const fake = installFakeSdk({ lang: 'en' })
    const { sdk } = await loadPlatform()

    const session = await sdk.getSdkSession()

    expect(session.status).toBe('ready')
    expect(session.source).toBe('yandex')
    expect(session.lang).toBe('en')
    expect(session.isAuthorized).toBe(false)
    expect(session.player).not.toBeNull()
    expect(fake.calls.getPlayer).toBe(1)

    fake.setAuthorized(true)
    expect(session.player?.isAuthorized()).toBe(true)
  })

  it('не вызывает LoadingAPI.ready() во время инициализации', async () => {
    const fake = installFakeSdk()
    const { sdk } = await loadPlatform()

    await sdk.getSdkSession()

    expect(fake.calls.ready).toBe(0)
  })

  it('вызывает LoadingAPI.ready() ровно один раз, даже при повторных запросах', async () => {
    const fake = installFakeSdk()
    const { sdk } = await loadPlatform()

    await sdk.getSdkSession()
    await sdk.notifyGameReady()
    await sdk.notifyGameReady()
    await sdk.notifyGameReady()

    expect(fake.calls.ready).toBe(1)
  })

  it('работает в локальном режиме, если скрипт SDK недоступен', async () => {
    failScriptLoading()
    const { sdk } = await loadPlatform()

    const session = await sdk.getSdkSession()

    expect(session.status).toBe('unavailable')
    expect(session.source).toBe('none')
    expect(session.ysdk).toBeNull()
    expect(session.reason).toContain('sdk.js')
  })

  it('не падает, если YaGames.init() завершился ошибкой', async () => {
    installFakeSdk({ initError: new Error('platform error') })
    const { sdk } = await loadPlatform()

    const session = await sdk.getSdkSession()
    await expect(sdk.notifyGameReady()).resolves.toBeUndefined()

    expect(session.status).toBe('unavailable')
    expect(session.reason).toBe('platform error')
  })
})

describe('разметка геймплея', () => {
  it('отправляет start после готовности игры и переключает состояние по паузе', async () => {
    const fake = installFakeSdk()
    const { sdk, lifecycle } = await loadPlatform()

    await sdk.getSdkSession()
    expect(fake.calls.gameplayStart).toBe(0)

    await sdk.notifyGameReady()
    expect(fake.calls.gameplayStart).toBe(1)
    expect(fake.calls.gameplayStop).toBe(0)

    lifecycle.pauseGame('hidden')
    expect(fake.calls.gameplayStop).toBe(1)

    lifecycle.resumeGame('hidden')
    expect(fake.calls.gameplayStart).toBe(2)
  })

  it('не возобновляет геймплей, пока активна хотя бы одна причина паузы', async () => {
    const fake = installFakeSdk()
    const { sdk, lifecycle } = await loadPlatform()

    await sdk.getSdkSession()
    await sdk.notifyGameReady()

    lifecycle.pauseGame('hidden')
    lifecycle.pauseGame('sdk')
    expect(fake.calls.gameplayStop).toBe(1)

    lifecycle.resumeGame('hidden')
    expect(fake.calls.gameplayStart).toBe(1)

    lifecycle.resumeGame('sdk')
    expect(fake.calls.gameplayStart).toBe(2)
  })

  it('реагирует на события платформы game_api_pause / game_api_resume', async () => {
    const fake = installFakeSdk()
    const { sdk, lifecycle } = await loadPlatform()

    await sdk.getSdkSession()
    await sdk.notifyGameReady()
    expect(fake.calls.gameplayStart).toBe(1)

    fake.emit('game_api_pause')
    expect(lifecycle.isGamePaused()).toBe(true)
    expect(fake.calls.gameplayStop).toBe(1)

    fake.emit('game_api_resume')
    expect(lifecycle.isGamePaused()).toBe(false)
    expect(fake.calls.gameplayStart).toBe(2)
  })

  it('снимает паузу платформы только после одновременной потери фокуса', async () => {
    const fake = installFakeSdk()
    const { sdk, lifecycle } = await loadPlatform()

    await sdk.getSdkSession()
    await sdk.notifyGameReady()

    fake.emit('game_api_pause')
    lifecycle.pauseGame('hidden')
    fake.emit('game_api_resume')

    expect(lifecycle.isGamePaused()).toBe(true)
    expect(fake.calls.gameplayStart).toBe(1)

    lifecycle.resumeGame('hidden')
    expect(fake.calls.gameplayStart).toBe(2)
  })
})

describe('локальный режим', () => {
  it('разметка геймплея не вызывает ошибок без SDK', async () => {
    failScriptLoading()
    const { sdk, lifecycle } = await loadPlatform()

    await sdk.getSdkSession()
    await sdk.notifyGameReady()

    expect(() => {
      lifecycle.pauseGame('hidden')
      lifecycle.resumeGame('hidden')
    }).not.toThrow()
    expect(sdk.isSdkReady()).toBe(false)
  })
})
