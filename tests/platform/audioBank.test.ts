import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { soundIds } from '../../src/platform/sounds'

/**
 * Банк звуков: аудиомодуль сам собирает синтезированные звуки при создании
 * контекста — файлов нет, но звук должен реально играть.
 */

type FakeSource = {
  buffer: { length: number } | null
  playbackRate: { value: number }
  started: number
  connect: () => void
  start: () => void
  stop: () => void
  onended: (() => void) | null
}

const audio = vi.hoisted(() => ({
  sources: [] as FakeSource[],
  buffersCreated: 0,
  copiedChannels: 0,
}))

/** Минимальный Web Audio API: достаточно, чтобы собрать банк и проиграть звук. */
function installFakeAudioContext(
  options: { withCreateBuffer?: boolean; initialState?: 'running' | 'suspended' } = {},
): void {
  const withCreateBuffer = options.withCreateBuffer ?? true

  class FakeAudioContext {
    state: 'running' | 'suspended' | 'closed' = options.initialState ?? 'running'
    sampleRate = 44100
    destination = {}

    createGain() {
      return { gain: { value: 1 }, connect: () => undefined }
    }

    createBuffer(channels: number, length: number, sampleRate: number) {
      audio.buffersCreated += 1
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        copyToChannel: () => {
          audio.copiedChannels += 1
        },
      }
    }

    createBufferSource(): FakeSource {
      const source: FakeSource = {
        buffer: null,
        playbackRate: { value: 1 },
        started: 0,
        connect: () => undefined,
        start: () => {
          source.started += 1
        },
        stop: () => source.onended?.(),
        onended: null,
      }
      audio.sources.push(source)
      return source
    }

    async resume() {
      this.state = 'running'
    }

    async suspend() {
      this.state = 'suspended'
    }
  }

  if (!withCreateBuffer) {
    // Проверяем ветку «браузер без createBuffer»: банк не собирается, игра молчит.
    const prototype = FakeAudioContext.prototype as { createBuffer?: unknown }
    delete prototype.createBuffer
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
}

async function loadAudio() {
  vi.resetModules()
  return import('../../src/platform/audio')
}

beforeEach(() => {
  audio.sources.length = 0
  audio.buffersCreated = 0
  audio.copiedChannels = 0
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('банк синтезированных звуков', () => {
  it('собирает все звуки при создании аудиоконтекста', async () => {
    installFakeAudioContext()
    const audioModule = await loadAudio()
    audioModule.initAudio()

    expect(audioModule.getAudioState().registeredSounds).toBe(0)

    await audioModule.unlockAudio()

    const state = audioModule.getAudioState()
    expect(state.bankReady).toBe(true)
    expect(state.registeredSounds).toBe(soundIds.length)
    expect(state.expectedSounds).toBe(soundIds.length)
    expect(audio.buffersCreated).toBe(soundIds.length)
    expect(audio.copiedChannels).toBe(soundIds.length)
  })

  it('собранные звуки реально проигрываются', async () => {
    installFakeAudioContext()
    const audioModule = await loadAudio()
    audioModule.initAudio()
    await audioModule.unlockAudio()

    for (const id of soundIds) {
      audioModule.play(id)
    }

    expect(audio.sources).toHaveLength(soundIds.length)
    for (const source of audio.sources) {
      expect(source.started).toBe(1)
      expect(source.buffer).not.toBeNull()
    }
    expect(audioModule.getAudioState().activeSounds).toBe(soundIds.length)
  })

  it('вариация тона и громкости не мешает воспроизведению', async () => {
    installFakeAudioContext()
    const audioModule = await loadAudio()
    audioModule.initAudio()
    await audioModule.unlockAudio()

    audioModule.play('click', { rate: 1.15, volume: 0.4 })
    audioModule.playVaried('click')

    const [first, second] = audio.sources
    expect(first.playbackRate.value).toBeCloseTo(1.15, 5)
    expect(first.started).toBe(1)
    // Вариативный клик укладывается в разумный диапазон тона.
    expect(second.playbackRate.value).toBeGreaterThanOrEqual(0.92)
    expect(second.playbackRate.value).toBeLessThan(1.08)
  })

  it('выключенный звук не пропускает ни одного звука в вывод', async () => {
    installFakeAudioContext()
    const audioModule = await loadAudio()
    audioModule.initAudio()
    await audioModule.unlockAudio()
    audioModule.setMuted(true)

    for (const id of soundIds) audioModule.play(id)

    expect(audio.sources).toHaveLength(0)
    expect(audioModule.getAudioState().activeSounds).toBe(0)
    // Банк при этом остаётся собранным: включение звука мгновенное.
    expect(audioModule.getAudioState().registeredSounds).toBe(soundIds.length)
  })

  it('первый звук не теряется, но во время паузы звуки не копятся', async () => {
    // Контекст стартует «спящим» — так браузер ведёт себя до первого жеста.
    installFakeAudioContext({ initialState: 'suspended' })
    const audioModule = await loadAudio()
    const lifecycle = await import('../../src/platform/gameLifecycle')
    audioModule.initAudio()
    lifecycle.initGameLifecycle()

    // Первый клик: контекст ещё разблокируется, но звук уже поставлен в очередь
    // и прозвучит сразу после разблокировки.
    audioModule.play('click')
    expect(audio.sources).toHaveLength(1)

    // Во время паузы (реклама, потеря фокуса) очередь не копим.
    lifecycle.pauseGame('ad')
    audioModule.play('click')
    audioModule.play('upgrade')
    expect(audio.sources).toHaveLength(1)

    lifecycle.resumeGame('ad')
  })

  it('работает в браузере без createBuffer: играет тихо, но не падает', async () => {
    installFakeAudioContext({ withCreateBuffer: false })
    const audioModule = await loadAudio()
    audioModule.initAudio()

    await expect(audioModule.unlockAudio()).resolves.toBeUndefined()
    expect(() => audioModule.play('click')).not.toThrow()
    expect(audioModule.getAudioState().registeredSounds).toBe(0)
  })
})
