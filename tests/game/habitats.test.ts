import { describe, expect, it } from 'vitest'
import { balance } from '../../src/game/balance'
import {
  MATCHING_RESIDENT_BONUS,
  OTHER_RESIDENT_BONUS,
  SYNERGY_BONUS,
  canAssignResident,
  computeHabitatSummary,
  createEmptyHabitats,
  dropUnavailableResidents,
  formatBonus,
  getHabitatDefinition,
  habitatCost,
  habitatDefinitions,
  habitatMatchesCreature,
  habitatSlots,
  sanitizeHabitats,
  type HabitatId,
  type HabitatState,
} from '../../src/game/habitats'

function makeHabitats(entries: Partial<Record<HabitatId, Partial<HabitatState>>>): Record<HabitatId, HabitatState> {
  const habitats = createEmptyHabitats()
  for (const [id, state] of Object.entries(entries) as [HabitatId, Partial<HabitatState>][]) {
    habitats[id] = { level: state.level ?? 0, residents: state.residents ?? [] }
  }
  return habitats
}

describe('жилища: уровни и стоимость', () => {
  it('четыре жилища: лес, вулкан, кристальная пещера и облачный сад', () => {
    expect(habitatDefinitions.map((definition) => definition.id)).toEqual([
      'forest',
      'volcano',
      'crystal',
      'cloud',
    ])
    expect(habitatDefinitions.map((definition) => definition.name)).toEqual([
      'Лесная роща',
      'Вулкан',
      'Кристальная пещера',
      'Облачный сад',
    ])
  })

  it('слоты появляются только после постройки и растут с уровнем', () => {
    expect(habitatSlots(0)).toBe(0)
    expect(habitatSlots(1)).toBe(2)
    expect(habitatSlots(3)).toBe(4)
    expect(habitatSlots(5)).toBe(6)
    expect(habitatSlots(99)).toBe(6)
  })

  it('каждый следующий уровень дороже предыдущего, после максимума — нельзя', () => {
    const forest = getHabitatDefinition('forest')
    const first = habitatCost(forest, 0)
    const second = habitatCost(forest, 1)
    // Базовая цена берётся из описания жилища, множитель — из баланса.
    expect(first).toBe(Math.ceil(forest.baseCost * balance.habitats.costMultiplier))
    expect(second).toBeGreaterThan(first)
    expect(habitatCost(forest, forest.maxLevel)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('жилища: бонусы и синергия', () => {
  it('без жилищ множитель дохода равен единице', () => {
    const summary = computeHabitatSummary(createEmptyHabitats(), {})
    expect(summary.totalBonus).toBe(0)
    expect(summary.multiplier).toBe(1)
  })

  it('жилец своей стихии даёт больше, чем чужой', () => {
    const owned = { mossling: 1, glowmole: 1 }
    const matches = computeHabitatSummary(makeHabitats({ forest: { level: 1, residents: ['mossling'] } }), owned)
    const other = computeHabitatSummary(makeHabitats({ forest: { level: 1, residents: ['glowmole'] } }), owned)

    expect(matches.totalBonus).toBeCloseTo(MATCHING_RESIDENT_BONUS, 6)
    expect(other.totalBonus).toBeCloseTo(OTHER_RESIDENT_BONUS, 6)
    expect(matches.totalBonus).toBeGreaterThan(other.totalBonus)
  })

  it('бонус растёт вместе с уровнем жилища', () => {
    const owned = { mossling: 1 }
    const level1 = computeHabitatSummary(makeHabitats({ forest: { level: 1, residents: ['mossling'] } }), owned)
    const level3 = computeHabitatSummary(makeHabitats({ forest: { level: 3, residents: ['mossling'] } }), owned)
    expect(level3.totalBonus).toBeCloseTo(MATCHING_RESIDENT_BONUS * 3, 6)
    expect(level1.totalBonus).toBeGreaterThan(0)
  })

  it('синергия: двое одной стихии дают прибавку к бонусу', () => {
    const owned = { mossling: 1, petalimp: 1 }
    const one = computeHabitatSummary(makeHabitats({ forest: { level: 2, residents: ['mossling'] } }), owned)
    const two = computeHabitatSummary(makeHabitats({ forest: { level: 2, residents: ['mossling', 'petalimp'] } }), owned)

    // Двое подходящих (природа) + синергия 4% за уровень.
    expect(two.totalBonus).toBeCloseTo(MATCHING_RESIDENT_BONUS * 2 * 2 + SYNERGY_BONUS * 2, 6)
    expect(two.totalBonus).toBeGreaterThan(one.totalBonus)
    expect(two.perHabitat[0].synergyBonus).toBeGreaterThan(0)
    expect(two.perHabitat[0].matching).toEqual(['mossling', 'petalimp'])
  })

  it('синергию даёт и общая стихия у разных видов', () => {
    const owned = { emberfox: 1, magmagolem: 1 }
    const summary = computeHabitatSummary(
      makeHabitats({ volcano: { level: 1, residents: ['emberfox', 'magmagolem'] } }),
      owned,
    )
    const volcano = summary.perHabitat.find((habitat) => habitat.id === 'volcano')
    // Оба подходят вулкану (огонь), а общая стихия огня даёт синергию.
    expect(volcano?.residents).toEqual(['emberfox', 'magmagolem'])
    expect(volcano?.matching).toHaveLength(2)
    expect(volcano?.synergyBonus).toBeCloseTo(SYNERGY_BONUS, 6)
  })

  it('жильцы сверх слотов и без копий в коллекции не учитываются', () => {
    const owned = { mossling: 1 }
    const summary = computeHabitatSummary(
      makeHabitats({ forest: { level: 1, residents: ['mossling', 'petalimp', 'thornling'] } }),
      owned,
    )
    expect(summary.perHabitat[0].slots).toBe(2)
    expect(summary.perHabitat[0].residents).toEqual(['mossling'])
    expect(summary.totalResidents).toBe(1)
  })

  it('бонусы жилищ складываются, а формат подписи понятен игроку', () => {
    const owned = { mossling: 1, emberfox: 1 }
    const summary = computeHabitatSummary(
      makeHabitats({
        forest: { level: 1, residents: ['mossling'] },
        volcano: { level: 1, residents: ['emberfox'] },
      }),
      owned,
    )
    expect(summary.totalBonus).toBeCloseTo(MATCHING_RESIDENT_BONUS * 2, 6)
    expect(summary.multiplier).toBeCloseTo(1 + MATCHING_RESIDENT_BONUS * 2, 6)
    expect(formatBonus(summary.totalBonus)).toBe('+10%')
  })
})

describe('жилища: пригодность для существа', () => {
  it('существо подходит жилищу по любой из своих стихий', () => {
    const volcano = getHabitatDefinition('volcano')
    const cloud = getHabitatDefinition('cloud')
    // Магмовый голем — огонь и камень.
    expect(habitatMatchesCreature(volcano, 'magmagolem')).toBe(true)
    expect(habitatMatchesCreature(getHabitatDefinition('crystal'), 'magmagolem')).toBe(true)
    expect(habitatMatchesCreature(cloud, 'magmagolem')).toBe(false)
    expect(habitatMatchesCreature(cloud, 'cloudram')).toBe(true)
    expect(habitatMatchesCreature(cloud, 'нет-такого')).toBe(false)
  })
})

describe('жилища: нормализация сохранений', () => {
  it('уровень обрезается по лимиту, неизвестные жильцы отбрасываются', () => {
    const habitats = sanitizeHabitats(
      {
        forest: { level: 99, residents: ['mossling', 'нет-такого', 'mossling'] },
        volcano: { level: -3, residents: ['emberfox'] },
      },
      { mossling: 1, emberfox: 1 },
    )

    expect(habitats.forest.level).toBe(5)
    expect(habitats.forest.residents).toEqual(['mossling'])
    expect(habitats.volcano.level).toBe(0)
    expect(habitats.volcano.residents).toEqual([])
  })

  it('жильцы без копий в коллекции выселяются', () => {
    const habitats = sanitizeHabitats(
      { forest: { level: 2, residents: ['mossling', 'petalimp'] } },
      { mossling: 1 },
    )
    expect(habitats.forest.residents).toEqual(['mossling'])
  })

  it('одно существо не может жить в двух жилищах сразу', () => {
    const habitats = sanitizeHabitats(
      {
        forest: { level: 1, residents: ['mossling'] },
        volcano: { level: 1, residents: ['mossling'] },
      },
      { mossling: 1 },
    )
    expect(habitats.forest.residents).toEqual(['mossling'])
    expect(habitats.volcano.residents).toEqual([])
  })

  it('жильцы обрезаются по числу слотов', () => {
    const habitats = sanitizeHabitats(
      { forest: { level: 1, residents: ['mossling', 'petalimp', 'thornling'] } },
      { mossling: 1, petalimp: 1, thornling: 1 },
    )
    expect(habitats.forest.residents).toEqual(['mossling', 'petalimp'])
  })

  it('мусор вместо жилищ не ломает загрузку', () => {
    expect(sanitizeHabitats(null, {}).forest.level).toBe(0)
    expect(sanitizeHabitats('строка', {}).volcano.level).toBe(0)
    expect(sanitizeHabitats({ forest: 42 }, {}).forest.residents).toEqual([])
  })

  it('выселение по потере копии (например, после слияния) работает', () => {
    const habitats = makeHabitats({ forest: { level: 2, residents: ['mossling', 'petalimp'] } })
    const after = dropUnavailableResidents(habitats, { petalimp: 1 })
    expect(after.forest.residents).toEqual(['petalimp'])
  })
})

describe('жилища: проверка заселения', () => {
  const owned = { mossling: 1, petalimp: 1 }

  it('нельзя селить в непостроенное жилище', () => {
    expect(canAssignResident(createEmptyHabitats(), owned, 'forest', 'mossling')).toEqual({
      ok: false,
      reason: 'not-built',
    })
  })

  it('нельзя селить существо, которого нет в коллекции', () => {
    const habitats = makeHabitats({ forest: { level: 1 } })
    expect(canAssignResident(habitats, owned, 'forest', 'emberfox')).toEqual({
      ok: false,
      reason: 'not-owned',
    })
    expect(canAssignResident(habitats, owned, 'forest', 'нет-такого')).toEqual({
      ok: false,
      reason: 'unknown-creature',
    })
  })

  it('жилец одного жилища не может занять место в другом', () => {
    const habitats = makeHabitats({
      forest: { level: 1, residents: ['mossling'] },
      volcano: { level: 1 },
    })
    expect(canAssignResident(habitats, owned, 'volcano', 'mossling')).toEqual({
      ok: false,
      reason: 'already-resident',
    })
  })

  it('свободный слот принимает жителя, занятые — нет', () => {
    const habitats = makeHabitats({ forest: { level: 1, residents: ['mossling'] } })
    expect(canAssignResident(habitats, owned, 'forest', 'petalimp')).toEqual({ ok: true })

    const full = makeHabitats({ forest: { level: 1, residents: ['mossling', 'petalimp'] } })
    const withEmber = { ...owned, emberfox: 1 }
    expect(canAssignResident(full, withEmber, 'forest', 'emberfox')).toEqual({ ok: false, reason: 'no-slot' })
  })
})
