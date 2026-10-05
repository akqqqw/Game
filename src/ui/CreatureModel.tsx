/**
 * Витрина существа в карточке: 3D-модель с запасным вариантом.
 *
 * Три состояния, и все три — нормальные:
 *  - `idle` — модуль витрины ещё загружается (three.js весит ~157 КБ в сжатом
 *    виде, поэтому грузится только при открытии карточки). Игрок в это время
 *    видит эмодзи, интерфейс не прыгает;
 *  - `ready` — модель на экране;
 *  - `fallback` — WebGL нет или витрина не поднялась: остаётся эмодзи.
 *
 * Импорт типа витрины — только типовой (`import type`), поэтому three.js в
 * основной бандл не попадает даже случайно.
 */

import { useEffect, useRef, useState } from 'react'
import type { CreatureViewerHandle } from '../game/creatureViewer'
import type { Rarity } from '../game/creatures'
import type { ElementId } from '../game/elements'

type CreatureModelProps = {
  id: string
  name: string
  emoji: string
  elements: ElementId[]
  rarity: Rarity
}

type ViewerState = 'idle' | 'ready' | 'fallback'

export function CreatureModel({ id, name, emoji, elements, rarity }: CreatureModelProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ViewerState>('idle')
  // Массив стихий приходит новым объектом при каждом рендере, поэтому в
  // зависимостях эффекта — его строковое представление.
  const elementKey = elements.join(',')

  useEffect(() => {
    const container = mountRef.current
    if (!container) return undefined

    let disposed = false
    let handle: CreatureViewerHandle | null = null

    const mount = async (): Promise<void> => {
      try {
        const viewer = await import('../game/creatureViewer')
        if (disposed) return

        handle = await viewer.mountCreatureViewer(container, {
          id,
          elements: elementKey.split(',') as ElementId[],
          rarity,
        }, {
          // Рендер сорвался на ходу — возвращаемся к эмодзи.
          onError: () => {
            handle = null
            if (!disposed) setState('fallback')
          },
        })

        if (disposed) {
          handle?.dispose()
          handle = null
          return
        }
        setState(handle ? 'ready' : 'fallback')
      } catch (error) {
        // 3D — украшение, а не условие игры: любая ошибка оставляет эмодзи.
        console.info('[model] Витрина существа недоступна:', error)
        if (!disposed) setState('fallback')
      }
    }

    void mount()

    return () => {
      disposed = true
      handle?.dispose()
      handle = null
    }
  }, [id, rarity, elementKey])

  return (
    <div
      className={`creature-model creature-model-${state}`}
      ref={mountRef}
      role="img"
      aria-label={`Модель существа ${name}`}
    >
      {state !== 'ready' && (
        <span className="modal-creature-emoji creature-model-emoji" aria-hidden="true">{emoji}</span>
      )}
      {state === 'ready' && (
        <span className="creature-model-hint" aria-hidden="true">Модель вращается — рассматривайте со всех сторон</span>
      )}
    </div>
  )
}
