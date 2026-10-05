import { describe, expect, it } from 'vitest'
import { fusionRecipes } from '../../src/game/fusion'
import { createEmptyHabitats } from '../../src/game/habitats'
import {
  SAVE_VERSION,
  createNewSave,
  isEmptyProgress,
  normalizeSave,
  progressScore,
} from '../../src/game/saveSchema'
import { makeSave } from '../helpers/fakeSdk'

describe('миграция к версии 3 (слияния, мутации, жилища)', () => {
  it('сохранение версии 2 доезжает до актуальной схемы без потери прогресса', () => {
    const legacy = makeSave({
      energy: 4321,
      clickPower: 17,
      ownedCreatures: { mossling: 3, emberfox: 2 },
      stars: 40,
      eggsOpened: 7,
      unlockedAchievements: ['first-click', 'first-egg'],
      dailyTasks: [],
    })

    const save = normalizeSave(legacy)

    expect(save).not.toBeNull()
    expect(save?.version).toBe(SAVE_VERSION)
    // Прогресс прошлых версий сохранён.
    expect(save?.energy).toBe(4321)
    expect(save?.clickPower).toBe(17)
    expect(save?.ownedCreatures).toEqual({ mossling: 3, emberfox: 2 })
    expect(save?.stars).toBe(40)
    expect(save?.eggsOpened).toBe(7)
    expect(save?.unlockedAchievements).toEqual(['first-click', 'first-egg'])
    // Новые поля появились со значениями по умолчанию.
    expect(save?.mutations).toEqual({})
    expect(save?.discoveredRecipes).toEqual([])
    expect(save?.fusionsDone).toBe(0)
    expect(save?.habitats).toEqual(createEmptyHabitats())
  })

  it('очень старое сохранение (без версии) мигрирует через все шаги', () => {
    const save = normalizeSave({
      energy: 250,
      clickPower: 3,
      clickUpgradeCost: 60,
      ownedCreatures: { dewfin: 1 },
      savedAt: 1_700_000_000_000,
    })

    expect(save?.version).toBe(SAVE_VERSION)
    expect(save?.energy).toBe(250)
    expect(save?.energyPerSecond).toBe(1)
    expect(save?.habitats.forest.level).toBe(0)
  })

  it('нормализация идемпотентна: актуальное сохранение не меняется', () => {
    const first = normalizeSave(makeSave({
      mutations: { mossling: 1 },
      habitats: { forest: { level: 2, residents: ['mossling'] } },
      discoveredRecipes: ['magmagolem'],
      fusionsDone: 4,
    }))
    const second = normalizeSave(first)

    expect(second).toEqual(first)
  })
})

describe('мутации в сохранении', () => {
  it('мутировавших копий не может быть больше, чем самих копий', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: { mossling: 2, dewfin: 1 },
      mutations: { mossling: 5, dewfin: 1 },
    }))

    expect(save?.mutations).toEqual({ mossling: 2, dewfin: 1 })
  })

  it('неизвестные виды и мусор отбрасываются', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: { mossling: 1 },
      mutations: { mossling: 1, 'нет-такого': 3, '-1': 2 },
    }))

    expect(save?.mutations).toEqual({ mossling: 1 })
  })

  it('мутация не может существовать без самой копии', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: {},
      mutations: { emberfox: 2 },
    }))

    expect(save?.mutations).toEqual({})
  })

  it('отрицательные и дробные значения чинятся', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: { mossling: 3 },
      mutations: { mossling: -4 },
    }))

    expect(save?.mutations).toEqual({})
  })
})

describe('жилища в сохранении', () => {
  it('уровни и жильцы ограничиваются правилами игры', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: { mossling: 1, emberfox: 1, cloudram: 1 },
      habitats: {
        forest: { level: 9, residents: ['mossling', 'emberfox'] },
        volcano: { level: 1, residents: ['emberfox'] },
        cloud: { level: 2, residents: ['cloudram', 'нет-такого'] },
      },
    }))

    const habitats = save?.habitats
    expect(habitats?.forest.level).toBe(5)
    // Emberfox занят рощей — в вулкане он не дублируется.
    expect(habitats?.forest.residents).toEqual(['mossling', 'emberfox'])
    expect(habitats?.volcano.residents).toEqual([])
    expect(habitats?.cloud.residents).toEqual(['cloudram'])
    expect(habitats?.crystal.level).toBe(0)
  })

  it('жильцы без копий в коллекции выселяются при загрузке', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: { mossling: 1 },
      habitats: { forest: { level: 3, residents: ['mossling', 'emberfox'] } },
    }))

    expect(save?.habitats.forest.residents).toEqual(['mossling'])
    expect(save?.habitats.forest.level).toBe(3)
  })

  it('мусор вместо жилищ не ломает загрузку и не считается прогрессом', () => {
    const save = normalizeSave(makeSave({ habitats: 'сломано' }))
    expect(save?.habitats).toEqual(createEmptyHabitats())
  })
})

describe('открытые рецепты в сохранении', () => {
  it('сохраняются только существующие рецепты и без повторов', () => {
    const known = fusionRecipes[0].id
    const save = normalizeSave(makeSave({
      discoveredRecipes: [known, known, 'нет-такого-рецепта'],
    }))

    expect(save?.discoveredRecipes).toEqual([known])
  })

  it('число слияний чинится из мусора', () => {
    expect(normalizeSave(makeSave({ fusionsDone: -5 }))?.fusionsDone).toBe(0)
    expect(normalizeSave(makeSave({ fusionsDone: 'много' }))?.fusionsDone).toBe(0)
    expect(normalizeSave(makeSave({ fusionsDone: 12.7 }))?.fusionsDone).toBe(12)
  })
})

describe('оценка прогресса с новыми механиками', () => {
  it('новое сохранение считается пустым', () => {
    expect(isEmptyProgress(createNewSave())).toBe(true)
  })

  it('жилище, мутация, слияние или открытый рецепт — это уже прогресс', () => {
    const base = createNewSave()

    expect(isEmptyProgress({ ...base, habitats: { ...base.habitats, forest: { level: 1, residents: [] } } })).toBe(false)
    expect(isEmptyProgress({ ...base, mutations: { mossling: 1 }, ownedCreatures: { mossling: 1 } })).toBe(false)
    expect(isEmptyProgress({ ...base, fusionsDone: 1 })).toBe(false)
    expect(isEmptyProgress({ ...base, discoveredRecipes: [fusionRecipes[0].id] })).toBe(false)
  })

  it('слияния, мутации и жилища повышают оценку продвинутости', () => {
    const plain = createNewSave()
    const rich = normalizeSave(makeSave({
      fusionsDone: 5,
      mutations: { mossling: 1 },
      ownedCreatures: { mossling: 2 },
      discoveredRecipes: [fusionRecipes[0].id],
      habitats: { forest: { level: 3, residents: ['mossling'] } },
    }))

    expect(rich).not.toBeNull()
    expect(progressScore(rich!)).toBeGreaterThan(progressScore(plain))
  })
})
