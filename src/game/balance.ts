/**
 * Экономический баланс игры — все числа прогрессии в одном месте.
 *
 * Как это устроено и почему именно так.
 *
 * Обычные «бесконечные» покупки (улучшение клика, солнечный источник, яйцо)
 * дают линейный прирост силы. При постоянной цене это превращалось в вечный
 * источник силы: яйцо за 100 энергии окупалось за минуту, и игра проходилась за
 * вечер. Поэтому цена растёт с каждым шагом.
 *
 * Простая замена на экспоненциальную цену тоже не годится: симуляция показала,
 * что при росте цены яйца в 1.34 раза прогресс замирал примерно на 48-м яйце —
 * редкие виды и секреты становились недостижимыми (стена).
 *
 * Поэтому у цены яйца экспоненциальный рост, но с «мягким потолком»: после
 * `softCapAfter` яиц темп роста снижается. В начале игра получается гриндовой
 * (каждый следующий шаг заметно дороже предыдущего), а в дальней части не
 * возникает стены: длинная цель остаётся достижимой.
 *
 * Улучшения клика и солнечного источника конечны по смыслу (это «разгон»
 * экономики), поэтому у них обычный экспоненциальный рост: рано или поздно
 * выгоднее вкладывать в яйца, жилища и слияния.
 *
 * Конечный контент (жилища с пятью уровнями и рецепты слияний) имеет
 * фиксированные растущие цены: это milestones, к которым игрок идёт.
 *
 * Важное следствие для сохранений: цены — производные от прогресса. В
 * сохранении они лежат только для совместимости, при загрузке всегда
 * пересчитываются (см. `saveSchema.ts`): подделанный файл не даст дешёвых цен.
 */

/** Сколько кликов в секунду считается нормальным темпом игры (оценка дохода). */
export const REFERENCE_CLICKS_PER_SECOND = 3

export type BalanceConfig = {
  /** Улучшение клика: +`powerGain` к силе клика, цена растёт в `costGrowth` раз. */
  click: { baseCost: number; costGrowth: number; powerGain: number }
  /** Солнечный источник: +`productionGain` энергии в секунду. */
  sunwell: { baseCost: number; costGrowth: number; productionGain: number }
  /**
   * Яйцо: цена растёт с каждым вылупленным яйцом (в том числе с бесплатным из
   * достижений и заданий — иначе награды обходили бы рост цены).
   * `softCapAfter` — после какого количества рост замедляется до `softCapGrowth`.
   * `maxIncomeSeconds` — потолок: цена не больше столько секунд текущего дохода
   * острова. Защита от тупика, когда экспонента обгоняет доход игрока.
   */
  egg: {
    baseCost: number
    costGrowth: number
    softCapAfter: number
    softCapGrowth: number
    maxIncomeSeconds: number
    /**
     * Кулдаун бесплатного яйца за добровольный просмотр рекламы. Больше потолка
     * цены (`maxIncomeSeconds`) — иначе реклама стала бы выгоднее игры.
     */
    rewardedCooldownMs: number
  }
  /** Офлайн-доход: сколько часов отсутствия начисляется. */
  offline: { maxSeconds: number }
  /** Жилища: множитель к базовым ценам из `habitats.ts`. */
  habitats: { costMultiplier: number }
  /** Слияния: множитель к ценам рецептов из `fusion.ts`. */
  fusion: { costMultiplier: number }
}

export const balance: BalanceConfig = {
  click: { baseCost: 25, costGrowth: 1.7, powerGain: 1 },
  sunwell: { baseCost: 150, costGrowth: 1.75, productionGain: 2 },
  egg: {
    baseCost: 450,
    costGrowth: 1.2,
    softCapAfter: 25,
    softCapGrowth: 1.07,
    maxIncomeSeconds: 12 * 60,
    rewardedCooldownMs: 20 * 60_000,
  },
  // 4 часа вместо 8: офлайн помогает, но не заменяет игру.
  offline: { maxSeconds: 4 * 60 * 60 },
  habitats: { costMultiplier: 45 },
  fusion: { costMultiplier: 3 },
}

/**
 * Доход острова в энергии за секунду — используется для интерфейса, аналитики и
 * потолка цены яйца. Клики считаются по нормальному темпу игры: оценка не
 * зависит от того, насколько быстро тапает конкретный игрок.
 */
export function referenceIncome(inputs: {
  clickPower: number
  energyPerSecond: number
  /** Суммарный бонус жилищ: 0.35 = +35%. */
  habitatBonus: number
}): number {
  const multiplier = 1 + Math.max(0, inputs.habitatBonus)
  const perSecond = inputs.energyPerSecond + inputs.clickPower * REFERENCE_CLICKS_PER_SECOND
  return Math.max(0, perSecond) * multiplier
}

/** Цена следующего улучшения клика (по числу уже купленных уровней). */
export function clickUpgradeCost(level: number): number {
  const safeLevel = Math.max(0, Math.floor(level))
  return Math.ceil(balance.click.baseCost * balance.click.costGrowth ** safeLevel)
}

/** Цена следующего уровня солнечного источника. */
export function sunwellCost(level: number): number {
  const safeLevel = Math.max(0, Math.floor(level))
  return Math.ceil(balance.sunwell.baseCost * balance.sunwell.costGrowth ** safeLevel)
}

/**
 * Цена яйца без учёта дохода: растёт с числом вылупленных яиц.
 * Мягкий потолок: до `softCapAfter` цена растёт быстро, дальше — медленнее,
 * чтобы коллекция редких видов оставалась достижимой.
 */
export function eggPriceTag(eggsOpened: number): number {
  const count = Math.max(0, Math.floor(eggsOpened))
  const { baseCost, costGrowth, softCapAfter, softCapGrowth } = balance.egg

  const fastPart = Math.min(count, softCapAfter)
  const slowPart = Math.max(0, count - softCapAfter)

  return Math.ceil(baseCost * costGrowth ** fastPart * softCapGrowth ** slowPart)
}

/**
 * Цена следующего яйца с учётом дохода острова.
 *
 * Экспоненциальный рост цены сам по себе даёт стену: в симуляции прогресс
 * замирал, и редкие виды становились недостижимыми. Поэтому цена ограничена
 * сверху — не больше `maxIncomeSeconds` секунд текущего дохода. Там, где
 * экспонента «перерастает» доход, игрок платит эту долю дохода и продолжает
 * двигаться: долгая цель вместо тупика.
 */
export function eggCostFor(eggsOpened: number, incomePerSecond: number): number {
  const priceTag = eggPriceTag(eggsOpened)
  const income = Number.isFinite(incomePerSecond) ? Math.max(0, incomePerSecond) : 0
  if (income <= 0) return priceTag

  const ceiling = Math.ceil(income * balance.egg.maxIncomeSeconds)
  return Math.min(priceTag, ceiling)
}

/** Максимальное время начисления дохода одним разом (офлайн и пауза). */
export function offlineLimitSeconds(): number {
  return balance.offline.maxSeconds
}

/** Цена рецепта слияния с учётом множителя баланса. */
export function fusionCostFor(baseCost: number): number {
  const cost = Number.isFinite(baseCost) ? Math.max(0, baseCost) : 0
  return Math.ceil(cost * balance.fusion.costMultiplier)
}
