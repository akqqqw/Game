/**
 * Рецепт внешнего вида существа — данные, из которых строится 3D-модель.
 *
 * Здесь нет ни строчки three.js: модуль чистый и тестируется без WebGL. Он
 * превращает существо (id, стихии, редкость) в детерминированный «рецепт»:
 * форма тела, цвета, украшения, характер вращения. Из рецепта собирается меш
 * (`creatureMesh.ts`), а показывает его витрина (`creatureViewer.ts`).
 *
 * Детерминированность важна по двум причинам:
 *  - одно и то же существо в карточке выглядит одинаково при каждом открытии;
 *  - тесты могут проверять рецепты, не сравнивая пиксели.
 *
 * Если для существа есть готовая модель в Blender (`.glb`), она имеет приоритет:
 * файл подключается по имени существа (см. `creatureModelFiles` и
 * `docs/creature-models.md`). Процедурный рецепт остаётся запасным вариантом,
 * поэтому игра выглядит цельно даже с одной-двумя готовыми моделями.
 */

import type { ElementId } from './elements'
import type { Rarity } from './creatures'

/** Форма тела — простые примитивы: их достаточно, чтобы силуэт был узнаваем. */
export type BodyShape =
  | 'sphere'
  | 'capsule'
  | 'icosahedron'
  | 'octahedron'
  | 'dodecahedron'
  | 'cone'

/** Украшения, которые надстраиваются над телом. */
export type ModelFeatureKind =
  | 'spikes'
  | 'fins'
  | 'wings'
  | 'crystals'
  | 'crown'
  | 'tail'
  | 'ears'
  | 'aura'

export type ModelFeature = {
  kind: ModelFeatureKind
  /** Сколько элементов рисовать (для парных украшений — чётное число). */
  count: number
  /** Относительный размер украшения. */
  size: number
}

export type ModelRecipe = {
  id: string
  body: BodyShape
  /** Пропорции тела: [ширина, высота, глубина]. */
  bodyScale: [number, number, number]
  colors: {
    /** Основной цвет тела. */
    body: number
    /** Цвет украшений и лап. */
    accent: number
    /** Цвет свечения (глаза, кристаллы, аура). */
    glow: number
  }
  features: ModelFeature[]
  /** Скорость вращения в витрине, радиан в секунду. */
  spin: number
  /** Амплитуда покачивания вверх-вниз (в единицах модели). */
  float: number
  /** Амплитуда «дыхания» — лёгкого изменения высоты тела. */
  breath: number
  /** Насколько сильно модель светится: 0 — обычное существо, 1 — мифическое. */
  glowStrength: number
}

type Palette = { body: number; accent: number; glow: number }

/**
 * Палитры стихий. Держим их согласованными с палитрой острова: изумрудная
 * листва, бирюзовая вода, тёплый огонь, серый камень, светлое небо, фиолетовый
 * кристалл.
 */
const elementPalettes: Record<ElementId, Palette> = {
  nature: { body: 0x3f8f52, accent: 0x8fd06a, glow: 0xd8f27a },
  water: { body: 0x2f7fb0, accent: 0x63cfe0, glow: 0xbff2ff },
  fire: { body: 0xc2472a, accent: 0xf2a04b, glow: 0xffd97a },
  stone: { body: 0x6f6a63, accent: 0xa89a86, glow: 0xe4d6bd },
  sky: { body: 0x6fa6d8, accent: 0xcfe6ff, glow: 0xffffff },
  crystal: { body: 0x6f5bb5, accent: 0xa78bf0, glow: 0xd6c6ff },
}

/** Форма тела по основной стихии. */
const elementBodies: Record<ElementId, BodyShape> = {
  nature: 'sphere',
  water: 'capsule',
  fire: 'icosahedron',
  stone: 'dodecahedron',
  sky: 'sphere',
  crystal: 'octahedron',
}

/** Базовые украшения по стихии: силуэт сразу читается. */
const elementFeatures: Record<ElementId, ModelFeature[]> = {
  nature: [{ kind: 'fins', count: 4, size: 0.5 }],
  water: [{ kind: 'fins', count: 4, size: 0.42 }, { kind: 'tail', count: 1, size: 0.55 }],
  fire: [{ kind: 'spikes', count: 5, size: 0.32 }],
  stone: [{ kind: 'crystals', count: 3, size: 0.3 }],
  sky: [{ kind: 'wings', count: 2, size: 0.85 }],
  crystal: [{ kind: 'crystals', count: 5, size: 0.42 }],
}

/**
 * Редкость добавляет украшения: обычным существам обычно достаточно стихии,
 * редкие получают «корону», мифические — ещё и ауру.
 */
const rarityFeatures: Record<Rarity, ModelFeature[]> = {
  Common: [],
  Rare: [{ kind: 'crown', count: 1, size: 0.34 }],
  Mythic: [{ kind: 'crown', count: 1, size: 0.42 }, { kind: 'aura', count: 1, size: 1.28 }],
}

