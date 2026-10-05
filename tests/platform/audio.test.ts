import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeSource = {
  buffer: unknown
  started: number
  stopped: number
  connect: () => void
  start: () => void
  stop: () => void
  onended: (() => void) | null
}

type FakeContext = {
  state: 'running' | 'suspended' | 'closed'
  destination: object
  createGain: () => { gain: { value: number }; connect: () => void }
  createBufferSource: () => FakeSource
  resume: () => Promise<void>
  suspend: () => Promise<void>
}

const audio = vi.hoisted(() => ({ contexts: [] as FakeContext[], sources: [] as FakeSource[] }))

/** Подменяет Web Audio API минимальной реализацией, достаточной для проверки поведения. */
function installFakeAudioContext(): void {
  class FakeAudioContext {
    state: 'running' | 'suspended' | 'closed' = 'running'
    destination = {}
    sources: FakeSource[] = []

    constructor() {
      contexts.push(this as unknown as FakeContext)
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect: () => undefined,
      }
    }

    createBufferSource(): FakeSource {
      const source: FakeSource = {
        buffer: null,
        started: 0,
        stopped: 0,
        connect: () => undefined,
        start: () => {
          source.started += 1
        },
        stop: () => {
          source.stopped += 1
          source.onended?.()
        },
        onended: null,
      }
      this.sources.push(source)
      sources.push(source)
      return source
    }

    async resume() {
      this.state = 'running'
    }

    async suspend() {
      this.state = 'suspended'
    }
  }

  const contexts = audio.contexts
  const sources = audio.sources
  void contexts
  void sources

  vi.stubGlobal('AudioContext', FakeAudioContext)
}

async function loadModules() {
  vi.resetModules()
  return {
    audio: await import('../../src/platform/audio'),
    lifecycle: await import('../../src/platform/gameLifecycle'),
  }
}

function fakeBuffer(): AudioBuffer {
  return {} as AudioBuffer
}

beforeEach(() => {
  audio.contexts.length = 0
  audio.sources.length = 0
  installFakeAudioContext()
  window.localStorage.clear()
})

afterEach(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('звук и пауза игры', () => {
  it('останавливает звук при паузе и возвращает при возобновлении', async () => {
    const { audio: audioModule, lifecycle } = await loadModules()
    audioModule.initAudio()
    await audioModule.unlockAudio()
    audioModule.registerSound('click', fakeBuffer())
    audioModule.play('click')

    expect(audio.state?.contextState).toBeUndefined()
    const moduleState = audioModule.getAudioState()
    expect(moduleState.activeSounds).toBe(1)

    const context = audio.contexts.at(-1)
    lifecycle.pauseGame('sdk')
    await vi.waitFor(() => {
      expect(context?.state).toBe('suspended')
    })

    // Все источники оборваны: при возврате ничего не доигрывает «задним числом».
    expect(audioModule.getAudioState().activeSounds).toBe(0)
    expect(audio.sources.at(-1)?.stopped).toBe(1)

    lifecycle.resumeGame('sdk')
    await vi.waitFor(() => {
      expect(context?.state).toBe('running')
    })
  })

  it('останавливает звук при потере фокуса и при сворачивании вкладки', async () => {
    const { audio: audioModule, lifecycle } = await loadModules()
    // Слушатели браузерных событий подключает платформенный слой при старте игры.
    lifecycle.initGameLifecycle()
    audioModule.initAudio()
    await audioModule.unlockAudio()
    const context = audio.contexts.at(-1)

    window.dispatchEvent(new Event('blur'))
    await vi.waitFor(() => {
      expect(context?.state).toBe('suspended')
    })

    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => {
      expect(context?.state).toBe('running')
    })

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(context?.state).toBe('suspended')
    })

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(context?.state).toBe('running')
    })
  })

  it('при выключенном звуке ничего не проигрывает и помнит настройку', async () => {
    const first = await loadModules()
    first.audio.initAudio()
    await first.audio.unlockAudio()
    first.audio.registerSound('click', fakeBuffer())

    expect(first.audio.toggleMuted()).toBe(true)
    expect(first.audio.isMuted()).toBe(true)
    expect(window.localStorage.getItem('evolution-isles:audio-muted')).toBe('1')

    first.audio.play('click')
    expect(first.audio.getAudioState().activeSounds).toBe(0)

    // Новая сессия: настройка сохранилась.
    const second = await loadModules()
    expect(second.audio.isMuted()).toBe(true)
  })

  it('не проигрывает незарегистрированный звук', async () => {
    const { audio: audioModule } = await loadModules()
    audioModule.initAudio()
    await audioModule.unlockAudio()

    expect(() => audioModule.play('unknown-sound')).not.toThrow()
    expect(audioModule.getAudioState().activeSounds).toBe(0)
  })

  it('работает без Web Audio API', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const { audio: audioModule, lifecycle } = await loadModules()

    expect(() => {
      audioModule.initAudio()
      audioModule.registerSound('click', fakeBuffer())
      audioModule.play('click')
    }).not.toThrow()

    lifecycle.pauseGame('sdk')
    lifecycle.resumeGame('sdk')
    expect(audioModule.getAudioState().contextState).toBeNull()
  })
})
