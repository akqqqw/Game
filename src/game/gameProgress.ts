/** Снимок прогресса, по которому считаются достижения. */
export type GameProgress = {
  totalClicks: number
  totalEnergyEarned: number
  eggsOpened: number
  upgradesBought: number
  ownedCreatures: Record<string, number>
  /** Сколько раз игрок соединял существ. */
  fusionsDone: number
  /** Сколько мутировавших копий получено. */
  mutationsCount: number
  /** Сколько жилищ построено (уровень ≥ 1). */
  builtHabitats: number
  /** Суммарный уровень всех жилищ. */
  habitatLevels: number
  /** Сколько секретных существ открыто. */
  secretDiscoveries: number
}
