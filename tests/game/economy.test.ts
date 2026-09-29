import { describe, expect, it } from 'vitest'
import { balance, clickUpgradeCost, eggCostFor, sunwellCost } from '../../src/game/balance'
import { eggPool } from '../../src/game/creatures'
import { MUTATION_CHANCE_EGG } from '../../src/game/fusion'
import { getHabitatDefinition, habitatCost, habitatDefinitions, habitatSlots } from '../../src/game/habitats'

/**
 * Проверка экономики: симуляция активной игры от нуля до 200 часов.
 *
 * Тест защищает баланс от «случайного» упрощения: если кто-то вернёт дешёвые
 * яйца или фиксированные цены, кривая прогрессии снова станет минутной и тест
 * упадёт. Он же ловит обратную ошибку — стену, когда прогресс упирается и
 * редкие виды становятся недостижимыми.
 *
 * Модель намеренно в пользу игрока (верхняя оценка скорости): жилища считаются
 * полностью заселёнными подходящими существами, каждую секунду покупается одна
 * (самая выгодная из доступных) покупка, кликов ровно 3 в секунду. В реальной
 * игре будет медленнее — значит, если тут получается гриндово, в игре тем более.
 *
 * Числа для отчёта печатаются в консоль: удобно смотреть кривую при подборе
 * баланса.
 */

const CLICKS_PER_SECOND = 3
const HOUR = 3600
const MAX_SECONDS = 200 * HOUR

/** Средние бонусы одного яйца (с учётом шанса мутации). */
const eggClick = eggPool.reduce((sum, c) => sum + (c.weight / 100) * c.clickBonus, 0)
const eggProduction = eggPool.reduce((sum, c) => sum + (c.weight / 100) * c.productionBonus, 0)
const expectedClick = eggClick * (1 + MUTATION_CHANCE_EGG)
const expectedProduction = eggProduction * (1 + MUTATION_CHANCE_EGG)

/**
 * Сколько видов, подходящих жилищу, игрок в среднем открыл за `eggs` яиц.
 * Считается как в теории вероятностей: вид не открыт, если он не выпал ни разу.
 */
function matchingSpecies(index: number, eggs: number): number {
  const definition = habitatDefinitions[index]
  let expected = 0
  for (const creature of eggPool) {
    const matches = creature.elements.some((element) => definition.elements.includes(element))
    if (!matches) continue
    expected += 1 - (1 - creature.weight / 100) ** eggs
  }
  return expected
}

/**
 * Бонус жилищ: подходящий жилец даёт +5% за уровень, плюс синергия +4% за
 * уровень за каждого сверх первого. Жильцов не больше, чем слотов и чем
 * открытых видов (каждый вид живёт только в одном жилище — здесь это в пользу
 * игрока: жилища не конкурируют за одни и те же виды).
 */
const bonusCache = new Map<string, number>()

function habitatBonus(levels: number[], eggs: number): number {
  const key = `${levels.join(',')}|${eggs}`
  const cached = bonusCache.get(key)
  if (cached !== undefined) return cached
  const value = computeHabitatBonus(levels, eggs)
  bonusCache.set(key, value)
  return value
}

function computeHabitatBonus(levels: number[], eggs: number): number {
  return levels.reduce((sum, level, index) => {
    if (level <= 0) return sum
    const slots = habitatSlots(level)
    const residents = Math.min(slots, matchingSpecies(index, eggs))
    return sum + 0.05 * level * residents + 0.04 * level * Math.max(0, residents - 1)
  }, 0)
}

type Option = { name: string; cost: number; delta: number; buy: () => void }

type Simulation = {
  milestones: [string, number][]
  log: string[]
  eggs: number
  maxHabitatLevels: number[]
}

