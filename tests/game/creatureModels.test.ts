import { describe, expect, it } from 'vitest'
import {
  buildModelRecipe,
  creatureModelFiles,
  creatureModelUrl,
  hasModelFile,
} from '../../src/game/creatureModels'
import { creatures } from '../../src/game/creatures'
import { elementIds } from '../../src/game/elements'

describe('рецепт модели существа', () => {
  it('собирается для каждого существа игры и не содержит мусора', () => {
    for (const creature of creatures) {
      const recipe = buildModelRecipe(creature)

      expect(recipe.id).toBe(creature.id)
      expect(recipe.features.length).toBeGreaterThan(0)
      expect(recipe.bodyScale.every((value) => Number.isFinite(value) && value > 0)).toBe(true)
      expect(recipe.spin).toBeGreaterThan(0)
      expect(recipe.spin).toBeLessThan(1)
      expect(recipe.float).toBeGreaterThan(0)
      expect(recipe.float).toBeLessThan(0.2)
      expect(recipe.breath).toBeGreaterThan(0)
      expect(recipe.breath).toBeLessThan(0.2)
      expect(recipe.glowStrength).toBeGreaterThanOrEqual(0)
      expect(recipe.glowStrength).toBeLessThanOrEqual(1)
      for (const color of Object.values(recipe.colors)) {
        expect(Number.isInteger(color)).toBe(true)
        expect(color).toBeGreaterThanOrEqual(0)
        expect(color).toBeLessThanOrEqual(0xffffff)
      }
    }
  })

  it('детерминирован: одно существо выглядит одинаково при каждом открытии', () => {
    const creature = creatures[0]
    expect(buildModelRecipe(creature)).toEqual(buildModelRecipe(creature))
  })

  it('разные существа отличаются пропорциями и поворотом', () => {
    const first = buildModelRecipe(creatures[0])
    const second = buildModelRecipe(creatures[1])
    expect(first.bodyScale).not.toEqual(second.bodyScale)
  })

  it('стихия определяет форму тела и палитру', () => {
    const nature = buildModelRecipe({ id: 'a', elements: ['nature'], rarity: 'Common' })
    const fire = buildModelRecipe({ id: 'a', elements: ['fire'], rarity: 'Common' })

    expect(nature.body).not.toBe(fire.body)
    expect(nature.colors.body).not.toBe(fire.colors.body)
    expect(nature.features.some((feature) => feature.kind === 'fins')).toBe(true)
    expect(fire.features.some((feature) => feature.kind === 'spikes')).toBe(true)
  })

  it('гибрид смешивает палитры родителей', () => {
    const water = buildModelRecipe({ id: 'a', elements: ['water'], rarity: 'Common' })
    const hybrid = buildModelRecipe({ id: 'a', elements: ['water', 'fire'], rarity: 'Common' })
    const fire = buildModelRecipe({ id: 'a', elements: ['fire'], rarity: 'Common' })

    expect(hybrid.colors.body).not.toBe(water.colors.body)
    expect(hybrid.colors.body).not.toBe(fire.colors.body)
    // Украшения обеих стихий: плавники воды и шипы огня.
    expect(hybrid.features.some((feature) => feature.kind === 'fins')).toBe(true)
    expect(hybrid.features.some((feature) => feature.kind === 'spikes')).toBe(true)
  })

  it('редкость добавляет украшения и свечение', () => {
    const common = buildModelRecipe({ id: 'a', elements: ['sky'], rarity: 'Common' })
    const rare = buildModelRecipe({ id: 'a', elements: ['sky'], rarity: 'Rare' })
    const mythic = buildModelRecipe({ id: 'a', elements: ['sky'], rarity: 'Mythic' })

    expect(common.features.some((feature) => feature.kind === 'crown')).toBe(false)
    expect(rare.features.some((feature) => feature.kind === 'crown')).toBe(true)
    expect(mythic.features.some((feature) => feature.kind === 'aura')).toBe(true)
    expect(mythic.glowStrength).toBeGreaterThan(rare.glowStrength)
    expect(rare.glowStrength).toBeGreaterThan(common.glowStrength)
  })

  it('одно украшение не повторяется дважды', () => {
    for (const creature of creatures) {
      const kinds = buildModelRecipe(creature).features.map((feature) => feature.kind)
      expect(new Set(kinds).size).toBe(kinds.length)
    }
  })

  it('каждая стихия даёт свою форму тела', () => {
    const bodies = elementIds.map((id) => buildModelRecipe({ id: `x-${id}`, elements: [id], rarity: 'Common' }).body)
    expect(new Set(bodies).size).toBeGreaterThanOrEqual(4)
  })
})

describe('файлы моделей', () => {
  it('пока ни одного файла — все существа процедурные', () => {
    expect(creatureModelFiles).toHaveLength(0)
    expect(hasModelFile('mossling')).toBe(false)
  })

  it('адрес файла собирается относительно страницы, а не корня сайта', () => {
    const url = creatureModelUrl('mossling')
    expect(url).toContain('models/creatures/mossling.glb')
    expect(url.startsWith(window.location.href.slice(0, 4))).toBe(true)
  })
})
