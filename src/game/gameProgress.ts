export type GameProgress = {
  totalClicks: number
  totalEnergyEarned: number
  eggsOpened: number
  upgradesBought: number
  ownedCreatures: Record<string, number>
}
