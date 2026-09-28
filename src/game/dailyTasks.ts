export type DailyTaskKind = 'earn_energy' | 'open_eggs' | 'buy_upgrades'

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
  rewardEggs: number
}

const taskTemplates: TaskTemplate[] = [
  {
    kind: 'earn_energy',
    title: 'Заработать энергии',
    targets: [100, 250, 500],
    rewardStars: 12,
    rewardEggs: 0,
  },
  {
    kind: 'open_eggs',
    title: 'Открыть яиц',
    targets: [1, 2, 3],
    rewardStars: 18,
    rewardEggs: 1,
  },
  {
    kind: 'buy_upgrades',
    title: 'Купить улучшений',
    targets: [1, 2, 3],
    rewardStars: 15,
    rewardEggs: 0,
  },
]

export function createDailyTasks(date: string): DailyTask[] {
  return taskTemplates.map((template) => ({
    id: `${date}-${template.kind}`,
    kind: template.kind,
    title: template.title,
    target: template.targets[Math.floor(Math.random() * template.targets.length)],
    progress: 0,
    rewardStars: template.rewardStars,
    rewardEggs: template.rewardEggs,
    claimed: false,
  })).slice(0, 3)
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
