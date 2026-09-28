import { useCallback, useEffect, useRef, useState } from 'react'
import { achievements, getAchievementProgress } from './game/achievements'
import { PhaserGame } from './game/PhaserGame'
import { creatures, getCreature, rarityLabel, type Rarity } from './game/creatures'
import type { DailyTask } from './game/dailyTasks'
import { useEnergy, useGameStore } from './game/gameStore'
import { startPassiveIncome, stopPassiveIncome } from './game/passiveIncome'
import { unlockAudio } from './platform/audio'
import { notifyGameReady } from './platform/yandexSdk'
import { CloudBar } from './ui/CloudBar'
import { LoadingScreen } from './ui/LoadingScreen'
import './App.css'

function App() {
  const [screen, setScreen] = useState<'island' | 'upgrades' | 'creatures' | 'achievements'>('island')
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
  const lastHatchedId = useGameStore((state) => state.lastHatchedId)
  const buySunwell = useGameStore((state) => state.buySunwell)
  const openEgg = useGameStore((state) => state.openEgg)
  const claimTask = useGameStore((state) => state.claimTask)
  const dismissAchievementNotice = useGameStore((state) => state.dismissAchievementNotice)
  const offlineEnergy = useGameStore((state) => state.offlineEnergy)
  const hydrated = useGameStore((state) => state.hydrated)
  const hydrate = useGameStore((state) => state.hydrate)
  const hydrateStarted = useRef(false)
  const [sceneReady, setSceneReady] = useState(false)
  const handleTreeClick = useCallback(() => {
    // Первое касание разблокирует звук: браузеры запрещают автозапуск аудио.
    void unlockAudio()
    addEnergy()
  }, [addEnergy])
  const handleSceneReady = useCallback(() => setSceneReady(true), [])
  const lastHatched = lastHatchedId ? getCreature(lastHatchedId) : undefined
  const gameReady = hydrated && sceneReady

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
        <div className="resource-card" aria-label={`Энергия: ${energy}`}>
          <span className="resource-icon">✦</span>
          <div>
            <span className="resource-label">Энергия</span>
            <strong>{energy.toLocaleString()}</strong>
          </div>
        </div>
        <div className="resource-pills">
          <span title="Звёзды постоянных наград">★ {stars}</span>
          <span title="Наградные яйца">🥚 {eggInventory}</span>
        </div>
      </header>

      <CloudBar />

      {achievementNotice && (
        <button className="achievement-toast" type="button" onClick={dismissAchievementNotice}>
          <span>🏆</span>
          <strong>{achievementNotice}</strong>
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
          <span>+{clickPower} / клик</span>
          <span>+{energyPerSecond} / сек</span>
        </div>
        <button
          className="upgrade-button"
          type="button"
          disabled={!hydrated || energy < clickUpgradeCost}
          onClick={buyClickUpgrade}
        >
          <span>✦</span>
          <strong>{clickUpgradeCost.toLocaleString()}</strong>
          <small>Улучшить</small>
        </button>
          </section>

          {offlineEnergy > 0 && (
            <p className="offline-note">Пока тебя не было, остров собрал {offlineEnergy.toLocaleString()} энергии.</p>
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
            onClick={buySunwell}
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
            onClick={openEgg}
          >
            {eggInventory > 0 ? 'Бесплатно' : <>{eggCost.toLocaleString()} <span>✦</span></>}
          </button>
        </article>
          </section>

          {lastHatched && (
            <section className={`hatch-result hatch-${lastHatched.rarity.toLowerCase()}`} aria-live="polite">
              <span className="creature-emoji">{lastHatched.emoji}</span>
              <div>
                <p className="eyebrow">Новый спутник · {rarityLabel(lastHatched.rarity)}</p>
                <strong>{lastHatched.name} · Ур. {ownedCreatures[lastHatched.id]}</strong>
                <span>+{lastHatched.clickBonus} к клику · +{lastHatched.productionBonus} / сек</span>
              </div>
            </section>
          )}
          <DailyTasks tasks={dailyTasks} claimTask={claimTask} />
        </>
      ) : screen === 'upgrades' ? (
        <UpgradeScreen
          clickPower={clickPower}
          clickUpgradeCost={clickUpgradeCost}
          energy={energy}
          energyPerSecond={energyPerSecond}
          hydrated={hydrated}
          sunwellCost={sunwellCost}
          sunwellLevel={sunwellLevel}
          buyClickUpgrade={buyClickUpgrade}
          buySunwell={buySunwell}
        />
      ) : screen === 'creatures' ? (
        <CreatureCollection ownedCreatures={ownedCreatures} />
      ) : (
        <AchievementScreen unlockedAchievements={unlockedAchievements} progress={{ totalClicks: useGameStore.getState().totalClicks, totalEnergyEarned: useGameStore.getState().totalEnergyEarned, eggsOpened: useGameStore.getState().eggsOpened, upgradesBought: useGameStore.getState().upgradesBought, ownedCreatures }} />
      )}

      <nav className="bottom-nav" aria-label="Игровая навигация">
        <button className={`nav-item ${screen === 'island' ? 'nav-item-active' : ''}`} type="button" onClick={() => setScreen('island')}>
          <span>◈</span> Остров
        </button>
        <button className={`nav-item ${screen === 'upgrades' ? 'nav-item-active' : ''}`} type="button" onClick={() => setScreen('upgrades')}>
          <span>✧</span> Улучшения
        </button>
        <button className={`nav-item ${screen === 'creatures' ? 'nav-item-active' : ''}`} type="button" onClick={() => setScreen('creatures')}>
          <span>♧</span> Существа
        </button>
        <button className={`nav-item ${screen === 'creatures' ? 'nav-item-active' : ''}`} type="button" onClick={() => setScreen('creatures')}>
          <span>▣</span> Коллекция
        </button>
        <button className={`nav-item ${screen === 'achievements' ? 'nav-item-active' : ''}`} type="button" onClick={() => setScreen('achievements')}>
          <span>🏆</span> Достижения
        </button>
      </nav>
    </main>
  )
}

type AchievementScreenProps = {
  unlockedAchievements: string[]
  progress: {
    totalClicks: number
    totalEnergyEarned: number
    eggsOpened: number
    upgradesBought: number
    ownedCreatures: Record<string, number>
  }
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
                <span>{task.progress.toLocaleString()} / {task.target.toLocaleString()}</span>
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
        <span className="collection-count">{energy.toLocaleString()} энергии</span>
      </div>
      <div className="upgrade-summary">
        <span>Сила клика <strong>+{clickPower}</strong></span>
        <span>Поток энергии <strong>+{energyPerSecond}/сек</strong></span>
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
    </section>
  )
}

