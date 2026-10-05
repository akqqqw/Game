export type DailyTaskKind =
  | 'earn_energy'
  | 'open_eggs'
  | 'buy_upgrades'
  | 'fuse'
  | 'build_habitats'

export type DailyTask = {
  id: string
  kind: DailyTaskKind
  title: string
  target: number
  progress: number
  rewardStars: number
  rewardEggs: number
  claimed: boolean
}

type TaskTemplate = {
  kind: DailyTaskKind
  title: string
  targets: number[]
  rewardStars: number
  /**
   * Награда яйцами за каждую сложность задания (индекс совпадает с `targets`).
   * Яйцо даётся только за максимальную сложность: бесплатные яйца не должны
   * обесценивать основную добычу (см. `balance.ts`).
   */
  rewardEggs: number[]
}

/** Сколько заданий выдаётся на день. */
const tasksPerDay = 3

const taskTemplates: TaskTemplate[] = [
  {
    kind: 'earn_energy',
    title: 'Заработать энергии',
    targets: [100, 250, 500],
    rewardStars: 12,
    rewardEggs: [0, 0, 0],
  },
  {
    kind: 'open_eggs',
    title: 'Открыть яиц',
    targets: [1, 2, 3],
    rewardStars: 18,
    rewardEggs: [0, 0, 1],
  },
  {
    kind: 'buy_upgrades',
    title: 'Купить улучшений',
    targets: [1, 2, 3],
    rewardStars: 15,
    rewardEggs: [0, 0, 0],
  },
  {
    kind: 'fuse',
    title: 'Провести слияний',
    targets: [1, 2, 3],
    rewardStars: 22,
    rewardEggs: [0, 0, 1],
  },
  {
    kind: 'build_habitats',
    title: 'Улучшить жилища',
    targets: [1, 2, 3],
    rewardStars: 16,
    rewardEggs: [0, 0, 0],
  },
]

/**
 * Задания дня: набор собирается случайно из шаблонов, поэтому дни не
 * повторяются один в один (раньше брались первые три шаблона подряд).
 */
export function createDailyTasks(date: string): DailyTask[] {
  const shuffled = [...taskTemplates].sort(() => Math.random() - 0.5)

  return shuffled.slice(0, tasksPerDay).map((template) => {
    const difficulty = Math.floor(Math.random() * template.targets.length)
    return {
      id: `${date}-${template.kind}`,
      kind: template.kind,
      title: template.title,
      target: template.targets[difficulty],
      progress: 0,
      rewardStars: template.rewardStars,
      rewardEggs: template.rewardEggs[difficulty] ?? 0,
      claimed: false,
    }
  })
}

export function getTodayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function advanceDailyTasks(
  tasks: DailyTask[],
  kind: DailyTaskKind,
  amount: number,
): DailyTask[] {
  return tasks.map((task) => task.kind === kind && !task.claimed
    ? { ...task, progress: Math.min(task.target, task.progress + amount) }
    : task)
}
