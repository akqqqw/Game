import { describe, expect, it } from 'vitest'
import { achievements } from '../../src/game/achievements'
import { createDailyTasks } from '../../src/game/dailyTasks'

/**
 * Бесплатные яйца — редкая награда, а не второй источник существ: основную
 * добычу игрок оплачивает энергией (см. `balance.ts` и `docs/economy-balance.md`).
 * Тест фиксирует это правило, чтобы награды снова не «раздавали» яйца пачками.
 */
describe('источники бесплатных яиц', () => {
  it('достижения дают всего 5 яиц и только за крупные вехи', () => {
    const total = achievements.reduce((sum, achievement) => sum + achievement.rewardEggs, 0)
    expect(total).toBe(5)

    // Яйца остались только у крупных вех: коллекция, слияния, жилища, тайны.
    const withEggs = achievements
      .filter((achievement) => achievement.rewardEggs > 0)
      .map((achievement) => achievement.id)
      .sort()
    expect(withEggs).toEqual([
      'all-secrets',
      'first-secret',
      'full-collection',
      'fusion-adept',
      'habitat-master',
    ])
  })

  it('задания дня дают яйцо только за максимальную сложность', () => {
    const tasks = Array.from({ length: 200 }, (_, index) =>
      createDailyTasks(`2026-01-${String((index % 28) + 1).padStart(2, '0')}`)).flat()

    expect(tasks.length).toBeGreaterThan(0)
    for (const task of tasks) {
      if (task.rewardEggs > 0) expect(task.target).toBe(3)
    }
    // Яйцо за задание — не каждый день: за день максимум два таких задания.
    const eggsPerDay = tasks.reduce((sum, task) => sum + task.rewardEggs, 0) / 200
    expect(eggsPerDay).toBeLessThanOrEqual(2)
  })

  it('звёзды остаются наградой за любое задание', () => {
    const tasks = Array.from({ length: 30 }, (_, index) =>
      createDailyTasks(`2026-02-${String(index + 1).padStart(2, '0')}`)).flat()

    expect(tasks.every((task) => task.rewardStars > 0)).toBe(true)
  })
})
