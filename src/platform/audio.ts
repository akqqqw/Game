/**
 * Звук игры: единая точка управления громкостью и паузой.
 *
 * Требование платформы п. 1.3: при потере фокуса звук из игры останавливается,
 * п. 4.7: на время полноэкранной и вознаграждаемой рекламы звук ставится на паузу.
 * Чтобы это выполнялось автоматически, модуль подписан на единые события паузы
 * и возобновления игры (`src/platform/gameLifecycle.ts`) — отдельной логики
 * в игровом коде не требуется.
 *
 * Настройка «звук выключен» сохраняется между сессиями.
 *
 * Звуки синтезируются кодом (`src/platform/sounds.ts`) — файлов в архиве нет,
 * внешних загрузок тоже. Банк звуков собирается при создании аудиоконтекста,
 * то есть после первого действия игрока: до этого браузеры всё равно не дают
 * ничего проигрывать.
 */

import { isGamePaused, onGamePause, onGameResume } from './gameLifecycle'
import { renderSound, soundIds } from './sounds'

const MUTED_STORAGE_KEY = 'evolution-isles:audio-muted'
const MASTER_VOLUME = 0.7

let context: AudioContext | null = null
let masterGain: GainNode | null = null
let muted = readMutedPreference()
let initialized = false
let activeSources = new Set<AudioBufferSourceNode>()
const buffers = new Map<string, AudioBuffer>()
let bankReady = false

function readMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(MUTED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeMutedPreference(value: boolean): void {
  try {
    window.localStorage.setItem(MUTED_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // Приватный режим браузера: настройка просто не сохранится.
  }
}

function canUseAudio(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined'
}

/** Создаёт аудиоконтекст (лениво) и подписывается на события паузы. */
export function initAudio(): void {
  if (initialized) return
  initialized = true

  onGamePause(() => {
    // Полная остановка звука: и пауза контекста, и обрыв уже играющих источников.
    stopAllSounds()
    void suspendAudio()
  })

  onGameResume(() => {
    void resumeAudio()
  })
}

/**
 * Разблокирует звук после первого действия игрока.
 * Браузеры запрещают автозапуск: вызывать из обработчика клика.
 */
export async function unlockAudio(): Promise<void> {
  if (!canUseAudio()) return
  const audioContext = ensureContext()
  if (!audioContext) return
  if (audioContext.state === 'suspended' && !isGamePaused()) {
    try {
      await audioContext.resume()
    } catch {
      // Игнорируем: звук не критичен для игрового процесса.
    }
  }
}

function ensureContext(): AudioContext | null {
  if (context && masterGain) return context
  if (!canUseAudio()) return null

  try {
    context = new AudioContext()
    masterGain = context.createGain()
    masterGain.gain.value = muted ? 0 : MASTER_VOLUME
    masterGain.connect(context.destination)
    installSoundBank(context)
    return context
  } catch (error) {
    console.info('[audio] Аудиоконтекст недоступен:', error)
    return null
  }
}

/**
 * Считает звуки в аудиобуферы. Вызывается один раз при создании контекста:
 * до первого действия игрока звук всё равно заблокирован браузером.
 */
function installSoundBank(audioContext: AudioContext): void {
  if (bankReady) return
  bankReady = true

  for (const id of soundIds) {
    try {
      // `createBuffer` есть не во всех реализациях (и не в тестовых заглушках):
      // без него игра просто остаётся беззвучной, но не падает.
      if (typeof audioContext.createBuffer !== 'function') return
      const samples = renderSound(id, audioContext.sampleRate)
      const buffer = audioContext.createBuffer(1, samples.length, audioContext.sampleRate)
      buffer.copyToChannel(samples, 0)
      registerSound(id, buffer)
    } catch (error) {
      console.info(`[audio] Не удалось собрать звук «${id}»:`, error)
    }
  }
}

async function suspendAudio(): Promise<void> {
  if (!context || context.state !== 'running') return
  try {
    await context.suspend()
  } catch {
    // Некоторые браузеры не дают приостановить контекст — не критично.
  }
}

async function resumeAudio(): Promise<void> {
  if (!context || muted) return
  if (context.state !== 'suspended') return
  try {
    await context.resume()
  } catch {
    // Игнорируем.
  }
}

/** Включает/выключает звук. Возвращает новое состояние. */
export function setMuted(value: boolean): boolean {
  muted = value
  writeMutedPreference(value)

  if (masterGain) masterGain.gain.value = value ? 0 : MASTER_VOLUME
  if (value) {
    stopAllSounds()
    void suspendAudio()
  } else {
    void resumeAudio()
  }
  return muted
}

export function isMuted(): boolean {
  return muted
}

export function toggleMuted(): boolean {
  return setMuted(!muted)
}

/** Добавляет звук в реестр (используется банком синтезированных звуков). */
export function registerSound(id: string, buffer: AudioBuffer): void {
  buffers.set(id, buffer)
}

/**
 * Проигрывает зарегистрированный звук.
 * Если звука нет, он выключен или игра на паузе — вызов безопасен и ничего не делает.
 *
 * `rate` меняет тон и скорость: для частых звуков (клик по дереву) небольшая
 * вариация убирает эффект «пулемёта».
 */
export function play(id: string, options: { rate?: number; volume?: number } = {}): void {
  if (muted) return
  const audioContext = ensureContext()
  const gain = masterGain
  const buffer = buffers.get(id)
  if (!audioContext || !gain || !buffer) return

  if (audioContext.state !== 'running') {
    // Контекст ещё разблокируется (самое первое действие игрока): звук встаёт в
    // очередь и прозвучит сразу после разблокировки — первый клик не молчит.
    // Во время паузы (реклама, потеря фокуса) очередь не копим, иначе после
    // возобновления ударил бы залп из всех пропущенных звуков.
    if (audioContext.state !== 'suspended' || isGamePaused()) return
  }

  const source = audioContext.createBufferSource()
  source.buffer = buffer

  const rate = clampRate(options.rate)
  if (rate !== 1 && 'playbackRate' in source) {
    source.playbackRate.value = rate
  }

  if (options.volume !== undefined && options.volume !== 1) {
    // Отдельная громкость на вызов: нужна, чтобы приглушить фоновые звуки.
    const volumeGain = audioContext.createGain()
    volumeGain.gain.value = clampVolume(options.volume)
    source.connect(volumeGain)
    volumeGain.connect(gain)
  } else {
    source.connect(gain)
  }

  source.onended = () => activeSources.delete(source)
  activeSources.add(source)
  source.start()
}

/** Тон в разумных пределах: 0.5–2 без крайностей и мусора. */
function clampRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) return 1
  return Math.min(Math.max(rate, 0.5), 2)
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1
  return Math.min(Math.max(volume, 0), 1)
}

/**
 * Проигрывает частый звук с небольшой случайной вариацией тона и приглушением.
 * Используется для кликов: одинаковый звук подряд быстро надоедает, а наложения
 * при быстром нажатии не должны перегружать звук.
 */
export function playVaried(id: string, spread = 0.08, volume = 0.6): void {
  play(id, { rate: 1 + (Math.random() * 2 - 1) * spread, volume })
}

/** Немедленно обрывает все звуки (потеря фокуса, реклама, выключение звука). */
export function stopAllSounds(): void {
  for (const source of activeSources) {
    try {
      source.stop()
    } catch {
      // Источник мог уже завершиться.
    }
  }
  activeSources = new Set()
}

/** Состояние звукового движка для отладки и тестов. */
export function getAudioState(): {
  muted: boolean
  contextState: string | null
  registeredSounds: number
  expectedSounds: number
  activeSounds: number
  /** Готов ли банк синтезированных звуков. */
  bankReady: boolean
} {
  return {
    muted,
    contextState: context?.state ?? null,
    registeredSounds: buffers.size,
    expectedSounds: soundIds.length,
    activeSounds: activeSources.size,
    bankReady,
  }
}

/** Только для тестов: сбрасывает банк звуков. */
export function resetAudioBankForTests(): void {
  buffers.clear()
  bankReady = false
}
