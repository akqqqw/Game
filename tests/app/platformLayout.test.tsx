import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Проверки платформенных требований к интерфейсу.
 *
 * Часть требований выполняется только CSS-правилами, которые невозможно
 * проверить в jsdom (нет вёрстки). Поэтому здесь контролируется наличие самих
 * правил в исходниках: так они не потеряются при будущих правках.
 */

const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const appCss = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

const platform = vi.hoisted(() => ({ notifyGameReady: vi.fn(async () => undefined) }))

vi.mock('../../src/platform/yandexSdk', () => ({
  notifyGameReady: platform.notifyGameReady,
  getSdkSession: async () => ({
    status: 'unavailable',
    source: 'none',
    ysdk: null,
    player: null,
    isAuthorized: false,
    lang: 'ru',
    reason: 'тестовый режим',
  }),
  getSdkSessionSync: () => null,
  onSdkSessionChange: () => () => undefined,
}))

vi.mock('../../src/game/PhaserGame', () => ({
  PhaserGame: ({ onReady }: { onReady?: () => void }) => {
    queueMicrotask(() => onReady?.())
    return <div data-testid="phaser-scene" />
  },
}))

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('навигация по экранам', () => {
  it('содержит четыре пункта — по одному на каждый экран', async () => {
    const { default: App } = await import('../../src/App')
    render(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Игровая навигация' })
    const items = [...nav.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')

    expect(items).toHaveLength(4)
    expect(items.some((label) => label.includes('Остров'))).toBe(true)
    expect(items.some((label) => label.includes('Улучшения'))).toBe(true)
    expect(items.some((label) => label.includes('Существа'))).toBe(true)
    expect(items.some((label) => label.includes('Достижения'))).toBe(true)
  })

  it('не дублирует экран коллекции отдельной кнопкой', async () => {
    const { default: App } = await import('../../src/App')
    render(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Игровая навигация' })
    expect(nav.textContent).not.toContain('Коллекция')
  })
})

describe('требования к интерфейсу и ресурсам', () => {
  it('страница не прокручивается и не тянет жест обновления (п. 1.10.2)', () => {
    expect(indexCss).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/s)
    expect(indexCss).toMatch(/overscroll-behavior:\s*none/)
    expect(appCss).toMatch(/\.game-scroll\s*\{[^}]*overflow-y:\s*auto/s)
  })

  it('текст не выделяется и не открывает контекстное меню (п. 1.6.1.8, 1.6.2.7)', () => {
    expect(indexCss).toMatch(/user-select:\s*none/)
    expect(indexCss).toMatch(/-webkit-touch-callout:\s*none/)
  })

  it('жесты не конфликтуют с прокруткой страницы (п. 1.6.1.5)', () => {
    expect(indexCss).toMatch(/button\s*\{[^}]*touch-action:\s*manipulation/s)
    expect(indexCss).toMatch(/canvas\s*\{[^}]*touch-action:\s*none/s)
  })

  it('окно не масштабируется жестами и учитывает вырез экрана', () => {
    expect(html).toContain('user-scalable=no')
    expect(html).toContain('viewport-fit=cover')
    expect(appCss).toMatch(/env\(safe-area-inset-bottom\)/)
  })

  it('сцена сохраняет пропорции и не обрезается по высоте', () => {
    expect(appCss).toMatch(/\.phaser-mount\s*\{[^}]*aspect-ratio:\s*760\s*\/\s*560/s)
    expect(appCss).toMatch(/\.phaser-mount\s*\{[^}]*dvh/s)
  })

  it('навигация рассчитана на четыре кнопки', () => {
    expect(appCss).toMatch(/grid-template-columns:\s*repeat\(4,\s*1fr\)/)
  })

  it('подписи на мобильных не мельче 10px (читаемость)', () => {
    const sizes = [...appCss.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]))
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9)
    expect(sizes.filter((size) => size < 10)).toHaveLength(0)
  })

  it('шрифты подключаются локально, без внешних хостов (п. 1.7)', () => {
    expect(indexCss).toContain('@fontsource/')
    expect(appCss).not.toContain('fonts.googleapis.com')
    expect(indexCss).not.toContain('fonts.googleapis.com')
  })

  it('тач-зоны навигации не меньше 44px', () => {
    expect(appCss).toMatch(/\.nav-item\s*\{[^}]*min-height:\s*44px/s)
  })
})
