import { useCallback, useEffect, useRef, useState } from 'react'
import { achievements, getAchievementProgress } from './game/achievements'
import { bonusCopies, creatures, getCreature, rarityLabel, secretCreatures, type Rarity } from './game/creatures'
import type { DailyTask } from './game/dailyTasks'
import { elementEmoji, elementPhrase } from './game/elements'
import { fusionRecipes, previewFusion, secretRecipeHint } from './game/fusion'
import { PhaserGame } from './game/PhaserGame'
import { useEnergy, useGameStore, type FusionOutcome } from './game/gameStore'
import type { GameProgress } from './game/gameProgress'
import {
  MATCHING_RESIDENT_BONUS,
  OTHER_RESIDENT_BONUS,
  formatBonus,
  getHabitatDefinition,
  habitatCost,
  habitatDefinitions,
  habitatMatchesCreature,
  type HabitatId,
  type HabitatSummary,
} from './game/habitats'
import { startPassiveIncome, stopPassiveIncome } from './game/passiveIncome'
import { requestAdPoint } from './platform/adPoints'
import { isMuted, play, playVaried, toggleMuted, unlockAudio } from './platform/audio'
import { notifyGameReady } from './platform/yandexSdk'
import { CloudBar } from './ui/CloudBar'
import { LoadingScreen } from './ui/LoadingScreen'
import './App.css'

/** Ошибки слияния — понятным языком. */
const fusionErrors: Record<Extract<FusionOutcome, { ok: false }>['reason'], string> = {
  'no-recipe': 'Эти существа не соединяются. Попробуйте другую пару.',
  'not-owned': 'Нужно по одной копии каждого родителя (для одного вида — две копии).',
  'not-enough-energy': 'Не хватает энергии на слияние.',
}

/** Целые числа показываем как есть, дробные — с одним знаком. */
function formatNumber(value: number): string {
  return Math.abs(value % 1) < 0.05 ? Math.round(value).toLocaleString() : value.toFixed(1)
}

