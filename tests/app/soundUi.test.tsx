import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeSdk, makeSave } from '../helpers/fakeSdk'

/**
 * Звук глазами игрока: кнопка включения/выключения и звуки игровых событий.
 * Проверяется на настоящем интерфейсе с подменённым Web Audio API.
 */

type FakeSource = {
  buffer: unknown
  playbackRate: { value: number }
  started: number
  connect: () => void
  start: () => void
  stop: () => void
  onended: (() => void) | null
}

const audio = vi.hoisted(() => ({
  sources: [] as FakeSource[],
  contexts: 0,
}))

vi.mock('../../src/game/PhaserGame', () => ({
  PhaserGame: ({ onReady }: { onReady?: () => void }) => {
    queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

/** Подменяет Web Audio API: считаем, сколько звуков реально запущено. */
function installFakeAudioContext(): void {
  class FakeAudioContext {
    state: 'running' | 'suspended' | 'closed' = 'running'
    sampleRate = 44100
    destination = {}

    constructor() {
      audio.contexts += 1
    }

    createGain() {
      return { gain: { value: 1 }, connect: () => undefined }
    }

    createBuffer(channels: number, length: number, sampleRate: number) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        copyToChannel: () => undefined,
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

  vi.stubGlobal('AudioContext', FakeAudioContext)
}

/** Свежий модульный граф игры с фейковым SDK и сохранением. */
async function prepare(saveOverrides: Record<string, unknown> = {}) {
  installFakeSdk({ authorized: true, withAds: true })
  vi.resetModules()

  const platform = await import('../../src/platform/yandexSdk')
  const store = await import('../../src/game/gameStore')
  const storage = await import('../../src/game/saveGame')
  const schema = await import('../../src/game/saveSchema')
  const audioModule = await import('../../src/platform/audio')
  // Реклама выключена: тест про звук, не про показы.
  const ads = await import('../../src/platform/ads')
  ads.configureAds({ enabled: false })

  await platform.getSdkSession()

  const save = schema.normalizeSave(makeSave({ savedAt: Date.now(), ...saveOverrides }))
  if (!save) throw new Error('не удалось собрать сохранение для теста')
  await storage.saveGame(save)

  const { default: App } = await import('../../src/App')
  return { store, audioModule, App }
}

async function renderGame(prepared: Awaited<ReturnType<typeof prepare>>): Promise<void> {
  render(<prepared.App />)
  await screen.findByRole('navigation', { name: 'Игровая навигация' })
}

beforeEach(() => {
  audio.sources.length = 0
  audio.contexts = 0
  window.localStorage.clear()
  installFakeAudioContext()
  vi.spyOn(Math, 'random').mockReturnValue(0.99)
})

afterEach(() => {
  cleanup()
  delete window.YaGames
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('кнопка звука', () => {
  it('показывает состояние звука и переключает его', async () => {
    const prepared = await prepare()
    await renderGame(prepared)

    const toggle = screen.getByRole('button', { name: 'Выключить звук' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    const mutedToggle = screen.getByRole('button', { name: 'Включить звук' })
    expect(mutedToggle.getAttribute('aria-pressed')).toBe('true')
    expect(prepared.audioModule.isMuted()).toBe(true)
    // Настройка запоминается между сессиями.
    expect(window.localStorage.getItem('evolution-isles:audio-muted')).toBe('1')

    fireEvent.click(mutedToggle)

    expect(screen.getByRole('button', { name: 'Выключить звук' }).getAttribute('aria-pressed')).toBe('false')
    expect(prepared.audioModule.isMuted()).toBe(false)
  })

  it('восстанавливает сохранённую настройку при запуске', async () => {
    window.localStorage.setItem('evolution-isles:audio-muted', '1')
    const prepared = await prepare()
    await renderGame(prepared)

    expect(screen.getByRole('button', { name: 'Включить звук' })).toBeTruthy()
    expect(prepared.audioModule.isMuted()).toBe(true)
  })
})

describe('звуки игровых событий', () => {
  it('клик по дереву играет звук, а при выключенном звуке — молчит', async () => {
    const prepared = await prepare({ energy: 0, clickPower: 1, totalClicks: 0 })
    const { store, audioModule } = prepared
    await renderGame(prepared)

    // Клик по дереву: сцена подменена, обработчик вызываем как игрок.
    store.useGameStore.getState().addEnergy()
    await audioModule.unlockAudio()
    expect(audio.contexts).toBeGreaterThan(0)

    const beforeMute = audio.sources.length
    fireEvent.click(screen.getByRole('button', { name: 'Выключить звук' }))
    store.useGameStore.getState().addEnergy()

    expect(audio.sources.length).toBe(beforeMute)
  })

  it('покупка улучшения и открытие яйца звучат', async () => {
    const prepared = await prepare({ energy: 100_000, clickUpgradeCost: 25, sunwellCost: 75, eggCost: 100 })
    const { store, audioModule } = prepared
    await renderGame(prepared)
    await audioModule.unlockAudio()

    // Кнопка покупки — единственная внутри панели «Корни силы».
    const upgradePanel = screen.getByRole('heading', { name: 'Корни силы' }).closest('section')
    const buyButton = upgradePanel?.querySelector('button')
    expect(buyButton).toBeTruthy()

    const before = audio.sources.length
    fireEvent.click(buyButton!)
    expect(audio.sources.length).toBeGreaterThan(before)

    // Открытие яйца: звук вылупления.
    const eggCard = screen.getByRole('heading', { name: 'Лунное яйцо' }).closest('article')
    const eggButton = eggCard?.querySelector('button')
    expect(eggButton).toBeTruthy()

    const afterBuy = audio.sources.length
    fireEvent.click(eggButton!)
    expect(store.useGameStore.getState().eggsOpened).toBeGreaterThan(0)
    expect(audio.sources.length).toBeGreaterThan(afterBuy)
  })

  it('переход между экранами играет звук интерфейса', async () => {
    const prepared = await prepare()
    const { audioModule } = prepared
    await renderGame(prepared)
    await audioModule.unlockAudio()

    const before = audio.sources.length
    fireEvent.click(screen.getByRole('button', { name: /Достижения/ }))

    expect(audio.sources.length).toBeGreaterThan(before)
  })

  it('игра запускается и работает без Web Audio API', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const prepared = await prepare({ energy: 500 })
    await renderGame(prepared)

    const toggle = screen.getByRole('button', { name: 'Выключить звук' })
    expect(() => fireEvent.click(toggle)).not.toThrow()
    expect(prepared.audioModule.getAudioState().contextState).toBeNull()
  })
})