function simulate(): Simulation {
  let energy = 0
  let clickPower = 1
  let production = 0
  let clickLevel = 0
  let sunwellLevel = 0
  let eggs = 0
  const habitatLevels = [0, 0, 0, 0]

  const milestones: [string, number][] = []
  const mark = (name: string, seconds: number): void => {
    if (!milestones.some(([label]) => label === name)) milestones.push([name, seconds])
  }

  let seconds = 0
  let earnedTotal = 0

  while (seconds < MAX_SECONDS) {
    const multiplier = 1 + habitatBonus(habitatLevels, eggs)
    const income = (production + clickPower * CLICKS_PER_SECOND) * multiplier

    earnedTotal += income
    energy += income
    seconds += 1

    // Контрольные точки по доходу.
    if (income >= 10) mark('доход 10/сек', seconds)
    if (income >= 100) mark('доход 100/сек', seconds)
    if (income >= 1000) mark('доход 1000/сек', seconds)
    if (income >= 10_000) mark('доход 10 000/сек', seconds)
    if (earnedTotal >= 1e6) mark('заработано 1 млн', seconds)
    if (earnedTotal >= 1e9) mark('заработано 1 млрд', seconds)

    const options: Option[] = [
      {
        name: 'клик',
        cost: clickUpgradeCost(clickLevel),
        delta: balance.click.powerGain * CLICKS_PER_SECOND * multiplier,
        buy: () => {
          clickLevel += 1
          clickPower += balance.click.powerGain
        },
      },
      {
        name: 'солнце',
        cost: sunwellCost(sunwellLevel),
        delta: balance.sunwell.productionGain * multiplier,
        buy: () => {
          sunwellLevel += 1
          production += balance.sunwell.productionGain
        },
      },
      {
        name: 'яйцо',
        cost: eggCostFor(eggs, income),
        delta: (expectedClick * CLICKS_PER_SECOND + expectedProduction) * multiplier,
        buy: () => {
          eggs += 1
          clickPower += expectedClick
          production += expectedProduction
        },
      },
      ...habitatLevels.map((level, index): Option => ({
        name: `жилище ${index + 1}`,
        cost: habitatCost(getHabitatDefinition(habitatDefinitions[index].id), level),
        delta: income * ((1 + habitatBonus(habitatLevels.map((l, i) => (i === index ? l + 1 : l)), eggs)) / multiplier - 1),
        buy: () => {
          if (level === 0) mark(`жилище ${index + 1} построено`, seconds)
          habitatLevels[index] += 1
          if (habitatLevels.every((value) => value > 0)) mark('все 4 жилища построены', seconds)
        },
      })),
    ]

    if (eggs >= 1) mark('первое яйцо', milestones.find(([label]) => label === 'первое яйцо')?.[1] ?? seconds)
    if (eggs >= 10) mark('10 яиц', milestones.find(([label]) => label === '10 яиц')?.[1] ?? seconds)
    if (eggs >= 25) mark('25 яиц', milestones.find(([label]) => label === '25 яиц')?.[1] ?? seconds)
    if (eggs >= 50) mark('50 яиц', milestones.find(([label]) => label === '50 яиц')?.[1] ?? seconds)
    if (eggs >= 75) mark('75 яиц', milestones.find(([label]) => label === '75 яиц')?.[1] ?? seconds)
    if (eggs >= 100) mark('100 яиц', milestones.find(([label]) => label === '100 яиц')?.[1] ?? seconds)
    if (habitatLevels.some((level) => level >= 3)) mark('жилище 3-го уровня', milestones.find(([label]) => label === 'жилище 3-го уровня')?.[1] ?? seconds)
    if (habitatLevels.every((level) => level >= 5)) mark('все жилища на максимуме', milestones.find(([label]) => label === 'все жилища на максимуме')?.[1] ?? seconds)

    // Реалистичная модель игрока: сначала вкладывается в новые механики
    // (жилища — самый дешёвый доступный уровень), затем в яйца (коллекция),
    // а остаток энергии уходит в самое выгодное из улучшений.
    const affordable = options.filter((option) => option.cost <= energy && option.delta > 0)
    const habitats = affordable.filter((option) => option.name.startsWith('жилище'))
    const eggsOptions = affordable.filter((option) => option.name === 'яйцо')
    const upgrades = affordable.filter((option) => option.name === 'клик' || option.name === 'солнце')

    let chosen: Option | undefined
    if (habitats.length > 0) {
      chosen = habitats.reduce((a, b) => (a.cost <= b.cost ? a : b))
    } else if (eggsOptions.length > 0) {
      chosen = eggsOptions[0]
    } else if (upgrades.length > 0) {
      // Улучшения покупаются только на часть накопленного: игрок откладывает
      // энергию на яйцо или жилище, а не тратит всё под ноль.
      const affordableShare = upgrades.filter((option) => option.cost <= energy * 0.35)
      if (affordableShare.length > 0) {
        chosen = affordableShare.reduce((a, b) => (a.cost / a.delta <= b.cost / b.delta ? a : b))
      }
    }

    if (chosen) {
      energy -= chosen.cost
      chosen.buy()
    }
  }

  const hours = (value: number): string => `${(value / HOUR).toFixed(2)} ч`
  const finalIncome = (production + clickPower * CLICKS_PER_SECOND) * (1 + habitatBonus(habitatLevels, eggs))
  const log = [
    `средние бонусы яйца: +${expectedClick.toFixed(2)} к клику, +${expectedProduction.toFixed(2)}/сек`,
    ...milestones
      .sort((a, b) => a[1] - b[1])
      .map(([name, value]) => `${name.padEnd(26)} ${hours(value)}`),
    `цена 100-го яйца: ${eggCostFor(99, finalIncome).toLocaleString('ru-RU')}, цена 150-го: ${eggCostFor(149, finalIncome).toLocaleString('ru-RU')}`,
    `итог: клик ${clickPower.toFixed(0)}, пассив ${production.toFixed(0)}/сек, яиц ${eggs}, `
      + `уровни жилищ ${habitatLevels.join('/')}, множитель ${(1 + habitatBonus(habitatLevels, eggs)).toFixed(2)}×`,
  ]
  return { milestones, log, eggs, maxHabitatLevels: habitatLevels }
}

