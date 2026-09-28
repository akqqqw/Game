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
 * ВАЖНО: звуковых файлов в проекте пока нет — модуль готов к их подключению
 * (`registerSound`/`play`), но ничего не проигрывает, пока ассеты не добавлены.
 * Это отдельное решение по контенту, поэтому игра сейчас работает беззвучно.
 */

import { isGamePaused, onGamePause, onGameResume } from './gameLifecycle'

const MUTED_STORAGE_KEY = 'evolution-isles:audio-muted'
const MASTER_VOLUME = 0.7

type SoundId = string

let context: AudioContext | null = null
let masterGain: GainNode | null = null
let muted = readMutedPreference()
let initialized = false
let activeSources = new Set<AudioBufferSourceNode>()
const buffers = new Map<SoundId, AudioBuffer>()

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
    return context
  } catch (error) {
    console.info('[audio] Аудиоконтекст недоступен:', error)
    return null
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

/** Добавляет звук в реестр (после декодирования аудиоданных). */
export function registerSound(id: SoundId, buffer: AudioBuffer): void {
  buffers.set(id, buffer)
}

/**
 * Проигрывает зарегистрированный звук.
 * Если звука нет, он выключен или игра на паузе — вызов безопасен и ничего не делает.
 */
export function play(id: SoundId): void {
  if (muted) return
  const audioContext = ensureContext()
  const gain = masterGain
  const buffer = buffers.get(id)
  if (!audioContext || !gain || !buffer) return
  if (audioContext.state !== 'running') return

  const source = audioContext.createBufferSource()
  source.buffer = buffer
  source.connect(gain)
  source.onended = () => activeSources.delete(source)
  activeSources.add(source)
  source.start()
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
  activeSounds: number
} {
  return {
    muted,
    contextState: context?.state ?? null,
    registeredSounds: buffers.size,
    activeSounds: activeSources.size,
  }
}
