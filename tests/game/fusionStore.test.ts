import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fusionCostFor } from '../../src/game/balance'
import { getCreature } from '../../src/game/creatures'
import { useGameStore } from '../../src/game/gameStore'
import { computeHabitatSummary, createEmptyHabitats, getHabitatDefinition, habitatCost } from '../../src/game/habitats'

const emptyHabitats = createEmptyHabitats()
/** Цена постройки первого уровня жилища и цена слияния в тестах. */
const forestBuildCost = habitatCost(getHabitatDefinition('forest'), 0)

/** Сброс стора к предсказуемому состоянию: тесты не зависят друг от друга. */
function resetStore(overrides: Record<string, unknown> = {}): void {
  useGameStore.setState({
    energy: 0,
    clickPower: 1,
    energyPerSecond: 0,
    // Цены — производные от прогресса, поэтому сбрасываем счётчики, а не цены.
    clickUpgradeLevel: 0,
    sunwellLevel: 0,
    eggsOpened: 0,
    ownedCreatures: {},
    mutations: {},
    habitats: createEmptyHabitats(),
    habitatBonus: 0,
    habitatSummary: computeHabitatSummary(emptyHabitats, {}),
    discoveredRecipes: [],
    fusionsDone: 0,
    lastHatchedId: null,
    lastHatchedMutated: false,
    fusionNotice: null,
    stars: 0,
    eggInventory: 0,
    totalEnergyEarned: 0,
    eggsOpened: 0,
    upgradesBought: 0,
    dailyTasks: [],
    dailyTaskDate: '',
    totalClicks: 0,
    unlockedAchievements: [],
    achievementNotice: null,
    offlineEnergy: 0,
    hydrated: true,
    cloudNotice: null,
    ...overrides,
  })
}

