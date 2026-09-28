import type { GameProgress } from './gameProgress'

export type AchievementKind = 'clicks' | 'energy' | 'eggs' | 'upgrades' | 'collection'

export type AchievementDefinition = {
  id: string
  title: string
  description: string
  kind: AchievementKind
  target: number
  rewardStars: number
  rewardEggs: number
}

export const achievements: AchievementDefinition[] = [
  {
    id: 'first-click',
    title: 'Искра жизни',
    description: 'Сделать первый клик по дереву.',
    kind: 'clicks',
    target: 1,
    rewardStars: 5,
    rewardEggs: 0,
  },
  {
    id: 'energy-1000',
    title: 'Поток энергии',
    description: 'Заработать 1 000 энергии.',
    kind: 'energy',
    target: 1000,
    rewardStars: 15,
    rewardEggs: 0,
  },
  {
    id: 'first-egg',
    title: 'Первое рождение',
    description: 'Открыть первое яйцо.',
    kind: 'eggs',
    target: 1,
    rewardStars: 10,
    rewardEggs: 1,
  },
  {
    id: 'egg-collector',
    title: 'Знаток яиц',
    description: 'Открыть 5 яиц.',
    kind: 'eggs',
    target: 5,
    rewardStars: 25,
    rewardEggs: 1,
  },
  {
    id: 'first-upgrade',
    title: 'Первые перемены',
    description: 'Купить первое улучшение.',
    kind: 'upgrades',
    target: 1,
    rewardStars: 10,
    rewardEggs: 0,
  },
  {
    id: 'upgrade-master',
    title: 'Мастер развития',
    description: 'Купить 10 улучшений.',
    kind: 'upgrades',
    target: 10,
    rewardStars: 35,
    rewardEggs: 1,
  },
  {
    id: 'three-species',
    title: 'Первое разнообразие',
    description: 'Открыть 3 вида существ.',
    kind: 'collection',
    target: 3,
    rewardStars: 20,
    rewardEggs: 1,
  },
  {
    id: 'full-collection',
    title: 'Хранитель острова',
    description: 'Открыть все 10 видов существ.',
    kind: 'collection',
    target: 10,
    rewardStars: 100,
    rewardEggs: 3,
  },
]

export function getAchievementProgress(
  achievement: AchievementDefinition,
  progress: GameProgress,
): number {
  switch (achievement.kind) {
    case 'clicks':
      return progress.totalClicks
    case 'energy':
      return progress.totalEnergyEarned
    case 'eggs':
      return progress.eggsOpened
    case 'upgrades':
      return progress.upgradesBought
    case 'collection':
      return Object.values(progress.ownedCreatures).filter((level) => level > 0).length
  }
}
