import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CAPTURED_ERRORS,
  describeError,
  getCapturedErrors,
  installErrorHandling,
  onCapturedError,
  resetErrorHandlingForTests,
} from '../../src/platform/errorHandling'

/**
 * Глобальный перехват ошибок: игра обязана продолжать работать и оставлять
 * понятный след вместо «красной ошибки» в консоли (п. 6.4 требований).
 */

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

function emitCodeError(message: string, filename = 'app.js', lineno = 12): void {
  window.dispatchEvent(new ErrorEvent('error', { message, filename, lineno }))
}

function emitRejection(reason: unknown): Event {
  // Событие отменяемое — как в браузере: обработчик гасит стандартный лог.
  const event = new Event('unhandledrejection', { cancelable: true }) as Event & { reason?: unknown }
  event.reason = reason
  window.dispatchEvent(event)
  return event
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  resetErrorHandlingForTests()
  installErrorHandling()
})

afterEach(() => {
  resetErrorHandlingForTests()
  vi.restoreAllMocks()
})

describe('перехват ошибок кода', () => {
  it('запоминает ошибку с файлом и строкой', () => {
    emitCodeError('Что-то сломалось', 'src/game/logic.ts', 42)

    const [error] = getCapturedErrors()
    expect(error.kind).toBe('error')
    expect(error.message).toBe('Что-то сломалось')
    expect(error.source).toBe('src/game/logic.ts:42')
    expect(error.at).toBeGreaterThan(0)
  })

  it('пишет предупреждение, а не ошибку в консоль', () => {
    emitCodeError('Тест')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[errors] error: Тест'))
    expect(error).not.toHaveBeenCalled()
  })

  it('ставится один раз: повторный вызов не задваивает перехват', () => {
    installErrorHandling()
    installErrorHandling()
    emitCodeError('Один раз')

    expect(getCapturedErrors()).toHaveLength(1)
  })

  it('хранит только последние ошибки, не разрастаясь', () => {
    for (let index = 0; index < MAX_CAPTURED_ERRORS + 5; index += 1) {
      emitCodeError(`ошибка ${index}`)
    }

    const errors = getCapturedErrors()
    expect(errors).toHaveLength(MAX_CAPTURED_ERRORS)
    expect(errors[errors.length - 1].message).toBe(`ошибка ${MAX_CAPTURED_ERRORS + 4}`)
  })
})

describe('перехват отклонённых промисов', () => {
  it('описывает причину-ошибку и гасит стандартный лог', () => {
    const event = emitRejection(new Error('Промис упал'))

    expect(getCapturedErrors()[0].kind).toBe('rejection')
    expect(getCapturedErrors()[0].message).toBe('Промис упал')
    expect(event.defaultPrevented).toBe(true)
  })

  it('понимает причину-строку и причину-объект', () => {
    emitRejection('просто строка')
    emitRejection({ code: 500, message: 'сервер ответил ошибкой' })

    const errors = getCapturedErrors()
    expect(errors[0].message).toBe('просто строка')
    expect(errors[1].message).toBe('сервер ответил ошибкой')
  })
})

describe('перехват ошибок загрузки ресурсов', () => {
  it('записывает, какой ресурс не загрузился', () => {
    const image = document.createElement('img')
    image.src = './assets/missing.png'
    document.body.append(image)
    image.dispatchEvent(new Event('error'))

    const [error] = getCapturedErrors()
    expect(error.kind).toBe('resource')
    expect(error.source).toContain('img:')
    expect(error.source).toContain('missing.png')

    image.remove()
  })
})

describe('подписка на ошибки', () => {
  it('уведомляет подписчика и позволяет отписаться', () => {
    const listener = vi.fn()
    const unsubscribe = onCapturedError(listener)

    emitCodeError('первая')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    emitCodeError('вторая')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('падающий подписчик не ломает обработку ошибок', () => {
    onCapturedError(() => {
      throw new Error('подписчик сломался')
    })
    const second = vi.fn()
    onCapturedError(second)

    expect(() => emitCodeError('проверка')).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('описание ошибки', () => {
  it('приводит к тексту любые значения', () => {
    expect(describeError(new Error('ошибка'))).toBe('ошибка')
    expect(describeError('строка')).toBe('строка')
    expect(describeError({ message: 'из объекта' })).toBe('из объекта')
    expect(describeError({ code: 1 })).toBe('{"code":1}')
    expect(describeError(null)).toBe('Неизвестная ошибка')
    expect(describeError(undefined)).toBe('Неизвестная ошибка')
    expect(describeError(42)).toBe('42')
  })

  it('не падает на объекте с циклической ссылкой', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(typeof describeError(cyclic)).toBe('string')
  })
})

describe('сброс состояния', () => {
  it('очищает список и снимает обработчики', () => {
    emitCodeError('до сброса')
    expect(getCapturedErrors()).toHaveLength(1)

    resetErrorHandlingForTests()
    emitCodeError('после сброса')

    expect(getCapturedErrors()).toHaveLength(0)
  })
})
