/**
 * Синтез звуков игры.
 *
 * Звуки не загружаются файлами, а рассчитываются кодом: это снимает сразу
 * несколько ограничений платформы и проекта:
 *  - нет внешних хостов (п. 1.7) и нет проблем с лицензиями на чужой звук;
 *  - ничего не нужно грузить по сети — звук работает даже при плохой связи
 *    и сразу после сборки, без «битых» путей к ассетам;
 *  - архив публикации не растёт: звуки занимают ноль байт.
 *
 * Функции здесь чистые: `renderSound(id, sampleRate)` возвращает массив
 * сэмплов, поэтому синтез проверяется тестами без Web Audio API.
 */

export type SoundId =
  /** Клик по дереву — короткий «щипок». */
  | 'click'
  /** Покупка улучшения — восходящий двойной звон. */
  | 'upgrade'
  /** Вылупление яйца — искристая арпеджио. */
  | 'egg'
  /** Слияние существ — низкий подъём с шиммером. */
  | 'fusion'
  /** Мутация — яркая восходящая фигура. */
  | 'mutation'
  /** Постройка жилища — глухой удар и тёплая квинта. */
  | 'habitat'
  /** Достижение — короткая фанфара. */
  | 'achievement'
  /** Переход между экранами — мягкий щелчок. */
  | 'ui'

export const soundIds: SoundId[] = [
  'click',
  'upgrade',
  'egg',
  'fusion',
  'mutation',
  'habitat',
  'achievement',
  'ui',
]

/** Длительность каждого звука в секундах. */
export const soundDurations: Record<SoundId, number> = {
  click: 0.16,
  upgrade: 0.5,
  egg: 0.75,
  fusion: 0.95,
  mutation: 1,
  habitat: 0.85,
  achievement: 1.1,
  ui: 0.09,
}

/** Ноты (равномерно темперированный строй, ля первой октавы = 440 Гц). */
const notes = {
  c5: 523.25,
  e5: 659.25,
  g5: 783.99,
  a5: 880,
  b5: 987.77,
  d6: 1174.66,
  g6: 1567.98,
  g3: 196,
  d4: 293.66,
  a3: 220,
  a2: 110,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Экспоненциальное затухание: основной инструмент для «щипков» и звонов. */
function decay(t: number, tau: number): number {
  return Math.exp(-t / tau)
}

/**
 * Плавная огибающая ноты: короткая атака (без щелчка на старте) и затухание.
 * `attack` в секундах, `tau` — постоянная затухания.
 */
function envelope(t: number, duration: number, attack: number, tau: number): number {
  if (t < 0 || t > duration) return 0
  const rise = attack <= 0 ? 1 : clamp(t / attack, 0, 1)
  return rise * decay(t, tau)
}

type SineOptions = {
  /** Частота в начале ноты. */
  from: number
  /** Частота в конце ноты (скольжение); по умолчанию равна `from`. */
  to?: number
  duration: number
  /** Постоянная затухания. */
  tau: number
  /** Амплитуда ноты. */
  amp: number
  attack?: number
  /** Момент начала ноты внутри буфера (секунды). */
  startAt?: number
  /** Яркость: доля третьей гармоники (0 — чистый тон). */
  brightness?: number
}

/**
 * Добавляет в буфер тон со скольжением частоты.
 * Фаза накапливается вручную — иначе скольжение даёт щелчки.
 */
function addTone(samples: Float32Array, sampleRate: number, options: SineOptions): void {
  const {
    from,
    to = from,
    duration,
    tau,
    amp,
    attack = 0.004,
    startAt = 0,
    brightness = 0,
  } = options

  const startIndex = Math.max(0, Math.floor(startAt * sampleRate))
  const endIndex = Math.min(samples.length, Math.floor((startAt + duration) * sampleRate))
  let phase = 0
  let phaseThird = 0

  for (let index = startIndex; index < endIndex; index += 1) {
    const t = (index - startIndex) / sampleRate
    const progress = duration <= 0 ? 1 : t / duration
    const frequency = from + (to - from) * progress
    phase += (2 * Math.PI * frequency) / sampleRate
    phaseThird += (2 * Math.PI * frequency * 3) / sampleRate

    const level = envelope(t, duration, attack, tau) * amp
    const value = Math.sin(phase) + brightness * Math.sin(phaseThird)
    samples[index] += value * level
  }
}

/** Добавляет короткий шумовой всплеск — «щелчок» пальца или шорох. */
function addNoise(
  samples: Float32Array,
  sampleRate: number,
  options: { duration: number; tau: number; amp: number; startAt?: number; seed?: number },
): void {
  const { duration, tau, amp, startAt = 0, seed = 1 } = options
  const startIndex = Math.max(0, Math.floor(startAt * sampleRate))
  const endIndex = Math.min(samples.length, Math.floor((startAt + duration) * sampleRate))

  // Детерминированный псевдослучайный ряд: звук не меняется между запусками,
  // поэтому синтез можно проверять тестами.
  let state = Math.floor(seed * 0x9e3779b9) >>> 0 || 0x12345678
  for (let index = startIndex; index < endIndex; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const noise = (state / 0xffffffff) * 2 - 1
    const t = (index - startIndex) / sampleRate
    samples[index] += noise * decay(t, tau) * amp
  }
}

/**
 * Нормализует буфер к заданной пиковой амплитуде.
 * Синтез разных звуков не должен отличаться громкостью: это раздражает.
 */
function normalize(samples: Float32Array, peak = 0.72): void {
  let max = 0
  for (const sample of samples) {
    const value = Math.abs(sample)
    if (value > max) max = value
  }
  if (max <= 0) return
  const scale = peak / max
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= scale
  }
}

