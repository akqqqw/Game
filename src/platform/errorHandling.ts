/**
 * Глобальный перехват ошибок.
 *
 * Зачем: игра не должна «белеть» и молчать, если что-то пошло не так. Раньше
 * падение в рендере, обработчике события или промис-цепочке оставляло игрока
 * с пустым экраном и без понятного следа в консоли. Теперь ошибки:
 *
 *  - собираются в один список с понятным описанием и источником;
 *  - дублируются предупреждением в консоль (не «красной ошибкой» — п. 6.4);
 *  - доступны подписчикам (например, чтобы показать игроку подсказку);
 *  - не мешают игре продолжаться: перехват ничего не выбрасывает наружу.
 *
 * Ошибки загрузки ресурсов (картинка, шрифт, скрипт) тоже попадают сюда: это
 * самый частый вид «тихой» поломки после публикации.
 */

export type CapturedErrorKind = 'error' | 'rejection' | 'resource'

export type CapturedError = {
  kind: CapturedErrorKind
  message: string
  /** Файл и строка для ошибок кода, адрес — для ошибок загрузки ресурсов. */
  source: string | null
  at: number
}

/** Сколько последних ошибок храним в памяти для диагностики. */
export const MAX_CAPTURED_ERRORS = 20

let installed = false
const captured: CapturedError[] = []
const listeners = new Set<(error: CapturedError) => void>()

/** Приводит любое значение из `error`/`rejection` к понятному тексту. */
export function describeError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return 'Неизвестная ошибка'
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string' && record.message) return record.message
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function record(error: CapturedError): void {
  captured.push(error)
  if (captured.length > MAX_CAPTURED_ERRORS) {
    captured.splice(0, captured.length - MAX_CAPTURED_ERRORS)
  }

  // Предупреждение, а не ошибка: игра продолжает работать, но разработчик
  // должен видеть проблему (п. 6.4 — ошибок в консоли быть не должно).
  console.warn(`[errors] ${error.kind}: ${error.message}${error.source ? ` (${error.source})` : ''}`)

  for (const listener of listeners) {
    try {
      listener(error)
    } catch {
      // Подписчик не должен ломать обработку ошибок.
    }
  }
}

/** Ошибка загрузки ресурса: у элемента нет сообщения, но есть адрес. */
function resourceSource(target: EventTarget | null): string | null {
  if (!target || target === window || !('tagName' in target)) return null
  const element = target as unknown as { tagName?: string; src?: string; href?: string; currentSrc?: string }
  const tag = element.tagName?.toLowerCase() ?? 'resource'
  const url = element.currentSrc || element.src || element.href || ''
  return url ? `${tag}: ${url}` : tag
}

function handleErrorEvent(event: Event): void {
  const errorEvent = event as ErrorEvent
  const source = resourceSource(errorEvent.target)

  if (source && !errorEvent.message) {
    record({ kind: 'resource', message: 'Не удалось загрузить ресурс', source, at: Date.now() })
    return
  }

  const location = errorEvent.filename
    ? `${errorEvent.filename}${errorEvent.lineno ? `:${errorEvent.lineno}` : ''}`
    : null

  record({
    kind: 'error',
    message: errorEvent.message || describeError(errorEvent.error),
    source: location,
    at: Date.now(),
  })
}

function handleRejection(event: Event): void {
  const rejection = event as PromiseRejectionEvent
  // Гасим стандартный «красный» лог: ошибку мы уже перехватили и описали.
  if (typeof rejection.preventDefault === 'function') rejection.preventDefault()

  record({
    kind: 'rejection',
    message: describeError(rejection.reason),
    source: null,
    at: Date.now(),
  })
}

/**
 * Ставит глобальные обработчики. Вызывается первой строкой платформенной
 * инициализации, чтобы поймать в том числе ошибки самого запуска игры.
 */
export function installErrorHandling(): void {
  if (installed) return
  installed = true

  // capture: true нужен, чтобы поймать ошибки загрузки ресурсов — они не
  // всплывают до window в фазе всплытия.
  window.addEventListener('error', handleErrorEvent, true)
  window.addEventListener('unhandledrejection', handleRejection)
}

/** Последние перехваченные ошибки, от старых к новым. */
export function getCapturedErrors(): CapturedError[] {
  return [...captured]
}

/** Подписка на ошибки. Возвращает функцию отписки. */
export function onCapturedError(listener: (error: CapturedError) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Отладочный доступ из консоли (только в dev-сборке). */
export function installErrorsDebugHelper(): void {
  if (!import.meta.env.DEV) return
  const target = window as unknown as { __errorsDebug?: unknown }
  target.__errorsDebug = {
    list: getCapturedErrors,
    clear: () => {
      captured.length = 0
    },
  }
}

/** Снимает обработчики и очищает список — нужно тестам. */
export function resetErrorHandlingForTests(): void {
  if (installed) {
    window.removeEventListener('error', handleErrorEvent, true)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
  installed = false
  captured.length = 0
  listeners.clear()
}
