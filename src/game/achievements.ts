import { regularCreatures, secretCreatures } from './creatures'
import type { GameProgress } from './gameProgress'
import { MAX_HABITAT_LEVEL, habitatDefinitions } from './habitats'

export type AchievementKind =
  | 'clicks'
  | 'energy'
  | 'eggs'
  | 'upgrades'
  | 'collection'
  | 'fusions'
  | 'mutations'
  | 'habitats'
  | 'habitat_levels'
  | 'secrets'

export type AchievementDefinition = {
  id: string
  title: string
  description: string
  kind: AchievementKind
  target: number
  rewardStars: number
  rewardEggs: number
}

/** Максимальный суммарный уровень жилищ — цель достижения «Владыка стихий». */
const maxHabitatLevels = habitatDefinitions.length * MAX_HABITAT_LEVEL

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
    description: `Открыть все ${regularCreatures.length} видов существ, доступных в игре.`,
    kind: 'collection',
    target: regularCreatures.length,
    rewardStars: 100,
    rewardEggs: 3,
  },
  {
    id: 'first-fusion',
    title: 'Первое слияние',
    description: 'Соединить двух существ в лаборатории.',
    kind: 'fusions',
    target: 1,
    rewardStars: 20,
    rewardEggs: 1,
  },
  {
    id: 'fusion-adept',
    title: 'Мастер слияний',
    description: 'Провести 10 слияний.',
    kind: 'fusions',
    target: 10,
    rewardStars: 45,
    rewardEggs: 2,
  },
  {
    id: 'first-mutation',
    title: 'Счастливая случайность',
    description: 'Получить мутировавшее существо.',
    kind: 'mutations',
    target: 1,
    rewardStars: 30,
    rewardEggs: 1,
  },
  {
    id: 'habitat-builder',
    title: 'Уютный остров',
    description: 'Построить все четыре жилища.',
    kind: 'habitats',
    target: habitatDefinitions.length,
    rewardStars: 40,
    rewardEggs: 1,
  },
  {
    id: 'habitat-master',
    title: 'Владыка стихий',
    description: 'Довести все жилища до максимального уровня.',
    kind: 'habitat_levels',
    target: maxHabitatLevels,
    rewardStars: 90,
    rewardEggs: 2,
  },
  {
    id: 'first-secret',
    title: 'Первая тайна',
    description: 'Открыть секретное существо.',
    kind: 'secrets',
    target: 1,
    rewardStars: 60,
    rewardEggs: 2,
  },
  {
    id: 'all-secrets',
    title: 'Хранитель тайн',
    description: `Разгадать все ${secretCreatures.length} секретных рецепта.`,
    kind: 'secrets',
    target: secretCreatures.length,
    rewardStars: 150,
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
      return regularCreatures.filter((creature) => (progress.ownedCreatures[creature.id] ?? 0) > 0).length
    case 'secrets':
      return secretCreatures.filter((creature) => (progress.ownedCreatures[creature.id] ?? 0) > 0).length
    case 'fusions':
      return progress.fusionsDone
    case 'mutations':
      return progress.mutationsCount
    case 'habitats':
      return progress.builtHabitats
    case 'habitat_levels':
      return progress.habitatLevels
  }
}
