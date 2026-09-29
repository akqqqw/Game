import { describe, expect, it } from 'vitest'
import { fusionCostFor } from '../../src/game/balance'
import {
  creatures,
  eggPool,
  eggWeightTotal,
  getCreature,
  regularCreatures,
  secretCreatures,
} from '../../src/game/creatures'
import {
  MUTATION_CHANCE_EGG,
  MUTATION_CHANCE_FUSION,
  findRecipe,
  fusionRecipes,
  previewFusion,
  recipeKey,
  recipeForResult,
  recipesUsing,
  secretRecipeHint,
} from '../../src/game/fusion'

describe('бестиарий', () => {
  it('веса яиц в сумме дают ровно 100', () => {
    expect(eggWeightTotal).toBe(100)
    expect(eggPool.every((creature) => creature.weight > 0)).toBe(true)
  })

  it('секретные существа из яиц не выпадают', () => {
    expect(secretCreatures.length).toBeGreaterThan(0)
    for (const secret of secretCreatures) {
      expect(secret.weight).toBe(0)
      expect(secret.secret).toBe(true)
      expect(eggPool.some((creature) => creature.id === secret.id)).toBe(false)
    }
  })

  it('каменный голем есть в яйцах — он нужен для первого рецепта, который видит игрок', () => {
    const golem = getCreature('stonegolem')
    expect(golem).toBeDefined()
    expect(golem?.elements).toContain('stone')
    expect(eggPool.some((creature) => creature.id === 'stonegolem')).toBe(true)
  })

  it('у каждого существа есть хотя бы одна стихия и положительные характеристики', () => {
    for (const creature of creatures) {
      expect(creature.elements.length).toBeGreaterThan(0)
      expect(creature.clickBonus).toBeGreaterThan(0)
      expect(creature.name.length).toBeGreaterThan(0)
      expect(creature.emoji.length).toBeGreaterThan(0)
    }
  })
})

describe('рецепты слияний', () => {
  it('каждый рецепт ведёт к существующему виду-результату', () => {
    for (const recipe of fusionRecipes) {
      const result = getCreature(recipe.result)
      expect(result, `нет существа ${recipe.result}`).toBeDefined()
      expect(result?.fusionOnly).toBe(true)
      expect(recipe.cost).toBeGreaterThan(0)
      expect(recipe.ingredients).toHaveLength(2)
    }
  })

  it('родители рецептов существуют в бестиарии', () => {
    for (const recipe of fusionRecipes) {
      for (const ingredient of recipe.ingredients) {
        expect(getCreature(ingredient), `нет родителя ${ingredient}`).toBeDefined()
      }
    }
  })

  it('пара родителей встречается только в одном рецепте', () => {
    const keys = fusionRecipes.map((recipe) => recipeKey(...recipe.ingredients))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('каждое существо слияния достижимо ровно одним рецептом', () => {
    const fusionOnly = creatures.filter((creature) => creature.fusionOnly)
    expect(fusionOnly.length).toBeGreaterThanOrEqual(fusionRecipes.length)
    for (const creature of fusionOnly) {
      expect(recipeForResult(creature.id), `нет рецепта для ${creature.id}`).toBeDefined()
    }
  })

  it('порядок родителей не важен', () => {
    const forward = findRecipe('emberfox', 'stonegolem')
    const backward = findRecipe('stonegolem', 'emberfox')
    expect(forward).toBeDefined()
    expect(forward).toBe(backward)
    expect(forward?.result).toBe('magmagolem')
  })

  it('неизвестная пара не даёт рецепта', () => {
    expect(findRecipe('mossling', 'dewfin')).toBeUndefined()
    expect(findRecipe('mossling', 'нет-такого')).toBeUndefined()
  })

  it('секретные существа получаются только секретными рецептами', () => {
    for (const secret of secretCreatures) {
      const recipe = recipeForResult(secret.id)
      expect(recipe?.secret, `${secret.id} должен быть секретным рецептом`).toBe(true)
    }
  })

  it('рецепты слияний используют существ, доступных игроку', () => {
    // Результаты обычных рецептов тоже становятся родителями — цепочка не рвётся.
    expect(recipesUsing('magmagolem').length).toBeGreaterThan(0)
    expect(recipesUsing('mosswarden').length).toBeGreaterThan(0)
    expect(recipesUsing('mossling').length).toBeGreaterThan(0)
  })

  it('шанс мутации выше при слиянии, чем при вылуплении, и оба вероятностные', () => {
    expect(MUTATION_CHANCE_EGG).toBeGreaterThan(0)
    expect(MUTATION_CHANCE_EGG).toBeLessThan(1)
    expect(MUTATION_CHANCE_FUSION).toBeGreaterThan(MUTATION_CHANCE_EGG)
    expect(MUTATION_CHANCE_FUSION).toBeLessThan(1)
  })
})

describe('предпросмотр слияния', () => {
  const owned = { emberfox: 1, stonegolem: 2 }

  it('обычный рецепт показывает результат', () => {
    const preview = previewFusion('emberfox', 'stonegolem', {
      discoveredRecipes: [],
      ownedCreatures: owned,
      // Ровно цена из баланса: слияние доступно.
      energy: fusionCostFor(findRecipe('emberfox', 'stonegolem')!.cost),
    })

    expect(preview?.hidden).toBe(false)
    expect(preview?.affordable).toBe(true)
    expect(preview?.recipe.result).toBe('magmagolem')
    expect(preview?.parents.map((parent) => parent.owned)).toEqual([1, 2])
  })

  it('не хватает энергии — affordable false, но рецепт виден', () => {
    const preview = previewFusion('emberfox', 'stonegolem', {
      discoveredRecipes: [],
      ownedCreatures: owned,
      energy: 10,
    })

    expect(preview?.hidden).toBe(false)
    expect(preview?.affordable).toBe(false)
  })

  it('секретный рецепт скрыт, пока не открыт, и раскрывается после', () => {
    const secretOwned = { mosswarden: 1, sunspirit: 1 }
    const before = previewFusion('mosswarden', 'sunspirit', {
      discoveredRecipes: [],
      ownedCreatures: secretOwned,
      energy: 5000,
    })
    const after = previewFusion('mosswarden', 'sunspirit', {
      discoveredRecipes: ['worldtree'],
      ownedCreatures: secretOwned,
      energy: 5000,
    })

    expect(before?.hidden).toBe(true)
    expect(before?.recipe.result).toBe('worldtree')
    expect(after?.hidden).toBe(false)
  })

  it('намёк на секрет называет родителей и стихию', () => {
    const recipe = recipeForResult('worldtree')
    expect(recipe).toBeDefined()
    const hint = secretRecipeHint(recipe!)
    expect(hint).toContain('Мшистый страж')
    expect(hint).toContain('Солнечный дух')
    expect(hint).toContain('природы')
  })

  it('для неизвестной пары предпросмотра нет', () => {
    expect(previewFusion('mossling', 'dewfin', { discoveredRecipes: [], ownedCreatures: {}, energy: 0 })).toBeNull()
  })
})

describe('состав бестиария', () => {
  it('обычных видов больше, чем секретных', () => {
    expect(regularCreatures.length).toBe(creatures.length - secretCreatures.length)
    expect(regularCreatures.length).toBeGreaterThan(secretCreatures.length)
  })
})