/** Ожидаемые бонусы по коллекции: копии + мутации (мутация удваивает бонус вида). */
function expectedBonuses(state = useGameStore.getState()): { click: number; production: number } {
  let click = 0
  let production = 0
  for (const [id, count] of Object.entries(state.ownedCreatures)) {
    const creature = getCreature(id)
    if (!creature) continue
    const units = count + (state.mutations[id] ?? 0)
    click += creature.clickBonus * units
    production += creature.productionBonus * units
  }
  return { click, production }
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('слияние существ в игровом сторе', () => {
  it('соединяет двух существ, расходует родителей и энергию', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    resetStore({
      energy: 5000,
      // Углехвост (2 к клику) + Каменный голем (2 к клику) — ровно то, что было добавлено при вылуплении.
      clickPower: 4,
      energyPerSecond: 3,
      ownedCreatures: { emberfox: 1, stonegolem: 1 },
      dailyTasks: [
        { id: 'day-fuse', kind: 'fuse', title: 'Провести слияний', target: 3, progress: 0, rewardStars: 22, rewardEggs: 1, claimed: false },
      ],
    })

    const outcome = useGameStore.getState().fuseCreatures('emberfox', 'stonegolem')

    expect(outcome).toEqual({ ok: true, resultId: 'magmagolem', mutated: false, cost: fusionCostFor(400) })
    const state = useGameStore.getState()
    expect(state.ownedCreatures).toEqual({ magmagolem: 1 })
    expect(state.energy).toBe(5000 - fusionCostFor(400))
    // Бонусы родителей ушли, бонус результата добавился.
    expect(state.clickPower).toBe(3)
    expect(state.energyPerSecond).toBe(4)
    expect(state.fusionsDone).toBe(1)
    expect(state.discoveredRecipes).toEqual(['magmagolem'])
    expect(state.fusionNotice).toContain('Магмовый голем')
    expect(state.dailyTasks[0].progress).toBe(1)
    expect(state.unlockedAchievements).toContain('first-fusion')
    expect(state.stars).toBe(20)
  })

  it('две копии одного вида дают существо слияния', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    resetStore({
      energy: 5000,
      clickPower: 4,
      ownedCreatures: { thornling: 2 },
    })

    const outcome = useGameStore.getState().fuseCreatures('thornling', 'thornling')

    expect(outcome.ok).toBe(true)
    const state = useGameStore.getState()
    expect(state.ownedCreatures).toEqual({ thornbeast: 1 })
    expect(state.energy).toBe(5000 - fusionCostFor(500))
    expect(state.clickPower).toBe(6)
  })

  it('мутация при слиянии удваивает бонус нового существа', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    resetStore({
      energy: 5000,
      clickPower: 4,
      energyPerSecond: 3,
      ownedCreatures: { emberfox: 1, stonegolem: 1 },
    })

    const outcome = useGameStore.getState().fuseCreatures('emberfox', 'stonegolem')

    expect(outcome).toEqual({ ok: true, resultId: 'magmagolem', mutated: true, cost: fusionCostFor(400) })
    const state = useGameStore.getState()
    expect(state.mutations).toEqual({ magmagolem: 1 })
    expect(state.clickPower).toBe(6)
    expect(state.energyPerSecond).toBe(8)
    expect(state.fusionNotice).toContain('мутация')
    expect(state.unlockedAchievements).toContain('first-mutation')
  })

  it('обычные копии уходят первыми, мутировавшие — последними', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    resetStore({
      energy: 5000,
      // Колючник: две обычные копии и одна мутировавшая — 4 «единицы» бонуса по 2 к клику.
      clickPower: 8,
      ownedCreatures: { thornling: 3 },
      mutations: { thornling: 1 },
    })

    useGameStore.getState().fuseCreatures('thornling', 'thornling')

    const state = useGameStore.getState()
    // Ушли две обычные копии, мутировавшая осталась.
    expect(state.ownedCreatures.thornling).toBe(1)
    expect(state.mutations.thornling).toBe(1)
    // Сняли 2 копии по 2 к клику и добавили 6 у Тернобестии.
    expect(state.clickPower).toBe(10)
  })

  it('если других копий нет — уходит мутировавшая, снимая двойной бонус', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    resetStore({
      energy: 5000,
      clickPower: 4,
      ownedCreatures: { dewfin: 1, petalimp: 1 },
      mutations: { dewfin: 1 },
    })

    useGameStore.getState().fuseCreatures('dewfin', 'petalimp')

    const state = useGameStore.getState()
    expect(state.ownedCreatures).toEqual({ tidelotus: 1 })
    expect(state.mutations).toEqual({})
    // Росинка (1 к клику ×2 за мутацию) + Лепестник (2) ушли, Лотос дал 4.
    expect(state.clickPower).toBe(4)
  })

  it('сообщает причины отказа', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const fuse = () => useGameStore.getState().fuseCreatures

    resetStore({ energy: 1000 })
    expect(fuse()('mossling', 'dewfin')).toEqual({ ok: false, reason: 'no-recipe' })

    resetStore({ energy: 1000 })
    expect(fuse()('emberfox', 'stonegolem')).toEqual({ ok: false, reason: 'not-owned' })

    resetStore({ energy: 10, ownedCreatures: { emberfox: 1, stonegolem: 1 } })
    expect(fuse()('emberfox', 'stonegolem')).toEqual({ ok: false, reason: 'not-enough-energy' })

    resetStore({ energy: 1000, ownedCreatures: { thornling: 1 } })
    expect(fuse()('thornling', 'thornling')).toEqual({ ok: false, reason: 'not-owned' })
  })

  it('при отказе ничего не списывается', () => {
    resetStore({ energy: 10, ownedCreatures: { emberfox: 1, stonegolem: 1 }, clickPower: 4 })
    useGameStore.getState().fuseCreatures('emberfox', 'stonegolem')

    const state = useGameStore.getState()
    expect(state.energy).toBe(10)
    expect(state.ownedCreatures).toEqual({ emberfox: 1, stonegolem: 1 })
    expect(state.clickPower).toBe(4)
    expect(state.fusionsDone).toBe(0)
  })

  it('секретное существо открывается слиянием и попадает в рецепты', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    resetStore({
      energy: 20_000,
      clickPower: 8,
      ownedCreatures: { mosswarden: 1, sunspirit: 1 },
    })

    const outcome = useGameStore.getState().fuseCreatures('mosswarden', 'sunspirit')

    expect(outcome.ok).toBe(true)
    const state = useGameStore.getState()
    expect(state.ownedCreatures.worldtree).toBe(1)
    expect(state.discoveredRecipes).toContain('worldtree')
    expect(state.fusionNotice).toContain('Древо-прародитель')
  })

  it('бонусы клика всегда равны сумме бонусов коллекции', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.4)
    resetStore({ energy: 100_000, clickPower: 1 })

    const state = useGameStore.getState()
    for (let index = 0; index < 8; index += 1) state.openEgg()

    // Пробуем все пары доступных существ: часть слияний пройдёт, часть — нет.
    const attempts: [string, string][] = [
      ['emberfox', 'stonegolem'],
      ['mossling', 'stonegolem'],
      ['dewfin', 'petalimp'],
      ['cloudram', 'moonhart'],
      ['thornling', 'thornling'],
    ]
    for (const [a, b] of attempts) useGameStore.getState().fuseCreatures(a, b)

    const finalState = useGameStore.getState()
    const expected = expectedBonuses(finalState)
    expect(finalState.clickPower).toBe(1 + expected.click)
    expect(finalState.energyPerSecond).toBe(expected.production)
  })
})