/** Редкие и мифические существа крупнее и заметнее светятся. */
const rarityScale: Record<Rarity, number> = { Common: 1, Rare: 1.06, Mythic: 1.14 }
const rarityGlow: Record<Rarity, number> = { Common: 0.15, Rare: 0.45, Mythic: 0.8 }

/** FNV-1a: короткий детерминированный хеш от id существа. */
function hashId(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Генератор псевдослучайных чисел с зерном: последовательность воспроизводима. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Смешивает два цвета: 0 — первый, 1 — второй. */
function mixColor(from: number, to: number, ratio: number): number {
  const r = Math.round((((from >> 16) & 0xff) * (1 - ratio)) + (((to >> 16) & 0xff) * ratio))
  const g = Math.round((((from >> 8) & 0xff) * (1 - ratio)) + (((to >> 8) & 0xff) * ratio))
  const b = Math.round(((from & 0xff) * (1 - ratio)) + ((to & 0xff) * ratio))
  return (r << 16) | (g << 8) | b
}

/**
 * Палитра существа: одна стихия — её палитра, две — смесь.
 * Гибриды получают промежуточные цвета, поэтому не выглядят копиями родителей.
 */
function paletteFor(elements: ElementId[]): Palette {
  const primary = elementPalettes[elements[0] ?? 'nature']
  const secondary = elements[1] ? elementPalettes[elements[1]] : undefined
  if (!secondary) return primary

  return {
    body: mixColor(primary.body, secondary.body, 0.45),
    accent: mixColor(primary.accent, secondary.accent, 0.5),
    glow: mixColor(primary.glow, secondary.glow, 0.5),
  }
}

/** Украшения: стихия + редкость, без повторов одного вида. */
function featuresFor(elements: ElementId[], rarity: Rarity): ModelFeature[] {
  const primary = elementFeatures[elements[0] ?? 'nature']
  const secondary = elements[1] ? elementFeatures[elements[1]] : []
  const seen = new Set<ModelFeatureKind>()
  const result: ModelFeature[] = []

  for (const feature of [...primary, ...secondary, ...rarityFeatures[rarity]]) {
    if (seen.has(feature.kind)) continue
    seen.add(feature.kind)
    result.push({ ...feature })
  }

  // Уши — маленькая, но выразительная деталь: только у обычных существ,
  // чтобы редкие отличались короной, а не «ёжиком» из украшений.
  if (rarity === 'Common') result.push({ kind: 'ears', count: 2, size: 0.26 })
  return result
}

/**
 * Собирает рецепт модели существа.
 * Одинаковый вход — всегда одинаковый выход.
 */
export function buildModelRecipe(input: {
  id: string
  elements: ElementId[]
  rarity: Rarity
}): ModelRecipe {
  const random = seededRandom(hashId(input.id))
  const palette = paletteFor(input.elements)
  const scale = rarityScale[input.rarity]
  const primary: ElementId = input.elements[0] ?? 'nature'

  // Небольшой детерминированный разброс пропорций: существа одного вида не
  // выглядят «штампованными», но остаются узнаваемыми.
  const bodyScale: [number, number, number] = [
    (0.92 + random() * 0.2) * scale,
    (0.88 + random() * 0.24) * scale,
    (0.92 + random() * 0.2) * scale,
  ]

  return {
    id: input.id,
    body: elementBodies[primary],
    bodyScale,
    colors: palette,
    features: featuresFor(input.elements, input.rarity),
    spin: 0.3 + random() * 0.35,
    float: 0.03 + random() * 0.05,
    breath: 0.012 + random() * 0.02,
    glowStrength: rarityGlow[input.rarity],
  }
}

/**
 * Существа, для которых уже есть готовая модель из Blender.
 * Файлы лежат в `public/models/creatures/<id>.glb`; добавить новую модель —
 * положить файл и дописать id в этот список (см. `docs/creature-models.md`).
 * Пусто — значит все существа пока рисуются процедурно.
 */
export const creatureModelFiles: readonly string[] = [
  'mossling',
  'dewfin',
  'petalimp',
  'glowmole',
  'thornling',
  'stonegolem',
  'emberfox',
  'cloudram',
  'reefowl',
  'starseed',
  'moonhart',
  'magmagolem',
  'mosswarden',
  'tidelotus',
  'frostfin',
  '',
  '',
  '',
]

/** Есть ли для существа готовая модель-файл. */
export function hasModelFile(id: string): boolean {
  return creatureModelFiles.includes(id)
}

/**
 * Адрес файла модели. Путь относительный (`document.baseURI`), чтобы работать и
 * на локальном сервере, и в архиве Яндекс Игр, где страница может лежать в
 * подкаталоге.
 */
export function creatureModelUrl(id: string): string {
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
  return new URL(`models/creatures/${id}.glb`, base).href
}
