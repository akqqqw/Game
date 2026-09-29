import { AnimationClip, Group, Object3D, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'
import { createModelAnimator, pickAnimationClip } from '../../src/game/creatureViewer'

/**
 * Проигрывание анимаций, записанных в модели из Blender.
 *
 * Пока своих моделей нет, витрина анимирует существа сама (вращение,
 * покачивание, дыхание). Когда появятся файлы с idle-анимацией, она должна
 * включиться автоматически — именно это и проверяется здесь, без WebGL:
 * микшер three.js обновляет трансформации объектов и в тестовом окружении.
 */

/** Клип, который заметно двигает объект: удобно проверять факт проигрывания. */
function moveClip(name: string, height = 1): AnimationClip {
  const track = new VectorKeyframeTrack(
    '.position',
    [0, 0.5, 1],
    [0, 0, 0, 0, height, 0, 0, 0, 0],
  )
  return new AnimationClip(name, 1, [track])
}

/** Вращательный клип: у него нет смещений, только поворот. */
function rotateClip(name: string): AnimationClip {
  const track = new QuaternionKeyframeTrack(
    '.quaternion',
    [0, 0.5, 1],
    [0, 0, 0, 1, 0, 0.3826834, 0, 0.9238795, 0, 0, 0, 1],
  )
  return new AnimationClip(name, 1, [track])
}

describe('выбор клипа анимации', () => {
  it('предпочитает idle: в файле может быть и походка, и атака', () => {
    const walk = moveClip('Walk')
    const idle = moveClip('Idle_Loop')
    const attack = moveClip('Attack')
    expect(pickAnimationClip([walk, idle, attack])?.name).toBe('Idle_Loop')
  })

  it('регистр и подчёркивания в названии не мешают', () => {
    expect(pickAnimationClip([rotateClip('CREATURE_IDLE')])?.name).toBe('CREATURE_IDLE')
  })

  it('если idle нет — берёт первый содержательный клип', () => {
    const first = moveClip('Walk')
    expect(pickAnimationClip([first, moveClip('Run')])?.name).toBe('Walk')
  })

  it('пустые клипы и файлы без анимации не ломают витрину', () => {
    expect(pickAnimationClip([])).toBeNull()
    expect(pickAnimationClip([new AnimationClip('Empty', 0, [])])).toBeNull()
    expect(pickAnimationClip([new AnimationClip('NoTracks', 2, [])])).toBeNull()
  })
})

describe('проигрыватель анимаций модели', () => {
  it('без клипов ничего не делает: витрина анимирует существо сама', () => {
    const root = new Group()
    const animator = createModelAnimator(root, [])

    expect(animator.clipName).toBeNull()
    animator.update(1)
    expect(root.position.y).toBe(0)

    animator.dispose()
  })

  it('проигрывает клип и продвигается по времени', () => {
    const root = new Group()
    const animator = createModelAnimator(root, [moveClip('Idle', 1)])

    expect(animator.clipName).toBe('Idle')

    // Середина клипа — самая высокая точка движения.
    animator.update(0.5)
    expect(root.position.y).toBeCloseTo(1, 3)

    // Конец клипа: движение замкнулось на исходную позу.
    animator.update(0.5)
    expect(root.position.y).toBeCloseTo(0, 3)

    // Цикл повторяется бесконечно: анимация покоя не должна «завершаться».
    animator.update(0.5)
    expect(root.position.y).toBeCloseTo(1, 3)

    animator.dispose()
  })

  it('нулевая дельта ничего не сдвигает (первый кадр после открытия карточки)', () => {
    const root = new Group()
    const animator = createModelAnimator(root, [moveClip('Idle', 1)])

    animator.update(0)
    expect(root.position.y).toBe(0)

    animator.dispose()
  })

  it('после освобождения микшер отсоединён от модели', () => {
    const root = new Group()
    const animator = createModelAnimator(root, [moveClip('Idle', 1)])

    animator.dispose()
    animator.update(0.5)
    expect(root.position.y).toBe(0)
  })

  it('работает с моделью, а не только с корнем: анимирует потомков', () => {
    const root = new Group()
    const bone = new Object3D()
    bone.name = 'Body'
    root.add(bone)

    const clip = new AnimationClip('Idle', 1, [
      new VectorKeyframeTrack('Body.position', [0, 0.5, 1], [0, 0, 0, 0, 2, 0, 0, 0, 0]),
    ])

    const animator = createModelAnimator(root, [clip])
    animator.update(0.5)

    expect(bone.position.y).toBeCloseTo(2, 3)
    animator.dispose()
  })
})