describe('вылупление с мутацией', () => {
  it('мутировавшая особь получает двойной бонус и место в коллекции', () => {
    // Первый вызов — выбор существа, второй — проверка мутации.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.01)
    resetStore({ energy: 1000, clickPower: 1, energyPerSecond: 0 })

    useGameStore.getState().openEgg()

    const state = useGameStore.getState()
    expect(state.lastHatchedMutated).toBe(true)
    expect(state.mutations.mossling).toBe(1)
    expect(state.clickPower).toBe(1 + getCreature('mossling')!.clickBonus * 2)
    expect(state.unlockedAchievements).toContain('first-mutation')
  })

  it('без мутации бонус обычный', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99)
    resetStore({ energy: 1000, clickPower: 1 })

    useGameStore.getState().openEgg()

    const state = useGameStore.getState()
    expect(state.lastHatchedMutated).toBe(false)
    expect(state.mutations).toEqual({})
    expect(state.clickPower).toBe(1 + getCreature('mossling')!.clickBonus)
  })

  it('секретные существа из яиц не выпадают', () => {
    // 0.9999 — почти конец диапазона весов: берём последнего в пуле.
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9999).mockReturnValueOnce(0.99)
    resetStore({ energy: 1000, clickPower: 1 })

    useGameStore.getState().openEgg()

    const state = useGameStore.getState()
    expect(state.lastHatchedId).toBe('moonhart')
    expect(getCreature(state.lastHatchedId!)?.secret).toBeFalsy()
  })
})