describe('экономика прогрессии', () => {
  it('остаётся гриндовой, но без стены: прогресс не «за минуты» и не упирается', { timeout: 120_000 }, () => {
    const { log, milestones, eggs } = simulate()
    console.info(`\n${log.join('\n')}\n`)

    const at = (name: string): number => {
      const found = milestones.find(([label]) => label === name)
      expect(found, `нет контрольной точки «${name}»`).toBeDefined()
      return found![1]
    }
    const hours = (seconds: number): number => seconds / HOUR

    // Первое яйцо — быстро: игрок должен сразу увидеть новую механику.
    expect(hours(at('первое яйцо'))).toBeLessThan(0.1)
    // Дальше начинается грайнд: 25 яиц — уже не «за минуту».
    expect(hours(at('25 яиц'))).toBeGreaterThan(0.08)
    expect(hours(at('50 яиц'))).toBeGreaterThan(0.5)
    expect(hours(at('100 яиц'))).toBeGreaterThan(3)

    // Жилища — milestones: строятся не сразу, но и не «никогда».
    expect(hours(at('все 4 жилища построены'))).toBeGreaterThan(0.3)
    expect(hours(at('все 4 жилища построены'))).toBeLessThan(4)
    expect(hours(at('все жилища на максимуме'))).toBeLessThan(24)

    // Миллиард энергии — долгая цель, а не вечер игры.
    expect(hours(at('заработано 1 млрд'))).toBeGreaterThan(10)

    // Стены нет: даже после 200 часов игра продолжает давать яйца
    // (цена упирается в долю дохода, а не в бесконечность).
    expect(eggs).toBeGreaterThan(150)
  })
})
