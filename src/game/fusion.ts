/**
 * Слияние существ и мутации.
 *
 * Правило простое: любые два существа (в том числе две копии одного вида)
 * можно попробовать соединить. Рецепт фиксирован — порядок родителей не важен.
 *
 *  - Обычные рецепты видны сразу: игрок понимает, что получится.
 *  - Секретные рецепты (`secret: true`) скрыты: до первого успешного слияния
 *    результат показывается как «???», а существо — силуэтом в коллекции.
 *  - Мутация (случайный шанс) даёт мутировавшую копию: она выглядит иначе и
 *    удваивает бонус вида. Мутация возможна и при вылуплении из яйца, и при
 *    слиянии, но при слиянии шанс выше.
 */

import { fusionCostFor } from './balance'
import { getCreature } from './creatures'
import type { ElementId } from './elements'
import { elementPhrase } from './elements'

export type FusionRecipe = {
  /** Идентификатор рецепта — совпадает с id существа-результата. */
  id: string
  /** Родители: порядок не важен. */
  ingredients: [string, string]
  /** Кто получается. */
  result: string
  /** Стоимость в энергии. */
  cost: number
  /** Скрытый рецепт: результат не показывается до первого слияния. */
  secret?: boolean
}

/** Шанс мутации при вылуплении из яйца. */
export const MUTATION_CHANCE_EGG = 0.08

/** Шанс мутации при слиянии — эксперименты чаще приводят к сюрпризам. */
export const MUTATION_CHANCE_FUSION = 0.22

export const fusionRecipes: FusionRecipe[] = [
  // Обычные рецепты: доступны сразу.
  {
    id: 'mosswarden',
    ingredients: ['mossling', 'stonegolem'],
    result: 'mosswarden',
    cost: 250,
  },
  {
    id: 'tidelotus',
    ingredients: ['dewfin', 'petalimp'],
    result: 'tidelotus',
    cost: 250,
  },
  {
    id: 'frostfin',
    ingredients: ['dewfin', 'cloudram'],
    result: 'frostfin',
    cost: 350,
  },
  {
    id: 'magmagolem',
    ingredients: ['emberfox', 'stonegolem'],
    result: 'magmagolem',
    cost: 400,
  },
  {
    id: 'thornbeast',
    ingredients: ['thornling', 'thornling'],
    result: 'thornbeast',
    cost: 500,
  },
  {
    id: 'crystalwing',
    ingredients: ['reefowl', 'glowmole'],
    result: 'crystalwing',
    cost: 700,
  },
  {
    id: 'sunspirit',
    ingredients: ['starseed', 'emberfox'],
    result: 'sunspirit',
    cost: 800,
  },
  {
    id: 'stormhart',
    ingredients: ['cloudram', 'moonhart'],
    result: 'stormhart',
    cost: 900,
  },

  // Секретные рецепты: результат скрыт до первого слияния.
  {
    id: 'worldtree',
    ingredients: ['mosswarden', 'sunspirit'],
    result: 'worldtree',
    cost: 2500,
    secret: true,
  },
  {
    id: 'tidelord',
    ingredients: ['tidelotus', 'frostfin'],
    result: 'tidelord',
    cost: 2800,
    secret: true,
  },
  {
    id: 'voidphoenix',
    ingredients: ['magmagolem', 'stormhart'],
    result: 'voidphoenix',
    cost: 3000,
    secret: true,
  },
  {
    id: 'prismdragon',
    ingredients: ['crystalwing', 'magmagolem'],
    result: 'prismdragon',
    cost: 3500,
    secret: true,
  },
]

/** Ключ рецепта: пара родителей без учёта порядка. */
export function recipeKey(a: string, b: string): string {
  return [a, b].sort().join('+')
}

const recipeIndex = new Map(fusionRecipes.map((recipe) => [recipeKey(...recipe.ingredients), recipe]))

/** Находит рецепт для пары родителей (порядок не важен). */
export function findRecipe(a: string, b: string): FusionRecipe | undefined {
  return recipeIndex.get(recipeKey(a, b))
}

/** Рецепты, где существо участвует как родитель. */
export function recipesUsing(creatureId: string): FusionRecipe[] {
  return fusionRecipes.filter((recipe) => recipe.ingredients.includes(creatureId))
}

/** Рецепт, которым получается существо. */
export function recipeForResult(creatureId: string): FusionRecipe | undefined {
  return fusionRecipes.find((recipe) => recipe.id === creatureId)
}

export type FusionPreview = {
  recipe: FusionRecipe
  /** Скрыт ли результат: секретный рецепт, который игрок ещё не открыл. */
  hidden: boolean
  /** Стихии результата — для намёка, когда результат скрыт. */
  elements: ElementId[]
  /** Родители нужны ли игроку ещё раз (сколько копий у него есть). */
  parents: { id: string; name: string; emoji: string; owned: number }[]
  affordable: boolean
}

/**
 * Готовит данные для предпросмотра слияния: что получится, хватает ли энергии
 * и сколько копий родителей есть в коллекции.
 */
export function previewFusion(
  a: string,
  b: string,
  options: { discoveredRecipes: string[]; ownedCreatures: Record<string, number>; energy: number },
): FusionPreview | null {
  const recipe = findRecipe(a, b)
  if (!recipe) return null

  const result = getCreature(recipe.result)
  const parents = recipe.ingredients.map((id) => {
    const creature = getCreature(id)
    return {
      id,
      name: creature?.name ?? id,
      emoji: creature?.emoji ?? '❔',
      owned: options.ownedCreatures[id] ?? 0,
    }
  })

  return {
    recipe,
    hidden: Boolean(recipe.secret) && !options.discoveredRecipes.includes(recipe.id),
    elements: result?.elements ?? [],
    parents,
    affordable: options.energy >= fusionCostFor(recipe.cost),
  }
}

/** Подпись «что нужно» для скрытого рецепта. */
export function secretRecipeHint(recipe: FusionRecipe): string {
  const result = getCreature(recipe.result)
  const parentNames = recipe.ingredients
    .map((id) => getCreature(id)?.name ?? id)
    .join(' + ')
  const elements = result ? elementPhrase(result.elements) : ''
  return elements
    ? `Секрет стихии ${elements}. Родители: ${parentNames}.`
    : `Секрет. Родители: ${parentNames}.`
}