type CreatureCollectionProps = {
  ownedCreatures: Record<string, number>
}

function CreatureCollection({ ownedCreatures }: CreatureCollectionProps) {
  const [filter, setFilter] = useState<Rarity | 'All'>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const discovered = creatures.filter((creature) => ownedCreatures[creature.id] > 0).length
  const visibleCreatures = filter === 'All'
    ? creatures
    : creatures.filter((creature) => creature.rarity === filter)
  const selectedCreature = selectedId ? getCreature(selectedId) : undefined
  const selectedLevel = selectedCreature ? ownedCreatures[selectedCreature.id] ?? 0 : 0

  return (
    <section className="collection-view" aria-label="Коллекция существ">
      <div className="collection-heading">
        <div>
          <p className="eyebrow">Живой архив</p>
          <h2>Коллекция существ</h2>
        </div>
        <span className="collection-count">{discovered} / {creatures.length} открыто</span>
      </div>
      <div className="rarity-filters" aria-label="Фильтр по редкости">
        {(['All', 'Common', 'Rare', 'Mythic'] as const).map((rarity) => (
          <button
            className={filter === rarity ? 'rarity-filter rarity-filter-active' : 'rarity-filter'}
            key={rarity}
            type="button"
            onClick={() => setFilter(rarity)}
          >
            {rarity === 'All' ? 'Все' : rarityLabel(rarity)}
          </button>
        ))}
      </div>
      <div className="creature-grid">
        {visibleCreatures.map((creature) => {
          const level = ownedCreatures[creature.id] ?? 0
          const isDiscovered = level > 0
          return (
            <button
              className={`creature-card ${isDiscovered ? `creature-${creature.rarity.toLowerCase()}` : 'creature-locked'}`}
              disabled={!isDiscovered}
              key={creature.id}
              type="button"
              onClick={() => setSelectedId(creature.id)}
            >
              <div className="creature-card-emoji">{isDiscovered ? creature.emoji : '?'}</div>
              <p className="eyebrow">{rarityLabel(creature.rarity)}</p>
              <h3>{isDiscovered ? creature.name : 'Неизвестный дух'}</h3>
              <span className="creature-level">{isDiscovered ? `Уровень ${level}` : 'Не открыто'}</span>
              <div className="creature-bonus">
                <span>+{creature.clickBonus * Math.max(level, 1)} к клику</span>
                <span>+{creature.productionBonus * Math.max(level, 1)} / сек</span>
              </div>
            </button>
          )
        })}
      </div>
      {selectedCreature && (
        <div className="creature-modal-backdrop" role="presentation" onClick={() => setSelectedId(null)}>
          <section className={`creature-modal creature-${selectedCreature.rarity.toLowerCase()}`} role="dialog" aria-modal="true" aria-label={`Характеристики: ${selectedCreature.name}`} onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Закрыть характеристики существа" onClick={() => setSelectedId(null)}>×</button>
            <div className="modal-creature-emoji">{selectedCreature.emoji}</div>
            <p className="eyebrow">Спутник · {rarityLabel(selectedCreature.rarity)}</p>
            <h3>{selectedCreature.name}</h3>
            <p className="modal-level">Уровень {selectedLevel} · собрано дубликатов: {selectedLevel}</p>
            <div className="modal-bonuses">
              <span>+{selectedCreature.clickBonus * selectedLevel} к силе клика</span>
              <span>+{selectedCreature.productionBonus * selectedLevel} энергии / сек</span>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default App