function App() {
  const [screen, setScreen] = useState<Screen>('island')
  const energy = useEnergy()
  const addEnergy = useGameStore((state) => state.addEnergy)

  const buyClickUpgrade = useGameStore((state) => state.buyClickUpgrade)
  const clickPower = useGameStore((state) => state.clickPower)
  const clickUpgradeCost = useGameStore((state) => state.clickUpgradeCost)
  const energyPerSecond = useGameStore((state) => state.energyPerSecond)
  const sunwellLevel = useGameStore((state) => state.sunwellLevel)
  const sunwellCost = useGameStore((state) => state.sunwellCost)
  const eggCost = useGameStore((state) => state.eggCost)
  const eggInventory = useGameStore((state) => state.eggInventory)
  const stars = useGameStore((state) => state.stars)
  const dailyTasks = useGameStore((state) => state.dailyTasks)
  const unlockedAchievements = useGameStore((state) => state.unlockedAchievements)
  const achievementNotice = useGameStore((state) => state.achievementNotice)
  const ownedCreatures = useGameStore((state) => state.ownedCreatures)
  const mutations = useGameStore((state) => state.mutations)
  const lastHatchedId = useGameStore((state) => state.lastHatchedId)
  const lastHatchedMutated = useGameStore((state) => state.lastHatchedMutated)
  const buySunwell = useGameStore((state) => state.buySunwell)
  const openEgg = useGameStore((state) => state.openEgg)
  const claimTask = useGameStore((state) => state.claimTask)
  const dismissAchievementNotice = useGameStore((state) => state.dismissAchievementNotice)
  const offlineEnergy = useGameStore((state) => state.offlineEnergy)
  const hydrated = useGameStore((state) => state.hydrated)
  const hydrate = useGameStore((state) => state.hydrate)

  // Слияния и жилища.
  const habitatSummary = useGameStore((state) => state.habitatSummary)
  const habitatBonus = useGameStore((state) => state.habitatBonus)
  const discoveredRecipes = useGameStore((state) => state.discoveredRecipes)
  const fusionsDone = useGameStore((state) => state.fusionsDone)
  const fusionNotice = useGameStore((state) => state.fusionNotice)
  const fuseCreatures = useGameStore((state) => state.fuseCreatures)
  const upgradeHabitat = useGameStore((state) => state.upgradeHabitat)
  const assignResident = useGameStore((state) => state.assignResident)
  const removeResident = useGameStore((state) => state.removeResident)
  const dismissFusionNotice = useGameStore((state) => state.dismissFusionNotice)

  // Достижения пересчитываются реактивно (раньше экран показывал старые данные).
  const totalClicks = useGameStore((state) => state.totalClicks)
  const totalEnergyEarned = useGameStore((state) => state.totalEnergyEarned)
  const eggsOpened = useGameStore((state) => state.eggsOpened)
  const upgradesBought = useGameStore((state) => state.upgradesBought)

  const hydrateStarted = useRef(false)
  const [sceneReady, setSceneReady] = useState(false)
  // Звук: состояние живёт в звуковом модуле, здесь только отражение для кнопки.
  const [muted, setMuted] = useState(() => isMuted())
  const handleToggleSound = useCallback(() => {
    // Клик — это и жест пользователя: заодно разблокируем звук, если он новый.
    void unlockAudio()
    setMuted(toggleMuted())
  }, [])
  const handleTreeClick = useCallback(() => {
    // Первое касание разблокирует звук: браузеры запрещают автозапуск аудио.
    void unlockAudio()
    // Тон слегка варьируется и звук приглушён: частые клики не «пулеметят».
    playVaried('click')
    addEnergy()
  }, [addEnergy])
  const handleSceneReady = useCallback(() => setSceneReady(true), [])

  /**
   * Реклама показывается только после завершённого действия игрока и никогда —
   * по самому клику (см. `src/platform/adPoints.ts`). Если действие не прошло
   * (не хватает энергии), показа не будет.
   */
  const handleBuyClickUpgrade = useCallback(() => {
    const bought = buyClickUpgrade()
    if (bought) {
      play('upgrade')
      requestAdPoint('upgrade-bought')
    }
    return bought
  }, [buyClickUpgrade])
  const handleBuySunwell = useCallback(() => {
    const bought = buySunwell()
    if (bought) {
      play('upgrade')
      requestAdPoint('upgrade-bought')
    }
    return bought
  }, [buySunwell])
  const handleOpenEgg = useCallback(() => {
    if (!openEgg()) return
    // Мутировавшая особь звучит иначе — игрок слышит удачу, даже не глядя на баннер.
    play(useGameStore.getState().lastHatchedMutated ? 'mutation' : 'egg')
    requestAdPoint('egg-hatched')
  }, [openEgg])
  const handleUpgradeHabitat = useCallback((habitatId: HabitatId) => {
    const upgraded = upgradeHabitat(habitatId)
    if (upgraded) {
      play('habitat')
      requestAdPoint('habitat-upgraded')
    }
    return upgraded
  }, [upgradeHabitat])
  /** Переход между экранами — логическая пауза; повторный тап по активному экрану не считается. */
  const handleScreenChange = useCallback((next: Screen) => {
    if (next !== screen) {
      play('ui')
      requestAdPoint('screen-change')
    }
    setScreen(next)
  }, [screen])

  // Достижение: звук фанфары в момент появления уведомления.
  useEffect(() => {
    if (achievementNotice) play('achievement')
  }, [achievementNotice])
  const lastHatched = lastHatchedId ? getCreature(lastHatchedId) : undefined
  const gameReady = hydrated && sceneReady
  const incomeMultiplier = 1 + habitatBonus

  const progress: GameProgress = {
    totalClicks,
    totalEnergyEarned,
    eggsOpened,
    upgradesBought,
    ownedCreatures,
    fusionsDone,
    mutationsCount: Object.values(mutations).reduce((total, count) => total + count, 0),
    builtHabitats: habitatSummary.perHabitat.filter((habitat) => habitat.level > 0).length,
    habitatLevels: habitatSummary.perHabitat.reduce((total, habitat) => total + habitat.level, 0),
    secretDiscoveries: secretCreatures.filter((creature) => (ownedCreatures[creature.id] ?? 0) > 0).length,
  }

  useEffect(() => {
    if (hydrateStarted.current) return
    hydrateStarted.current = true
    void hydrate()
  }, [hydrate])

  // Game Ready: сообщаем платформе, что игра готова, но только после того,
  // как экран загрузки снят и первый кадр игры отрисован (п. 1.19.2).
  useEffect(() => {
    if (!gameReady) return
    const frame = window.requestAnimationFrame(() => {
      void notifyGameReady()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [gameReady])

  // Пассивный доход начисляется по фактически прошедшему времени: при паузе
  // таймер останавливается, при возобновлении пропущенное время начисляется
  // один раз (см. `src/game/passiveIncome.ts`).
  useEffect(() => {
    if (!hydrated) return
    startPassiveIncome()
    return () => stopPassiveIncome()
  }, [hydrated])

  return (
    <main className="game-shell">
      {!gameReady && <LoadingScreen status={hydrated ? 'Готовим остров…' : 'Загружаем сохранение…'} />}
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-orb">✦</span>
          <div>
            <p className="eyebrow">Острова Эволюции</p>
            <h1>Изумрудный остров</h1>
          </div>
        </div>
        <div className="resource-card" aria-label={`Энергия: ${Math.floor(energy)}`}>
          <span className="resource-icon">✦</span>
          <div>
            <span className="resource-label">Энергия</span>
            <strong>{formatNumber(energy)}</strong>
          </div>
        </div>
        <div className="resource-pills">
          <span title="Звёзды постоянных наград">★ {stars}</span>
          <span title="Наградные яйца">🥚 {eggInventory}</span>
        </div>
        <button
          className="sound-toggle"
          type="button"
          aria-pressed={muted}
          aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          title={muted ? 'Включить звук' : 'Выключить звук'}
          onClick={handleToggleSound}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </header>

      <CloudBar />

      <div className="game-scroll">
      {achievementNotice && (
        <button className="achievement-toast" type="button" onClick={dismissAchievementNotice}>
          <span>🏆</span>
          <strong>{achievementNotice}</strong>
          <small>Нажми, чтобы закрыть</small>
        </button>
      )}

      {fusionNotice && (
        <button className="achievement-toast fusion-toast" type="button" onClick={dismissFusionNotice}>
          <span>🧬</span>
          <strong>{fusionNotice}</strong>
          <small>Нажми, чтобы закрыть</small>
        </button>
      )}

      {screen === 'island' ? (
        <>
          <section className="island-panel">
            <div className="panel-caption">
              <span className="status-dot" />
              <span>Пробуди древнее дерево</span>
              <span className="caption-rule" />
              <span className="click-hint">Нажми, чтобы собрать</span>
            </div>
            <PhaserGame onTreeClick={handleTreeClick} onReady={handleSceneReady} />
          </section>

          <section className="upgrade-panel" aria-label="Улучшения">
        <div>
          <p className="eyebrow">Первое пробуждение</p>
          <h2>Корни силы</h2>
          <p className="upgrade-description">
            Усиль каждый сбор энергии с древнего дерева.
          </p>
        </div>
        <div className="upgrade-stats">
          <span>+{formatNumber(clickPower * incomeMultiplier)} / клик</span>
          <span>+{formatNumber(energyPerSecond * incomeMultiplier)} / сек</span>
        </div>
        <button
          className="upgrade-button"
          type="button"
          disabled={!hydrated || energy < clickUpgradeCost}
          onClick={handleBuyClickUpgrade}
        >
          <span>✦</span>
          <strong>{clickUpgradeCost.toLocaleString()}</strong>
          <small>Улучшить</small>
        </button>
          </section>

          {offlineEnergy > 0 && (
            <p className="offline-note">Пока тебя не было, остров собрал {formatNumber(offlineEnergy)} энергии.</p>
          )}

          <section className="systems-grid" aria-label="Системы острова">
        <article className="system-card">
          <div className="system-icon">☼</div>
          <div className="system-copy">
            <p className="eyebrow">Постройка · Ур. {sunwellLevel}</p>
            <h2>Солнечный источник</h2>
            <p>Даёт +2 энергии в секунду.</p>
          </div>
          <button
            className="small-action"
            type="button"
            disabled={!hydrated || energy < sunwellCost}
            onClick={handleBuySunwell}
          >
            {sunwellCost.toLocaleString()} <span>✦</span>
          </button>
        </article>

        <article className="system-card egg-card">
          <div className="system-icon">🥚</div>
          <div className="system-copy">
            <p className="eyebrow">Мистический питомник</p>
            <h2>Лунное яйцо</h2>
            <p>Получи существо с постоянными бонусами.</p>
          </div>
          <button
            className="small-action egg-action"
            type="button"
            disabled={!hydrated || energy < eggCost}
            onClick={handleOpenEgg}
          >
            {eggInventory > 0 ? 'Бесплатно' : <>{eggCost.toLocaleString()} <span>✦</span></>}
          </button>
        </article>
          </section>

          {lastHatched && (
            <section className={`hatch-result hatch-${lastHatched.rarity.toLowerCase()}`} aria-live="polite">
              <span className="creature-emoji">{lastHatched.emoji}</span>
              <div>
                <p className="eyebrow">
                  Новый спутник · {rarityLabel(lastHatched.rarity)}
                  {lastHatchedMutated && <span className="mutant-chip">✦ Мутация</span>}
                </p>
                <strong>{lastHatched.name} · Ур. {ownedCreatures[lastHatched.id]}</strong>
                <span>
                  +{lastHatched.clickBonus * bonusCopies(ownedCreatures[lastHatched.id] ?? 0, mutations[lastHatched.id] ?? 0)} к клику
                  {' · '}
                  +{lastHatched.productionBonus * bonusCopies(ownedCreatures[lastHatched.id] ?? 0, mutations[lastHatched.id] ?? 0)} / сек
                </span>
              </div>
            </section>
          )}

          <HabitatSection
            summary={habitatSummary}
            energy={energy}
            hydrated={hydrated}
            ownedCreatures={ownedCreatures}
            mutations={mutations}
            upgradeHabitat={handleUpgradeHabitat}
            assignResident={assignResident}
            removeResident={removeResident}
          />

          <DailyTasks tasks={dailyTasks} claimTask={claimTask} />
        </>
      ) : screen === 'upgrades' ? (
        <UpgradeScreen
          clickPower={clickPower}
          clickUpgradeCost={clickUpgradeCost}
          energy={energy}
          energyPerSecond={energyPerSecond}
          incomeMultiplier={incomeMultiplier}
          habitatBonus={habitatBonus}
          hydrated={hydrated}
          sunwellCost={sunwellCost}
          sunwellLevel={sunwellLevel}
          buyClickUpgrade={handleBuyClickUpgrade}
          buySunwell={handleBuySunwell}
        />
      ) : screen === 'creatures' ? (
        <>
          <FusionLab
            ownedCreatures={ownedCreatures}
            mutations={mutations}
            energy={energy}
            discoveredRecipes={discoveredRecipes}
            fuseCreatures={fuseCreatures}
          />
          <CreatureCollection ownedCreatures={ownedCreatures} mutations={mutations} />
        </>
      ) : (
        <AchievementScreen unlockedAchievements={unlockedAchievements} progress={progress} />
      )}

      </div>

      <nav className="bottom-nav" aria-label="Игровая навигация">
        <button className={`nav-item ${screen === 'island' ? 'nav-item-active' : ''}`} type="button" onClick={() => handleScreenChange('island')}>
          <span>◈</span> Остров
        </button>
        <button className={`nav-item ${screen === 'upgrades' ? 'nav-item-active' : ''}`} type="button" onClick={() => handleScreenChange('upgrades')}>
          <span>✧</span> Улучшения
        </button>
        <button className={`nav-item ${screen === 'creatures' ? 'nav-item-active' : ''}`} type="button" onClick={() => handleScreenChange('creatures')}>
          <span>♧</span> Существа
        </button>
        <button className={`nav-item ${screen === 'achievements' ? 'nav-item-active' : ''}`} type="button" onClick={() => handleScreenChange('achievements')}>
          <span>🏆</span> Достижения
        </button>
      </nav>
    </main>
  )
}

type Screen = 'island' | 'upgrades' | 'creatures' | 'achievements'

type HabitatSectionProps = {
  summary: HabitatSummary
  energy: number
  hydrated: boolean
  ownedCreatures: Record<string, number>
  mutations: Record<string, number>
  upgradeHabitat: (habitatId: HabitatId) => boolean
  assignResident: (habitatId: HabitatId, creatureId: string) => boolean
  removeResident: (habitatId: HabitatId, creatureId: string) => boolean
}

/**
 * Среда обитания: четыре жилища с уровнями и слотами под существ.
 * Жильцы подходящей стихии дают больше, а существа одной стихии — синергию.
 */
function HabitatSection({
  summary,
  energy,
  hydrated,
  ownedCreatures,
  mutations,
  upgradeHabitat,
  assignResident,
  removeResident,
}: HabitatSectionProps) {
  const [pickerHabitat, setPickerHabitat] = useState<HabitatId | null>(null)

  return (
    <section className="habitats" aria-label="Среда обитания">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Среда обитания</p>
          <h2>Жилища острова</h2>
        </div>
        <span className="collection-count">Доход {formatBonus(summary.totalBonus)}</span>
      </div>
      <p className="habitats-note">
        Каждое жилище усиливает доход острова: жильцы своей стихии дают {formatBonus(MATCHING_RESIDENT_BONUS)} за уровень,
        чужие — {formatBonus(OTHER_RESIDENT_BONUS)}, а существа одной стихии добавляют синергию.
      </p>

      <div className="habitat-list">
        {habitatDefinitions.map((definition) => {
          const bonus = summary.perHabitat.find((item) => item.id === definition.id)
          const level = bonus?.level ?? 0
          const slots = bonus?.slots ?? 0
          const residents = bonus?.residents ?? []
          const cost = habitatCost(definition, level)
          const maxed = level >= definition.maxLevel

          return (
            <article className={`habitat-card ${level === 0 ? 'habitat-card-unbuilt' : ''}`} key={definition.id}>
              <div className="habitat-head">
                <span className="habitat-emoji">{definition.emoji}</span>
                <div className="habitat-copy">
                  <p className="eyebrow">
                    {level === 0 ? 'Не построено' : `Уровень ${level} из ${definition.maxLevel}`}
                    {' · '}{elementEmoji(definition.elements)}
                  </p>
                  <h3>{definition.name}</h3>
                  <p>{definition.description}</p>
                </div>
                <span className="habitat-bonus">{formatBonus(bonus?.bonus ?? 0)}</span>
              </div>

              <div className="habitat-slots">
                {slots === 0 ? (
                  <span className="habitat-empty-note">Постройте жилище, чтобы селить существ</span>
                ) : (
                  Array.from({ length: slots }, (_, index) => {
                    const residentId = residents[index]
                    const creature = residentId ? getCreature(residentId) : undefined

                    if (!creature) {
                      return (
                        <button
                          className="habitat-slot habitat-slot-empty"
                          key={`${definition.id}-slot-${index}`}
                          type="button"
                          onClick={() => setPickerHabitat(definition.id)}
                        >
                          + слот
                        </button>
                      )
                    }

                    const matching = habitatMatchesCreature(definition, creature.id)
                    return (
                      <button
                        className={`habitat-slot habitat-slot-filled ${matching ? 'habitat-slot-matching' : ''}`}
                        key={creature.id}
                        type="button"
                        title="Нажми, чтобы выселить"
                        onClick={() => removeResident(definition.id, creature.id)}
                      >
                        <span className="habitat-resident-emoji">{creature.emoji}</span>
                        <strong>{creature.name}</strong>
                        {(mutations[creature.id] ?? 0) > 0 && <i className="mutant-mark">✦</i>}
                      </button>
                    )
                  })
                )}
              </div>

              {level > 0 && (
                <p className="habitat-detail">
                  Подходящих жильцов: {bonus?.matching.length ?? 0} из {residents.length}
                  {' · '}синергия {formatBonus(bonus?.synergyBonus ?? 0)}
                </p>
              )}

              <button
                className="small-action habitat-action"
                type="button"
                disabled={!hydrated || maxed || energy < cost}
                onClick={() => upgradeHabitat(definition.id)}
              >
                {maxed
                  ? 'Максимальный уровень'
                  : <>{level === 0 ? 'Построить' : 'Улучшить'} · {cost.toLocaleString()} <span>✦</span></>}
              </button>
            </article>
          )
        })}
      </div>

      {pickerHabitat && (
        <HabitatPicker
          habitatId={pickerHabitat}
          ownedCreatures={ownedCreatures}
          mutations={mutations}
          summary={summary}
          assignResident={assignResident}
          onClose={() => setPickerHabitat(null)}
        />
      )}
    </section>
  )
}

type HabitatPickerProps = {
  habitatId: HabitatId
  ownedCreatures: Record<string, number>
  mutations: Record<string, number>
  summary: HabitatSummary
  assignResident: (habitatId: HabitatId, creatureId: string) => boolean
  onClose: () => void
}

/** Выбор существа для слота жилища. */
function HabitatPicker({
  habitatId,
  ownedCreatures,
  mutations,
  summary,
  assignResident,
  onClose,
}: HabitatPickerProps) {
  const definition = getHabitatDefinition(habitatId)
  const owned = creatures.filter((creature) => (ownedCreatures[creature.id] ?? 0) > 0)

  const currentHome = (creatureId: string): string | null => {
    const habitat = summary.perHabitat.find((item) => item.residents.includes(creatureId))
    return habitat ? getHabitatDefinition(habitat.id).name : null
  }

  return (
    <div className="creature-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="creature-modal habitat-picker"
        role="dialog"
        aria-modal="true"
        aria-label={`Заселить в ${definition.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" aria-label="Закрыть выбор существа" onClick={onClose}>×</button>
        <p className="eyebrow">Заселить в жилище</p>
        <h3>{definition.emoji} {definition.name}</h3>
        <p className="modal-level">Здесь хорошо стихиям {elementPhrase(definition.elements)}.</p>

        {owned.length === 0 ? (
          <p className="modal-hint">Сначала вылупите или слейте хотя бы одного жителя.</p>
        ) : (
          <div className="picker-list">
            {owned.map((creature) => {
              const matching = habitatMatchesCreature(definition, creature.id)
              const home = currentHome(creature.id)
              return (
                <button
                  className={`picker-row ${matching ? 'picker-row-matching' : ''}`}
                  key={creature.id}
                  type="button"
                  onClick={() => {
                    assignResident(habitatId, creature.id)
                    onClose()
                  }}
                >
                  <span className="picker-emoji">{creature.emoji}</span>
                  <span className="picker-copy">
                    <strong>
                      {creature.name}
                      {(mutations[creature.id] ?? 0) > 0 && <i className="mutant-mark"> ✦</i>}
                    </strong>
                    <small>
                      {elementEmoji(creature.elements)} {matching ? 'подходит' : 'чужая стихия'}
                      {home ? ` · сейчас: ${home}` : ''}
                    </small>
                  </span>
                  <span className="picker-count">×{ownedCreatures[creature.id]}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

type FusionLabProps = {
  ownedCreatures: Record<string, number>
  mutations: Record<string, number>
  energy: number
  discoveredRecipes: string[]
  fuseCreatures: (aId: string, bId: string) => FusionOutcome
}

/** Лаборатория слияний: выбираем двух существ и смотрим, что получится. */
function FusionLab({
  ownedCreatures,
  mutations,
  energy,
  discoveredRecipes,
  fuseCreatures,
}: FusionLabProps) {
  const [first, setFirst] = useState<string | null>(null)
  const [second, setSecond] = useState<string | null>(null)
  const [pickerSlot, setPickerSlot] = useState<'first' | 'second' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const owned = creatures.filter((creature) => (ownedCreatures[creature.id] ?? 0) > 0)
  const preview = first && second
    ? previewFusion(first, second, { discoveredRecipes, ownedCreatures, energy })
    : null
  const resultCreature = preview && !preview.hidden ? getCreature(preview.recipe.result) : undefined
  const sameCreature = first !== null && first === second
  const enoughCopies = !sameCreature || (ownedCreatures[first] ?? 0) >= 2
  const canFuse = preview !== null && preview.affordable && enoughCopies

  const handleFuse = () => {
    if (!first || !second) return
    const outcome = fuseCreatures(first, second)
    if (outcome.ok) {
      const creature = getCreature(outcome.resultId)
      setMessage(`Успех: ${creature?.name ?? 'новое существо'}${outcome.mutated ? ' ✦ мутация' : ''} за ${outcome.cost.toLocaleString()} энергии.`)
      setFirst(null)
      setSecond(null)
      play(outcome.mutated ? 'mutation' : 'fusion')
      requestAdPoint('fusion-done')
      return
    }
    setMessage(fusionErrors[outcome.reason])
  }

  const knownRecipes = fusionRecipes.filter(
    (recipe) => !recipe.secret || discoveredRecipes.includes(recipe.id),
  )

  return (
    <section className="fusion-lab" aria-label="Лаборатория слияний">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Лаборатория слияний</p>
          <h2>Соединить существ</h2>
        </div>
        <span className="collection-count">
          Рецепты: {discoveredRecipes.length} / {fusionRecipes.length}
        </span>
      </div>
      <p className="fusion-note">
        Два существа уходят в слияние, а вместо них рождается новое. Иногда результат мутирует —
        такая копия выглядит иначе и даёт двойной бонус.
      </p>

      <div className="fusion-slots">
        <FusionSlot
          caption="Первый родитель"
          creatureId={first}
          ownedCreatures={ownedCreatures}
          mutations={mutations}
          onPick={() => setPickerSlot('first')}
        />
        <span className="fusion-plus" aria-hidden="true">+</span>
        <FusionSlot
          caption="Второй родитель"
          creatureId={second}
          ownedCreatures={ownedCreatures}
          mutations={mutations}
          onPick={() => setPickerSlot('second')}
        />
      </div>

      {(first || second) && (
        <button
          className="fusion-reset"
          type="button"
          onClick={() => {
            setFirst(null)
            setSecond(null)
            setMessage(null)
          }}
        >
          Сбросить выбор
        </button>
      )}

      {preview ? (
        <div className={`fusion-preview ${preview.hidden ? 'fusion-preview-secret' : ''}`}>
          <div className="fusion-result-emoji">{preview.hidden ? '❔' : resultCreature?.emoji ?? '❔'}</div>
          <div className="fusion-result-copy">
            <p className="eyebrow">
              {preview.hidden
                ? 'Секретный рецепт'
                : `${resultCreature ? rarityLabel(resultCreature.rarity) : 'Неизвестно'} · ${elementEmoji(preview.elements)}`}
            </p>
            <h3>{preview.hidden ? '???' : resultCreature?.name ?? 'Неизвестно'}</h3>
            <p>
              {preview.hidden
                ? secretRecipeHint(preview.recipe)
                : `+${resultCreature?.clickBonus ?? 0} к клику · +${resultCreature?.productionBonus ?? 0} / сек`}
            </p>
          </div>
          <div className="fusion-actions">
            <span className="fusion-cost">{preview.recipe.cost.toLocaleString()} ✦</span>
            <button className="small-action" type="button" disabled={!canFuse} onClick={handleFuse}>
              Слить
            </button>
          </div>
        </div>
      ) : (
        <p className="fusion-hint">
          {owned.length < 2
            ? 'Нужно хотя бы два существа в коллекции — вылупите их из яиц.'
            : 'Выберите двух существ, чтобы увидеть, что получится.'}
        </p>
      )}

      {!enoughCopies && (
        <p className="fusion-hint fusion-hint-warn">
          Для слияния одного и того же вида нужны две его копии.
        </p>
      )}

      {message && <p className="fusion-message" role="status">{message}</p>}

      <div className="recipe-book">
        <p className="eyebrow">Книга рецептов</p>
        {knownRecipes.map((recipe) => {
          const result = getCreature(recipe.result)
          const [left, right] = recipe.ingredients.map((id) => getCreature(id))
          const discovered = discoveredRecipes.includes(recipe.id)
          return (
            <article className={`recipe-row ${discovered ? 'recipe-row-open' : ''}`} key={recipe.id}>
              <span className="recipe-parents">{left?.emoji} + {right?.emoji}</span>
              <span className="recipe-arrow" aria-hidden="true">→</span>
              <span className="recipe-result">
                {result?.emoji} {result?.name}
                {recipe.secret && <i className="mutant-mark"> ✦ тайна</i>}
              </span>
              <span className="recipe-cost">{recipe.cost.toLocaleString()} ✦</span>
            </article>
          )
        })}
      </div>

      {pickerSlot && (
        <FusionPicker
          ownedCreatures={ownedCreatures}
          mutations={mutations}
          onPick={(creatureId) => {
            if (pickerSlot === 'first') setFirst(creatureId)
            else setSecond(creatureId)
            setMessage(null)
            setPickerSlot(null)
          }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </section>
  )
}

type FusionSlotProps = {
  caption: string
  creatureId: string | null
  ownedCreatures: Record<string, number>
  mutations: Record<string, number>
  onPick: () => void
}

function FusionSlot({ caption, creatureId, ownedCreatures, mutations, onPick }: FusionSlotProps) {
  const creature = creatureId ? getCreature(creatureId) : undefined

  if (!creature) {
    return (
      <button className="fusion-slot fusion-slot-empty" type="button" onClick={onPick}>
        <span className="fusion-slot-caption">{caption}</span>
        <span className="fusion-slot-emoji">＋</span>
        <strong>Выбрать</strong>
      </button>
    )
  }

  return (
    <button className="fusion-slot fusion-slot-filled" type="button" onClick={onPick}>
      <span className="fusion-slot-caption">{caption}</span>
      <span className="fusion-slot-emoji">{creature.emoji}</span>
      <strong>
        {creature.name}
        {(mutations[creature.id] ?? 0) > 0 && <i className="mutant-mark"> ✦</i>}
      </strong>
      <small>в коллекции: {ownedCreatures[creature.id] ?? 0}</small>
    </button>
  )
}

type FusionPickerProps = {
  ownedCreatures: Record<string, number>
  mutations: Record<string, number>
  onPick: (creatureId: string) => void
  onClose: () => void
}

/** Выбор существа для слияния. */
function FusionPicker({ ownedCreatures, mutations, onPick, onClose }: FusionPickerProps) {
  const owned = creatures.filter((creature) => (ownedCreatures[creature.id] ?? 0) > 0)

  return (
    <div className="creature-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="creature-modal habitat-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Выбор существа для слияния"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" aria-label="Закрыть выбор существа" onClick={onClose}>×</button>
        <p className="eyebrow">Лаборатория слияний</p>
        <h3>Кого соединяем?</h3>
        <p className="modal-level">Можно выбрать два разных вида или две копии одного вида.</p>

        {owned.length === 0 ? (
          <p className="modal-hint">Коллекция пуста — сначала вылупите существо из яйца.</p>
        ) : (
          <div className="picker-list">
            {owned.map((creature) => (
              <button className="picker-row picker-row-matching" key={creature.id} type="button" onClick={() => onPick(creature.id)}>
                <span className="picker-emoji">{creature.emoji}</span>
                <span className="picker-copy">
                  <strong>
                    {creature.name}
                    {(mutations[creature.id] ?? 0) > 0 && <i className="mutant-mark"> ✦</i>}
                  </strong>
                  <small>{elementEmoji(creature.elements)} · +{creature.clickBonus} к клику · +{creature.productionBonus} / сек</small>
                </span>
                <span className="picker-count">×{ownedCreatures[creature.id]}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

type AchievementScreenProps = {
  unlockedAchievements: string[]
  progress: GameProgress
}

function AchievementScreen({ unlockedAchievements, progress }: AchievementScreenProps) {
  return (
    <section className="achievements-view" aria-label="Достижения">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Путь хранителя</p>
          <h2>Достижения</h2>
        </div>
        <span className="collection-count">{unlockedAchievements.length} / {achievements.length} получено</span>
      </div>
      <div className="achievement-list">
        {achievements.map((achievement) => {
          const current = getAchievementProgress(achievement, progress)
          const unlocked = unlockedAchievements.includes(achievement.id)
          return (
            <article className={`achievement-card ${unlocked ? 'achievement-unlocked' : ''}`} key={achievement.id}>
              <div className="achievement-icon">{unlocked ? '🏆' : '◇'}</div>
              <div className="achievement-copy">
                <p className="eyebrow">{unlocked ? 'Получено' : 'В процессе'}</p>
                <h3>{achievement.title}</h3>
                <p>{achievement.description}</p>
                <div className="achievement-progress"><i style={{ width: `${Math.min(100, (current / achievement.target) * 100)}%` }} /></div>
                <span>{Math.min(current, achievement.target).toLocaleString()} / {achievement.target.toLocaleString()}</span>
              </div>
              <div className="achievement-reward">★ {achievement.rewardStars}{achievement.rewardEggs > 0 && ` · 🥚 ${achievement.rewardEggs}`}</div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

type DailyTasksProps = {
  tasks: DailyTask[]
  claimTask: (taskId: string) => boolean
}

function DailyTasks({ tasks, claimTask }: DailyTasksProps) {
  return (
    <section className="daily-tasks" aria-label="Ежедневные задания">
      <div className="daily-heading">
        <div>
          <p className="eyebrow">Обновляются каждый день</p>
          <h2>Задания дня</h2>
        </div>
        <span className="daily-reset">Награды: ★ и яйца</span>
      </div>
      <div className="task-list">
        {tasks.map((task) => {
          const isComplete = task.progress >= task.target
          return (
            <article className={`task-card ${task.claimed ? 'task-claimed' : ''}`} key={task.id}>
              <div className="task-copy">
                <strong>{task.title}</strong>
                <span>{Math.floor(task.progress).toLocaleString()} / {task.target.toLocaleString()}</span>
                <div className="task-progress"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div>
              </div>
              <div className="task-reward">★ {task.rewardStars}{task.rewardEggs > 0 && ` · 🥚 ${task.rewardEggs}`}</div>
              <button className="task-claim" type="button" disabled={!isComplete || task.claimed} onClick={() => claimTask(task.id)}>
                {task.claimed ? 'Получено' : 'Забрать'}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

type UpgradeScreenProps = {
  clickPower: number
  clickUpgradeCost: number
  energy: number
  energyPerSecond: number
  incomeMultiplier: number
  habitatBonus: number
  hydrated: boolean
  sunwellCost: number
  sunwellLevel: number
  buyClickUpgrade: () => boolean
  buySunwell: () => boolean
}

function UpgradeScreen({
  clickPower,
  clickUpgradeCost,
  energy,
  energyPerSecond,
  incomeMultiplier,
  habitatBonus,
  hydrated,
  sunwellCost,
  sunwellLevel,
  buyClickUpgrade,
  buySunwell,
}: UpgradeScreenProps) {
  return (
    <section className="upgrade-screen" aria-label="Зал улучшений">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Развивай остров</p>
          <h2>Зал улучшений</h2>
        </div>
        <span className="collection-count">{formatNumber(energy)} энергии</span>
      </div>
      <div className="upgrade-summary">
        <span>Сила клика <strong>+{formatNumber(clickPower * incomeMultiplier)}</strong></span>
        <span>Поток энергии <strong>+{formatNumber(energyPerSecond * incomeMultiplier)}/сек</strong></span>
        {habitatBonus > 0 && <span>Жилища <strong>{formatBonus(habitatBonus)}</strong></span>}
      </div>
      <div className="upgrade-list">
        <article className="upgrade-tile">
          <div className="upgrade-tile-icon">✦</div>
          <div>
            <p className="eyebrow">Благословение дерева</p>
            <h3>Корни силы</h3>
            <p>Увеличивает каждый клик на +1 энергию.</p>
          </div>
          <button className="small-action" type="button" disabled={!hydrated || energy < clickUpgradeCost} onClick={buyClickUpgrade}>
            {clickUpgradeCost.toLocaleString()} <span>✦</span>
          </button>
        </article>
        <article className="upgrade-tile">
          <div className="upgrade-tile-icon">☼</div>
          <div>
            <p className="eyebrow">Постройка · Ур. {sunwellLevel}</p>
            <h3>Солнечный источник</h3>
            <p>Увеличивает пассивный доход на +2 энергии в секунду.</p>
          </div>
          <button className="small-action" type="button" disabled={!hydrated || energy < sunwellCost} onClick={buySunwell}>
            {sunwellCost.toLocaleString()} <span>✦</span>
          </button>
        </article>
      </div>
      <p className="upgrade-note">
        Жилища строятся на экране «Остров»: они усиливают доход всей колонии.
      </p>
    </section>
  )
}

type CreatureCollectionProps = {
  ownedCreatures: Record<string, number>
  mutations: Record<string, number>
}

function CreatureCollection({ ownedCreatures, mutations }: CreatureCollectionProps) {
  const [filter, setFilter] = useState<Rarity | 'All' | 'Fusion'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const discoveredRegular = creatures.filter(
    (creature) => !creature.secret && (ownedCreatures[creature.id] ?? 0) > 0,
  ).length
  const discoveredSecrets = secretCreatures.filter((creature) => (ownedCreatures[creature.id] ?? 0) > 0).length

  const visibleCreatures = filter === 'All'
    ? creatures
    : filter === 'Fusion'
      ? creatures.filter((creature) => creature.fusionOnly)
      : creatures.filter((creature) => creature.rarity === filter)

  const selectedCreature = selectedId ? getCreature(selectedId) : undefined
  const selectedLevel = selectedCreature ? ownedCreatures[selectedCreature.id] ?? 0 : 0
  const selectedMutations = selectedCreature ? mutations[selectedCreature.id] ?? 0 : 0
  const selectedUnits = selectedCreature ? bonusCopies(selectedLevel, selectedMutations) : 0

  return (
    <section className="collection-view" aria-label="Коллекция существ">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Живой архив</p>
          <h2>Коллекция существ</h2>
        </div>
        <span className="collection-count">
          {discoveredRegular} / {creatures.length - secretCreatures.length} открыто · тайны {discoveredSecrets} / {secretCreatures.length}
        </span>
      </div>
      <div className="rarity-filters" aria-label="Фильтр по редкости">
        {(['All', 'Common', 'Rare', 'Mythic', 'Fusion'] as const).map((rarity) => (
          <button
            className={filter === rarity ? 'rarity-filter rarity-filter-active' : 'rarity-filter'}
            key={rarity}
            type="button"
            onClick={() => setFilter(rarity)}
          >
            {rarity === 'All' ? 'Все' : rarity === 'Fusion' ? 'Слияния' : rarityLabel(rarity)}
          </button>
        ))}
      </div>
      <div className="creature-grid">
        {visibleCreatures.map((creature) => {
          const level = ownedCreatures[creature.id] ?? 0
          const mutated = mutations[creature.id] ?? 0
          const isDiscovered = level > 0
          const units = bonusCopies(level, mutated)
          const classes = [
            'creature-card',
            isDiscovered ? `creature-${creature.rarity.toLowerCase()}` : 'creature-locked',
            creature.secret ? 'creature-secret' : '',
            mutated > 0 ? 'creature-mutated' : '',
          ].filter(Boolean).join(' ')

          return (
            <button
              className={classes}
              disabled={!isDiscovered}
              key={creature.id}
              type="button"
              onClick={() => setSelectedId(creature.id)}
            >
              <div className="creature-card-emoji">{isDiscovered ? creature.emoji : creature.secret ? '🔒' : '?'}</div>
              <p className="eyebrow">
                {rarityLabel(creature.rarity)}
                {creature.fusionOnly && ' · слияние'}
                {mutated > 0 && <span className="mutant-chip">✦ мутация</span>}
              </p>
              <h3>{isDiscovered ? creature.name : creature.secret ? 'Тайное существо' : 'Неизвестный дух'}</h3>
              <span className="creature-level">
                {isDiscovered ? `Уровень ${level}` : creature.secret ? 'Секрет · нужен редкий рецепт' : 'Не открыто'}
              </span>
              {isDiscovered ? (
                <div className="creature-bonus">
                  <span>+{creature.clickBonus * units} к клику</span>
                  <span>+{creature.productionBonus * units} / сек</span>
                </div>
              ) : (
                <div className="creature-hint">{creature.hint ?? 'Попробуйте разные сочетания в лаборатории слияний.'}</div>
              )}
            </button>
          )
        })}
      </div>
      {selectedCreature && (
        <div className="creature-modal-backdrop" role="presentation" onClick={() => setSelectedId(null)}>
          <section className={`creature-modal creature-${selectedCreature.rarity.toLowerCase()} ${selectedMutations > 0 ? 'creature-mutated' : ''}`} role="dialog" aria-modal="true" aria-label={`Характеристики: ${selectedCreature.name}`} onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Закрыть характеристики существа" onClick={() => setSelectedId(null)}>×</button>
            <div className="modal-creature-emoji">{selectedCreature.emoji}</div>
            <p className="eyebrow">
              Спутник · {rarityLabel(selectedCreature.rarity)}
              {selectedMutations > 0 && <span className="mutant-chip">✦ мутация</span>}
            </p>
            <h3>{selectedCreature.name}</h3>
            <p className="modal-level">
              Уровень {selectedLevel}
              {selectedMutations > 0 && ` · мутировавших копий: ${selectedMutations} (бонус удвоен)`}
            </p>
            <div className="modal-bonuses">
              <span>+{selectedCreature.clickBonus * selectedUnits} к силе клика</span>
              <span>+{selectedCreature.productionBonus * selectedUnits} энергии / сек</span>
            </div>
            <p className="modal-level">
              Стихии: {elementEmoji(selectedCreature.elements)} {elementPhrase(selectedCreature.elements)}
            </p>
            <p className="modal-level">
              Дом: {habitatDefinitions.filter((definition) => habitatMatchesCreature(definition, selectedCreature.id)).map((definition) => `${definition.emoji} ${definition.name}`).join(' · ') || 'пока нет подходящего жилища'}
            </p>
          </section>
        </div>
      )}
    </section>
  )
}

export default App
