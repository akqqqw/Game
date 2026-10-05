/**
 * Стихии существ.
 *
 * Стихия связывает коллекцию с жилищами (этап улучшения игры): каждое жилище
 * подходит определённым стихиям, и живущие в нём существа дают больший бонус.
 * Существо может принадлежать сразу к двум стихиям — так появляются гибриды,
 * которые «дома» в двух жилищах.
 */

export type ElementId = 'nature' | 'water' | 'fire' | 'stone' | 'sky' | 'crystal'

export type ElementDefinition = {
  id: ElementId
  /** Название в винительном падеже для подписей вида «подходит для …». */
  name: string
  emoji: string
}

export const elements: Record<ElementId, ElementDefinition> = {
  nature: { id: 'nature', name: 'природы', emoji: '🌿' },
  water: { id: 'water', name: 'воды', emoji: '💧' },
  fire: { id: 'fire', name: 'огня', emoji: '🔥' },
  stone: { id: 'stone', name: 'камня', emoji: '🪨' },
  sky: { id: 'sky', name: 'неба', emoji: '☁️' },
  crystal: { id: 'crystal', name: 'кристалла', emoji: '💎' },
}

export const elementIds: ElementId[] = ['nature', 'water', 'fire', 'stone', 'sky', 'crystal']

export function isElementId(value: unknown): value is ElementId {
  return typeof value === 'string' && (elementIds as string[]).includes(value)
}

/** «огонь и камень» — для подписей и намёков. */
export function elementPhrase(ids: ElementId[]): string {
  const names = ids.map((id) => elements[id].name)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}

/** Строка с эмодзи стихий: «🔥 🪨». */
export function elementEmoji(ids: ElementId[]): string {
  return ids.map((id) => elements[id].emoji).join(' ')
}