/** Основной сценарий: собирает звук нужной длительности. */
function build(id: SoundId, sampleRate: number, duration: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.ceil(duration * sampleRate))
  const tone = (options: SineOptions): void => addTone(samples, sampleRate, options)
  const noise = (options: Parameters<typeof addNoise>[2]): void => addNoise(samples, sampleRate, options)

  switch (id) {
    case 'click': {
      // Мягкий «щипок»: короткий тон со скольжением вниз и лёгкий шорох сверху.
      tone({ from: 700, to: 520, duration, tau: 0.035, amp: 0.9, brightness: 0.25 })
      noise({ duration: 0.02, tau: 0.006, amp: 0.25, seed: 7 })
      break
    }
    case 'upgrade': {
      // Двойной восходящий звон: «куплено, стало лучше».
      tone({ from: notes.e5, duration: 0.22, tau: 0.09, amp: 0.8, brightness: 0.18 })
      tone({ from: notes.b5, duration: 0.34, tau: 0.13, amp: 0.7, startAt: 0.1, brightness: 0.14 })
      break
    }
    case 'egg': {
      // Искристая арпеджио вверх — момент появления существа.
      tone({ from: notes.c5, duration: 0.3, tau: 0.1, amp: 0.7 })
      tone({ from: notes.e5, duration: 0.3, tau: 0.1, amp: 0.65, startAt: 0.09 })
      tone({ from: notes.g5, duration: 0.45, tau: 0.16, amp: 0.7, startAt: 0.18, brightness: 0.2 })
      noise({ duration: 0.5, tau: 0.16, amp: 0.1, seed: 21 })
      break
    }
    case 'fusion': {
      // Низкий подъём: две стихии сливаются в одну, сверху — шиммер.
      tone({ from: notes.a2, to: notes.a3, duration: 0.6, tau: 0.4, amp: 0.9, attack: 0.05 })
      tone({ from: notes.a3, to: notes.a5, duration: 0.5, tau: 0.25, amp: 0.35, attack: 0.08, startAt: 0.12 })
      tone({ from: notes.g6, duration: 0.5, tau: 0.18, amp: 0.22, startAt: 0.4, brightness: 0.3 })
      noise({ duration: 0.7, tau: 0.22, amp: 0.12, startAt: 0.05, seed: 33 })
      break
    }
    case 'mutation': {
      // Яркая восходящая фигура + колокольчик: редкость и удача.
      tone({ from: notes.g5, duration: 0.25, tau: 0.08, amp: 0.6 })
      tone({ from: notes.b5, duration: 0.25, tau: 0.09, amp: 0.6, startAt: 0.08 })
      tone({ from: notes.d6, duration: 0.3, tau: 0.12, amp: 0.6, startAt: 0.16 })
      tone({ from: notes.g6, duration: 0.6, tau: 0.3, amp: 0.55, startAt: 0.24, brightness: 0.35 })
      break
    }
    case 'habitat': {
      // Глухой удар постройки и тёплая квинта — «дом готов».
      tone({ from: 90, to: 70, duration: 0.3, tau: 0.1, amp: 1 })
      tone({ from: notes.g3, duration: 0.6, tau: 0.28, amp: 0.45, startAt: 0.06, brightness: 0.2 })
      tone({ from: notes.d4, duration: 0.55, tau: 0.24, amp: 0.35, startAt: 0.11, brightness: 0.15 })
      break
    }
    case 'achievement': {
      // Короткая фанфара: три ноты, последняя держится.
      tone({ from: notes.c5, duration: 0.3, tau: 0.12, amp: 0.7 })
      tone({ from: notes.e5, duration: 0.3, tau: 0.12, amp: 0.7, startAt: 0.12 })
      tone({ from: notes.g5, duration: 0.7, tau: 0.35, amp: 0.8, startAt: 0.24, brightness: 0.2 })
      break
    }
    case 'ui': {
      // Совсем короткий мягкий щелчок перехода.
      tone({ from: notes.a5, duration, tau: 0.018, amp: 0.5, attack: 0.002 })
      break
    }
  }

  normalize(samples)
  return samples
}

/** Рассчитывает звук в массив сэмплов (значения в диапазоне −1…1). */
export function renderSound(id: SoundId, sampleRate: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Некорректная частота дискретизации: ${sampleRate}`)
  }
  return build(id, sampleRate, soundDurations[id])
}

export function isSoundId(value: unknown): value is SoundId {
  return typeof value === 'string' && (soundIds as string[]).includes(value)
}