describe('жилища в игровом сторе', () => {
  it('постройка списывает энергию и даёт слоты', () => {
    resetStore({ energy: 100_000, ownedCreatures: { mossling: 1 } })

    const built = useGameStore.getState().upgradeHabitat('forest')

    expect(built).toBe(true)
    const state = useGameStore.getState()
    expect(state.energy).toBe(100_000 - forestBuildCost)
    expect(state.habitats.forest.level).toBe(1)
    expect(state.habitatSummary.perHabitat[0].slots).toBe(2)
    expect(state.upgradesBought).toBe(1)
  })

  it('без энергии постройка не проходит', () => {
    resetStore({ energy: 10 })

    expect(useGameStore.getState().upgradeHabitat('forest')).toBe(false)
    expect(useGameStore.getState().energy).toBe(10)
    expect(useGameStore.getState().habitats.forest.level).toBe(0)
  })

  it('заселение даёт бонус к доходу, выселение его убирает', () => {
    resetStore({ energy: 100_000, ownedCreatures: { mossling: 1 } })
    useGameStore.getState().upgradeHabitat('forest')

    expect(useGameStore.getState().assignResident('forest', 'mossling')).toBe(true)
    expect(useGameStore.getState().habitatBonus).toBeCloseTo(0.05, 6)
    expect(useGameStore.getState().habitatSummary.perHabitat[0].matching).toEqual(['mossling'])

    expect(useGameStore.getState().removeResident('forest', 'mossling')).toBe(true)
    expect(useGameStore.getState().habitatBonus).toBe(0)
  })

  it('нельзя заселить существо, которого нет в коллекции', () => {
    resetStore({ energy: 100_000 })
    useGameStore.getState().upgradeHabitat('forest')

    expect(useGameStore.getState().assignResident('forest', 'mossling')).toBe(false)
  })

  it('жилец переезжает в другое жилище, а не двоится', () => {
    resetStore({ energy: 200_000, ownedCreatures: { emberfox: 1 } })
    useGameStore.getState().upgradeHabitat('forest')
    useGameStore.getState().upgradeHabitat('volcano')
    useGameStore.getState().assignResident('forest', 'emberfox')

    expect(useGameStore.getState().assignResident('volcano', 'emberfox')).toBe(true)

    const state = useGameStore.getState()
    expect(state.habitats.forest.residents).toEqual([])
    expect(state.habitats.volcano.residents).toEqual(['emberfox'])
    // В вулкане огненный жилец — «свой»: +5% вместо +2%.
    expect(state.habitatBonus).toBeCloseTo(0.05, 6)
  })

  it('бонус жилищ увеличивает и клик, и пассивный доход', () => {
    resetStore({ energy: 100_000, clickPower: 100, energyPerSecond: 100, ownedCreatures: { mossling: 1 } })
    useGameStore.getState().upgradeHabitat('forest')
    useGameStore.getState().assignResident('forest', 'mossling')

    const before = useGameStore.getState().energy
    useGameStore.getState().addEnergy()
    useGameStore.getState().accruePassiveEnergy(1)

    // Клик и секунда пассивного дохода — по +105 (бонус 5%).
    expect(useGameStore.getState().energy - before).toBeCloseTo(210, 6)
  })

  it('после слияния выселяется жилец, чьи копии закончились', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    resetStore({
      energy: 100_000,
      clickPower: 4,
      ownedCreatures: { mossling: 1, petalimp: 1, stonegolem: 1 },
    })
    useGameStore.getState().upgradeHabitat('forest')
    useGameStore.getState().assignResident('forest', 'mossling')
    useGameStore.getState().assignResident('forest', 'petalimp')

    useGameStore.getState().fuseCreatures('mossling', 'stonegolem')

    const state = useGameStore.getState()
    expect(state.habitats.forest.residents).toEqual(['petalimp'])
    expect(state.habitatBonus).toBeCloseTo(0.05, 6)
  })

  it('уровень жилища повышается и увеличивает бонус', () => {
    resetStore({ energy: 100_000, ownedCreatures: { mossling: 1 } })
    useGameStore.getState().upgradeHabitat('forest')
    useGameStore.getState().assignResident('forest', 'mossling')
    const firstLevelBonus = useGameStore.getState().habitatBonus

    useGameStore.getState().upgradeHabitat('forest')

    const state = useGameStore.getState()
    expect(state.habitats.forest.level).toBe(2)
    expect(state.habitatBonus).toBeCloseTo(firstLevelBonus * 2, 6)
    expect(state.habitatSummary.perHabitat[0].slots).toBe(3)
  })

  it('выше максимального уровня жилище не растёт', () => {
    resetStore({ energy: 10_000_000 })

    for (let index = 0; index < 8; index += 1) useGameStore.getState().upgradeHabitat('cloud')

    expect(useGameStore.getState().habitats.cloud.level).toBe(5)
    expect(useGameStore.getState().habitatSummary.perHabitat[3].slots).toBe(6)
  })
})
