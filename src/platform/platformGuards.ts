/**
 * Платформенные ограничения браузера, мешающие игре.
 *
 * Требования платформы:
 *  - п. 1.6.1.8 / 1.6.2.7: лонгтап и взаимодействие с полем игры не выделяют
 *    элементы и не открывают контекстное меню;
 *  - п. 1.10.2: нет браузерной прокрутки и swipe-to-refresh;
 *  - п. 1.20: Safari на iOS не должен масштабировать страницу жестами.
 *
 * Основная часть запретов сделана в CSS (`src/index.css`: `overflow: hidden`,
 * `overscroll-behavior: none`, `user-select: none`, `touch-action`). Здесь —
 * то, что CSS не покрывает: контекстное меню, перетаскивание, жесты Safari.
 */

/** Поля ввода — исключение: в них выделение и контекстное меню нужны. */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

let installed = false

/**
 * Включает запреты на уровне документа. Вызывается один раз при старте игры.
 * Любая из этих возможностей может отсутствовать в браузере — вызовы безопасны.
 */
export function installPlatformGuards(): void {
  if (installed || typeof document === 'undefined') return
  installed = true

  // Контекстное меню по правой кнопке и долгому нажатию.
  document.addEventListener(
    'contextmenu',
    (event) => {
      if (isTextInput(event.target)) return
      event.preventDefault()
    },
    { passive: false },
  )

  // Перетаскивание элементов (в Safari картинка/текст «уезжает» за курсором).
  document.addEventListener('dragstart', (event) => {
    if (isTextInput(event.target)) return
    event.preventDefault()
  })

  // Жесты масштабирования Safari: они меняют масштаб всей страницы игры.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false })
  }

  // Двойной тап не должен приближать страницу: обрабатываем только по игровому
  // полю, чтобы не мешать обычным кнопкам и полям ввода.
  let lastTouchEnd = 0
  document.addEventListener(
    'touchend',
    (event) => {
      const now = Date.now()
      const isDoubleTap = now - lastTouchEnd <= 320
      lastTouchEnd = now
      if (!isDoubleTap || isTextInput(event.target)) return
      event.preventDefault()
    },
    { passive: false },
  )
}

/** Только для тестов: снимает установку флага. */
export function resetPlatformGuardsForTests(): void {
  installed = false
}
