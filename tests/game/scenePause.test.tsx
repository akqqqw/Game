import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Проверяет связку «события паузы → Phaser-сцена».
 *
 * Сам Phaser в тестах не запускается (для него нужен canvas/WebGL), поэтому
 * подменяется мок, который записывает вызовы `scene.pause()` / `scene.resume()`.
 * Проверяется именно наша логика: сцена должна останавливаться на паузе
 * (реклама, свёрнутая вкладка) и возобновляться ровно один раз.
 */

const phaserMock = vi.hoisted(() => ({
  sceneManager: {
    paused: false,
    pauseCalls: 0,
    resumeCalls: 0,
  },
}))

vi.mock('phaser', () => {
  class Scene {
    key: string
    constructor(key: string) {
      this.key = key
    }
  }

  class Game {
    scene = {
      isPaused: () => phaserMock.sceneManager.paused,
      pause: () => {
        phaserMock.sceneManager.paused = true
        phaserMock.sceneManager.pauseCalls += 1
      },
      resume: () => {
        phaserMock.sceneManager.paused = false
        phaserMock.sceneManager.resumeCalls += 1
      },
    }

    destroy(): void {
      // Ничего не делаем: в тесте нет реальных ресурсов.
    }
  }

  return {
    default: {
      Game,
      Scene,
      AUTO: 'AUTO',
      Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
      Scenes: { Events: { POST_UPDATE: 'postupdate' } },
    },
  }
})

async function loadModules() {
  vi.resetModules()
  return {
    phaserGame: await import('../../src/game/PhaserGame'),
    lifecycle: await import('../../src/platform/gameLifecycle'),
  }
}

beforeEach(() => {
  phaserMock.sceneManager.paused = false
  phaserMock.sceneManager.pauseCalls = 0
  phaserMock.sceneManager.resumeCalls = 0
})

afterEach(() => {
  cleanup()
})

describe('пауза Phaser-сцены', () => {
  it('останавливает сцену при паузе и возобновляет её при возврате', async () => {
    const { phaserGame, lifecycle } = await loadModules()
    render(<phaserGame.PhaserGame onTreeClick={() => undefined} />)

    expect(phaserMock.sceneManager.paused).toBe(false)

    lifecycle.pauseGame('sdk')
    expect(phaserMock.sceneManager.pauseCalls).toBe(1)
    expect(phaserMock.sceneManager.paused).toBe(true)
    expect(phaserMock.sceneManager.resumeCalls).toBe(0)

    lifecycle.resumeGame('sdk')
    expect(phaserMock.sceneManager.resumeCalls).toBe(1)
    expect(phaserMock.sceneManager.paused).toBe(false)
  })

  it('не возобновляет сцену, пока активна другая причина паузы', async () => {
    const { phaserGame, lifecycle } = await loadModules()
    render(<phaserGame.PhaserGame onTreeClick={() => undefined} />)

    lifecycle.pauseGame('hidden')
    lifecycle.pauseGame('sdk')
    expect(phaserMock.sceneManager.pauseCalls).toBe(1)

    lifecycle.resumeGame('hidden')
    expect(phaserMock.sceneManager.resumeCalls).toBe(0)
    expect(phaserMock.sceneManager.paused).toBe(true)

    lifecycle.resumeGame('sdk')
    expect(phaserMock.sceneManager.resumeCalls).toBe(1)
  })

  it('не дёргает сцену повторно при лишних событиях', async () => {
    const { phaserGame, lifecycle } = await loadModules()
    render(<phaserGame.PhaserGame onTreeClick={() => undefined} />)

    lifecycle.pauseGame('sdk')
    lifecycle.pauseGame('sdk')
    lifecycle.pauseGame('ui')

    expect(phaserMock.sceneManager.pauseCalls).toBe(1)
  })

  it('отписывается от событий при размонтировании', async () => {
    const { phaserGame, lifecycle } = await loadModules()
    const view = render(<phaserGame.PhaserGame onTreeClick={() => undefined} />)

    view.unmount()
    lifecycle.pauseGame('sdk')

    expect(phaserMock.sceneManager.pauseCalls).toBe(0)
  })
})
