import { describe, expect, it } from 'vitest'
import {
  isSoundId,
  renderSound,
  soundDurations,
  soundIds,
  type SoundId,
} from '../../src/platform/sounds'

/**
 * Синтез звуков: звуки считаются кодом, поэтому их можно проверять без
 * Web Audio API и без файлов — важно, что они детерминированные, не «клиппят»
 * и не тишина.
 */

const SAMPLE_RATE = 44100

function rms(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

function peak(samples: Float32Array): number {
  let max = 0
  for (const sample of samples) max = Math.max(max, Math.abs(sample))
  return max
}

describe('набор звуков', () => {
  it('содержит все игровые события', () => {
    expect(soundIds).toEqual([
      'click',
      'upgrade',
      'egg',
      'fusion',
      'mutation',
      'habitat',
      'achievement',
      'ui',
    ])
    expect(isSoundId('click')).toBe(true)
    expect(isSoundId('нет-такого')).toBe(false)
    expect(isSoundId(42)).toBe(false)
  })

  it('каждый звук короткий: игра не превращается в какофонию', () => {
    for (const id of soundIds) {
      expect(soundDurations[id]).toBeGreaterThan(0)
      expect(soundDurations[id]).toBeLessThanOrEqual(1.2)
    }
  })

  it('общая длительность звуков невелика — синтез дешёвый', () => {
    const total = soundIds.reduce((sum, id) => sum + soundDurations[id], 0)
    expect(total).toBeLessThan(6)
  })
})

describe('расчёт звука', () => {
  it('возвращает буфер нужной длины', () => {
    for (const id of soundIds) {
      const samples = renderSound(id, SAMPLE_RATE)
      expect(samples.length).toBe(Math.ceil(soundDurations[id] * SAMPLE_RATE))
    }
  })

  it('звук не пустой: у каждого есть слышимая громкость', () => {
    for (const id of soundIds) {
      const samples = renderSound(id, SAMPLE_RATE)
      expect(rms(samples), `звук ${id} слишком тихий`).toBeGreaterThan(0.01)
    }
  })

  it('нет клиппинга: значения остаются в допустимом диапазоне', () => {
    for (const id of soundIds) {
      const samples = renderSound(id, SAMPLE_RATE)
      expect(peak(samples), `звук ${id} перегружен`).toBeLessThanOrEqual(1)
    }
  })

  it('звуки начинаются и заканчиваются тишиной — без щелчков на краях', () => {
    for (const id of soundIds) {
      const samples = renderSound(id, SAMPLE_RATE)
      expect(Math.abs(samples[0]), `звук ${id} начинается с щелчка`).toBeLessThan(0.05)
      expect(Math.abs(samples[samples.length - 1]), `звук ${id} обрывается`).toBeLessThan(0.05)
    }
  })

  it('расчёт детерминированный: одинаковый вход — одинаковый звук', () => {
    for (const id of soundIds) {
      const first = renderSound(id, SAMPLE_RATE)
      const second = renderSound(id, SAMPLE_RATE)
      expect(Array.from(first)).toEqual(Array.from(second))
    }
  })

  it('работает на разных частотах дискретизации', () => {
    const low = renderSound('click', 22050)
    const high = renderSound('click', 48000)
    // Длительность сохраняется, меняется только число сэмплов.
    expect(low.length).toBe(Math.ceil(soundDurations.click * 22050))
    expect(high.length).toBe(Math.ceil(soundDurations.click * 48000))
    expect(rms(low)).toBeGreaterThan(0.01)
    expect(rms(high)).toBeGreaterThan(0.01)
  })

  it('отвергает некорректную частоту дискретизации', () => {
    expect(() => renderSound('click', 0)).toThrow()
    expect(() => renderSound('click', Number.NaN)).toThrow()
    expect(() => renderSound('click', -44100)).toThrow()
  })

  it('разные звуки отличаются друг от друга', () => {
    const signatures = new Map<SoundId, number>()
    for (const id of soundIds) {
      const samples = renderSound(id, 8000)
      const signature = rms(samples) * 1000 + samples.length
      for (const [otherId, otherSignature] of signatures) {
        expect(signature, `${id} и ${otherId} звучат одинаково`).not.toBe(otherSignature)
      }
      signatures.set(id, signature)
    }
  })
})
