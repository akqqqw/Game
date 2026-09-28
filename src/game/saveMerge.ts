/**
 * Разрешение конфликта локального и облачного сохранений.
 *
 * Стратегия (согласована с заказчиком): **свежайший прогресс + резервная копия**.
 * Проигравшая версия не удаляется — она уходит в отдельный слот, поэтому откат
 * возможен в любой момент.
 *
 * Дополнительные правила безопасности:
 *  - пустое облачное сохранение никогда не перезатирает реальный прогресс;
 *  - пустое локальное сохранение не блокирует загрузку прогресса из облака;
 *  - данные обеих сторон предварительно нормализуются (`normalizeSave`).
 */

import { isEmptyProgress, type PersistedGame } from './saveSchema'

export type SaveSource = 'local' | 'cloud' | 'new'

export type MergeResult = {
  /** Сохранение, которое нужно применить. */
  save: PersistedGame
  /** Откуда взято применённое сохранение. */
  source: SaveSource
  /** Проигравшая версия — её сохраняем в резервный слот. */
  backup: PersistedGame | null
  /** Текст уведомления для игрока (или `null`, если сообщать нечего). */
  notice: string | null
}

function describeSavedAt(save: PersistedGame): string {
  if (!save.savedAt) return 'время неизвестно'
  return new Date(save.savedAt).toLocaleString('ru-RU')
}

/**
 * Определяет, какое сохранение применить.
 * Возвращает `null`, если оба сохранения отсутствуют — тогда создаётся новая игра.
 */
export function resolveSaveConflict(
  local: PersistedGame | null,
  cloud: PersistedGame | null,
): MergeResult | null {
  const localSave = local && !isEmptyProgress(local) ? local : null
  const cloudSave = cloud && !isEmptyProgress(cloud) ? cloud : null

  if (!localSave && !cloudSave) {
    const candidates = [local, cloud].filter((save): save is PersistedGame => Boolean(save))
    const fresh = candidates.sort((a, b) => b.savedAt - a.savedAt)[0]
    if (!fresh) return null
    // Оба сохранения пусты: берём более свежее, резервная копия не нужна.
    return { save: fresh, source: 'new', backup: null, notice: null }
  }

  if (!cloudSave) {
    const save = localSave as PersistedGame
    const notice = cloud
      ? 'Пустое облачное сохранение не перезаписало прогресс — игра продолжается локально.'
      : null
    return { save, source: 'local', backup: cloud && localSave ? cloud : null, notice }
  }

  if (!localSave) {
    return {
      save: cloudSave,
      source: 'cloud',
      backup: local,
      notice: `Прогресс загружен из облака (${describeSavedAt(cloudSave)}).`,
    }
  }

  if (cloudSave.savedAt > localSave.savedAt) {
    return {
      save: cloudSave,
      source: 'cloud',
      backup: localSave,
      notice: `Обнаружен более свежий прогресс в облаке (${describeSavedAt(cloudSave)}) — он загружен, локальная версия сохранена в резерв.`,
    }
  }

  return {
    save: localSave,
    source: 'local',
    backup: cloudSave,
    notice: cloudSave.savedAt < localSave.savedAt
      ? 'Локальный прогресс новее облачного — он отправлен в облако, облачная версия сохранена в резерв.'
      : null,
  }
}
