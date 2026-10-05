import { describe, expect, it } from 'vitest'
import { normalizeSave } from '../../src/game/saveSchema'
import { resolveSaveConflict } from '../../src/game/saveMerge'
import { makeSave } from '../helpers/fakeSdk'

function save(overrides: Record<string, unknown>) {
  const normalized = normalizeSave(makeSave(overrides))
  if (!normalized) throw new Error('тестовое сохранение не прошло нормализацию')
  return normalized
}

describe('разрешение конфликта сохранений', () => {
  it('возвращает null, если сохранений нет вообще', () => {
    expect(resolveSaveConflict(null, null)).toBeNull()
  })

  it('выбирает более свежее облачное сохранение и сохраняет локальное в резерв', () => {
    const local = save({ savedAt: 1_000, energy: 100 })
    const cloud = save({ savedAt: 5_000, energy: 900 })

    const result = resolveSaveConflict(local, cloud)

    expect(result?.source).toBe('cloud')
    expect(result?.save.energy).toBe(900)
    expect(result?.backup?.energy).toBe(100)
    expect(result?.notice).toContain('облак')
  })

  it('оставляет локальное сохранение, если оно свежее, и кладёт облачное в резерв', () => {
    const local = save({ savedAt: 9_000, energy: 700 })
    const cloud = save({ savedAt: 5_000, energy: 900 })

    const result = resolveSaveConflict(local, cloud)

    expect(result?.source).toBe('local')
    expect(result?.save.energy).toBe(700)
    expect(result?.backup?.energy).toBe(900)
    expect(result?.notice).toContain('облако')
  })

  it('не перезаписывает прогресс пустым облачным сохранением', () => {
    const local = save({ savedAt: 1_000, energy: 500 })
    const emptyCloud = normalizeSave({
      version: 2,
      energy: 0,
      clickPower: 1,
      energyPerSecond: 1,
      clickUpgradeCost: 25,
      savedAt: 9_999_999,
    })!

    const result = resolveSaveConflict(local, emptyCloud)

    expect(result?.source).toBe('local')
    expect(result?.save.energy).toBe(500)
    expect(result?.notice).toContain('Пустое облачное сохранение')
  })

  it('загружает облачный прогресс, если локального ещё нет', () => {
    const cloud = save({ savedAt: 5_000, energy: 900 })

    const result = resolveSaveConflict(null, cloud)

    expect(result?.source).toBe('cloud')
    expect(result?.save.energy).toBe(900)
    expect(result?.backup).toBeNull()
  })

  it('отдаёт локальное сохранение, если облако пустое и локальное пустое', () => {
    const local = normalizeSave(makeSave({ energy: 0, totalClicks: 0, totalEnergyEarned: 0, eggsOpened: 0, upgradesBought: 0, stars: 0, eggInventory: 0, ownedCreatures: {}, savedAt: 100 }))!
    const cloud = normalizeSave(makeSave({ energy: 0, totalClicks: 0, totalEnergyEarned: 0, eggsOpened: 0, upgradesBought: 0, stars: 0, eggInventory: 0, ownedCreatures: {}, savedAt: 900 }))!

    const result = resolveSaveConflict(local, cloud)

    expect(result?.source).toBe('new')
    expect(result?.save.savedAt).toBe(900)
    expect(result?.backup).toBeNull()
  })
})
