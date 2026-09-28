import { describe, expect, it } from 'vitest'
import {
  SAVE_VERSION,
  createNewSave,
  isEmptyProgress,
  normalizeSave,
  progressScore,
} from '../../src/game/saveSchema'
import { makeSave } from '../helpers/fakeSdk'

describe('нормализация сохранения', () => {
  it('приводит старое сохранение без версии к актуальной схеме', () => {
    const legacy = {
      energy: 250,
      clickPower: 3,
      clickUpgradeCost: 60,
      savedAt: 1_700_000_000_000,
      ownedCreatures: { mossling: 1 },
      unlockedAchievements: ['first-click'],
      totalClicks: 12,
    }

    const save = normalizeSave(legacy)

    expect(save).not.toBeNull()
    expect(save?.version).toBe(SAVE_VERSION)
    expect(save?.energy).toBe(250)
    expect(save?.clickPower).toBe(3)
    expect(save?.energyPerSecond).toBe(1)
    expect(save?.sunwellCost).toBe(75)
    expect(save?.stars).toBe(0)
    expect(save?.dailyTasks).toEqual([])
    expect(save?.savedAt).toBe(1_700_000_000_000)
  })

  it('отбрасывает данные, не похожие на сохранение игры', () => {
    expect(normalizeSave(null)).toBeNull()
    expect(normalizeSave('строка')).toBeNull()
    expect(normalizeSave(42)).toBeNull()
    expect(normalizeSave([])).toBeNull()
    expect(normalizeSave({})).toBeNull()
    expect(normalizeSave({ achievements: ['x'], name: 'игрок' })).toBeNull()
  })

  it('чинит повреждённые числа вместо падения', () => {
    const save = normalizeSave(makeSave({
      energy: Number.NaN,
      clickPower: Number.POSITIVE_INFINITY,
      clickUpgradeCost: -50,
      sunwellLevel: 2.7,
      stars: '10',
      eggInventory: Number.NEGATIVE_INFINITY,
      totalClicks: -3,
    }))

    expect(save?.energy).toBe(0)
    expect(save?.clickPower).toBe(1)
    expect(save?.clickUpgradeCost).toBe(1)
    expect(save?.sunwellLevel).toBe(2)
    expect(save?.stars).toBe(0)
    expect(save?.eggInventory).toBe(0)
    expect(save?.totalClicks).toBe(0)
  })

  it('удаляет неизвестных существ и достижения', () => {
    const save = normalizeSave(makeSave({
      ownedCreatures: { mossling: 2, 'unknown-creature': 5, dewfin: 0, glowmole: -1 },
      lastHatchedId: 'unknown-creature',
      unlockedAchievements: ['first-click', 'unknown-achievement', 'first-click'],
    }))

    expect(save?.ownedCreatures).toEqual({ mossling: 2 })
    expect(save?.lastHatchedId).toBeNull()
    expect(save?.unlockedAchievements).toEqual(['first-click'])
  })

  it('проверяет ежедневные задания', () => {
    const save = normalizeSave(makeSave({
      dailyTasks: [
        { id: '2026-09-28-earn_energy', kind: 'earn_energy', title: 'Заработать энергии', target: 100, progress: 40, rewardStars: 12, rewardEggs: 0, claimed: false },
        { id: 'broken', kind: 'unknown_kind', title: 'Что-то', target: 1, progress: 0 },
        { kind: 'open_eggs', title: 'Без id' },
      ],
    }))

    expect(save?.dailyTasks).toHaveLength(1)
    expect(save?.dailyTasks[0]).toMatchObject({ id: '2026-09-28-earn_energy', progress: 40 })
  })

  it('определяет пустой и непустой прогресс', () => {
    expect(isEmptyProgress(createNewSave())).toBe(true)
    expect(isEmptyProgress(normalizeSave(makeSave())!)).toBe(false)
    expect(progressScore(normalizeSave(makeSave())!)).toBeGreaterThan(0)
  })
})
