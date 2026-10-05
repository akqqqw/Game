import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPlatformGuards, resetPlatformGuardsForTests } from '../../src/platform/platformGuards'

/** Проверяет, был ли вызов отменён (запрещён игрой). */
function dispatchAndCheckPrevented(target: EventTarget, type: string): boolean {
  const event = new Event(type, { cancelable: true, bubbles: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  resetPlatformGuardsForTests()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('запреты браузерного поведения', () => {
  it('отменяет контекстное меню по игровому полю', () => {
    installPlatformGuards()
    const field = document.createElement('div')
    document.body.append(field)

    expect(dispatchAndCheckPrevented(field, 'contextmenu')).toBe(true)
  })

  it('не мешает работе с полями ввода', () => {
    installPlatformGuards()
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    document.body.append(input, textarea)

    expect(dispatchAndCheckPrevented(input, 'contextmenu')).toBe(false)
    expect(dispatchAndCheckPrevented(textarea, 'contextmenu')).toBe(false)
  })

  it('отменяет перетаскивание элементов', () => {
    installPlatformGuards()
    const icon = document.createElement('div')
    document.body.append(icon)

    expect(dispatchAndCheckPrevented(icon, 'dragstart')).toBe(true)
  })

  it('отменяет жесты масштабирования Safari', () => {
    installPlatformGuards()

    expect(dispatchAndCheckPrevented(document, 'gesturestart')).toBe(true)
    expect(dispatchAndCheckPrevented(document, 'gesturechange')).toBe(true)
    expect(dispatchAndCheckPrevented(document, 'gestureend')).toBe(true)
  })

  it('отменяет двойной тап по игровому полю, но не по полю ввода', () => {
    installPlatformGuards()
    const field = document.createElement('div')
    const input = document.createElement('input')
    document.body.append(field, input)

    const firstTap = new Event('touchend', { cancelable: true, bubbles: true })
    field.dispatchEvent(firstTap)
    expect(firstTap.defaultPrevented).toBe(false)

    const secondTap = new Event('touchend', { cancelable: true, bubbles: true })
    field.dispatchEvent(secondTap)
    expect(secondTap.defaultPrevented).toBe(true)

    const inputTapOne = new Event('touchend', { cancelable: true, bubbles: true })
    input.dispatchEvent(inputTapOne)
    const inputTapTwo = new Event('touchend', { cancelable: true, bubbles: true })
    input.dispatchEvent(inputTapTwo)
    expect(inputTapTwo.defaultPrevented).toBe(false)
  })

  it('устанавливается один раз и не дублирует обработчики', () => {
    installPlatformGuards()
    installPlatformGuards()
    const field = document.createElement('div')
    document.body.append(field)

    expect(dispatchAndCheckPrevented(field, 'contextmenu')).toBe(true)
  })
})
