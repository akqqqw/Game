/**
 * Витрина 3D-модели существа: камера, свет, цикл кадров.
 *
 * Модуль загружается лениво — только когда игрок открыл карточку существа.
 * Three.js весит около 157 КБ в сжатом виде, и он не должен попадать в
 * стартовую загрузку игры (требование 1.21: архив компактный, старт быстрый).
 *
 * Правила, которые витрина соблюдает:
 *  - нет WebGL (старый браузер, отключённая графика) — возвращаем `null`,
 *    интерфейс остаётся с эмодзи;
 *  - модель из Blender не загрузилась — молча рисуем процедурную;
 *  - игра на паузе (реклама, свёрнутая вкладка, потеря фокуса) — рендер
 *    останавливается целиком, кадры не считаются (п. 1.3, 4.7);
 *  - игрок уважает системную настройку «меньше движения» — модель статична;
 *  - при закрытии карточки всё освобождается: геометрии, материалы, контекст.
 */

import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Object3D,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { isGamePaused, onGamePause, onGameResume } from '../platform/gameLifecycle'
import { buildCreatureMesh } from './creatureMesh'
import { buildModelRecipe, creatureModelUrl, hasModelFile, type ModelRecipe } from './creatureModels'
import type { CreatureDefinition } from './creatures'

export type CreatureViewerHandle = {
  /** Что показывается: готовая модель из Blender или процедурная. */
  model: 'file' | 'procedural'
  /** Останавливает и возобновляет рендер (реклама, пауза игры). */
  setPaused: (paused: boolean) => void
  /** Полностью освобождает ресурсы. Вызывается при закрытии карточки. */
  dispose: () => void
}

export type CreatureViewerOptions = {
  /**
   * Рендер сломался уже после запуска (драйвер, шейдеры на слабом устройстве).
   * Витрина к этому моменту освободила ресурсы, а интерфейс должен вернуться
   * к эмодзи — чёрный прямоугольник вместо существа недопустим.
   */
  onError?: () => void
}

export type CreatureViewerTarget = Pick<CreatureDefinition, 'id' | 'elements' | 'rarity'>

/**
 * Есть ли в браузере WebGL. Проверяем без создания рендера: в jsdom и в
 * окружениях без графики `WebGLRenderingContext` просто не существует.
 */
export function supportsWebgl(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (typeof WebGLRenderingContext === 'undefined') return false

  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Игрок просил меньше движения — витрина не крутит модель. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Освобождает геометрии и материалы загруженной модели. */
function disposeObject(root: Group): void {
  root.traverse((child) => {
    const mesh = child as unknown as { geometry?: { dispose?: () => void }; material?: unknown }
    mesh.geometry?.dispose?.()

    const material = mesh.material
    if (Array.isArray(material)) {
      for (const item of material) (item as { dispose?: () => void }).dispose?.()
    } else {
      (material as { dispose?: () => void } | undefined)?.dispose?.()
    }
  })
}

/**
 * Подгоняет загруженную модель под витрину: центрирует и приводит к единому
 * размеру. Модели из Blender могут быть нарисованы в любом масштабе, поэтому
 * игра не полагается на договорённость, а нормализует сама.
 */
function normalizeModel(model: Group): void {
  const box = new Box3().setFromObject(model)
  if (box.isEmpty()) return

  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z) || 1
  const targetSize = 1.9
  const scale = targetSize / maxDimension

  model.position.sub(center)
  model.scale.setScalar(scale)
  // После центрирования опускаем модель так, чтобы её низ был на «полу» −0.9.
  model.position.y += (size.y * scale) / 2 - 0.9
}

/**
 * Анимация, записанная в модели, — проигрыватель клипов.
 * `clipName === null` означает «в модели анимации нет»: тогда витрина анимирует
 * существо сама (вращение, покачивание, дыхание).
 */
export type ModelAnimator = {
  /** Имя проигрываемого клипа или `null`, если анимации в модели нет. */
  clipName: string | null
  /** Продвигает анимацию на `delta` секунд. */
  update: (delta: number) => void
  /** Останавливает и освобождает микшер. */
  dispose: () => void
}

/**
 * Выбирает клип для показа.
 * Приоритет — имя со словом `idle`: так анимация покоя подхватывается
 * автоматически, даже если в файле есть и другие действия (походка, атака).
 * Иначе берётся первый содержательный клип.
 */
export function pickAnimationClip(clips: AnimationClip[]): AnimationClip | null {
  const usable = clips.filter((clip) => clip.duration > 0 && clip.tracks.length > 0)
  if (usable.length === 0) return null
  return usable.find((clip) => clip.name.toLowerCase().includes('idle')) ?? usable[0]
}

/**
 * Готовит проигрыватель анимаций для загруженной модели.
 * Вынесен отдельно от рендера, чтобы проверяться тестами без WebGL.
 */
export function createModelAnimator(root: Object3D, clips: AnimationClip[]): ModelAnimator {
  const clip = pickAnimationClip(clips)
  if (!clip) {
    return { clipName: null, update: () => undefined, dispose: () => undefined }
  }

  const mixer = new AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.setLoop(2201 /* LoopRepeat */, Number.POSITIVE_INFINITY)
  action.play()

  return {
    clipName: clip.name,
    update: (delta) => {
      if (delta > 0) mixer.update(delta)
    },
    dispose: () => {
      action.stop()
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
    },
  }
}

type LoadedModel = { scene: Group; animations: AnimationClip[] }

/** Пытается загрузить модель из файла. Возвращает `null`, если файла нет или он битый. */
async function loadModelFile(id: string): Promise<LoadedModel | null> {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(creatureModelUrl(id))
    const model = gltf.scene as unknown as Group
    normalizeModel(model)
    return { scene: model, animations: gltf.animations ?? [] }
  } catch {
    // Файла ещё нет или он повреждён — это штатный случай: рисуем процедурную.
    return null
  }
}

function applyLights(scene: Scene, recipe: ModelRecipe): void {
  scene.add(new HemisphereLight(0xffffff, 0x24303f, 1.1))

  const key = new DirectionalLight(0xffffff, 1.5)
  key.position.set(2.4, 3.6, 3.8)
  scene.add(key)

  const rim = new PointLight(new Color(recipe.colors.accent), 14, 12)
  rim.position.set(-2.2, 1.6, -1.8)
  scene.add(rim)
}

/**
 * Готовит витрину в контейнере. `null` означает «3D здесь не будет» —
 * интерфейс обязан остаться с эмодзи.
 */
export async function mountCreatureViewer(
  container: HTMLElement,
  creature: CreatureViewerTarget,
  options: CreatureViewerOptions = {},
): Promise<CreatureViewerHandle | null> {
  if (!supportsWebgl()) return null

  const recipe = buildModelRecipe(creature)
  const width = Math.max(1, container.clientWidth || 320)
  const height = Math.max(1, container.clientHeight || 240)

  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  } catch {
    return null
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  container.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(38, width / height, 0.1, 60)
  camera.position.set(0, 0.6, 3.9)
  camera.lookAt(0, 0.05, 0)
  applyLights(scene, recipe)

  // Всё вращаем вокруг общего узла: и файловую модель, и процедурную.
  const pivot = new Group()
  scene.add(pivot)

  let model: 'file' | 'procedural' = 'procedural'
  let disposeModel: () => void
  let animator: ModelAnimator = { clipName: null, update: () => undefined, dispose: () => undefined }

  const loaded = hasModelFile(creature.id) ? await loadModelFile(creature.id) : null
  if (loaded) {
    model = 'file'
    pivot.add(loaded.scene)
    // Если автор модели записал idle-анимацию, играет она; иначе витрина
    // анимирует существо сама (см. ниже). Это и есть «потом» из плана: файл
    // с анимацией подхватывается без единой правки кода.
    animator = createModelAnimator(loaded.scene, loaded.animations)
    disposeModel = () => {
      animator.dispose()
      disposeObject(loaded.scene)
    }
  } else {
    const procedural = buildCreatureMesh(recipe)
    pivot.add(procedural.group)
    disposeModel = procedural.dispose
  }

  // Своя анимация модели отменяет покачивание и дыхание: они бы спорили с ней.
  // Вращение-витрина остаётся — игроку нужно рассмотреть существо со всех сторон.
  const selfAnimated = animator.clipName !== null

  const animate = !prefersReducedMotion()
  let paused = isGamePaused()
  let frameId: number | null = null
  let lastTime = 0
  let elapsed = 0

  // Первый кадр рисуем сразу, до возврата витрины: если устройство не может
  // отрисовать модель, игрок увидит эмодзи, а не пустое окно.
  try {
    renderer.render(scene, camera)
  } catch (error) {
    console.info('[model] Не удалось нарисовать модель:', error)
    disposeModel()
    scene.clear()
    renderer.dispose()
    renderer.domElement.remove()
    return null
  }

  const renderFrame = (time: number): void => {
    if (paused) {
      frameId = null
      return
    }

    const delta = lastTime === 0 ? 0 : Math.min(0.05, (time - lastTime) / 1000)
    lastTime = time
    elapsed += delta

    if (animate) {
      pivot.rotation.y += recipe.spin * delta
      // Дыхание и покачивание — только у моделей без собственной анимации.
      if (selfAnimated) {
        animator.update(delta)
      } else {
        pivot.position.y = Math.sin(elapsed * 1.4) * recipe.float
        pivot.rotation.z = Math.sin(elapsed * 0.9) * 0.03
        const breath = 1 + Math.sin(elapsed * 0.7) * recipe.breath
        pivot.scale.set(1, breath, 1)
      }
    }

    try {
      renderer.render(scene, camera)
    } catch (error) {
      // Рендер сломался на ходу: освобождаем всё и отдаём слово интерфейсу.
      console.info('[model] Рендер прерван:', error)
      frameId = null
      dispose()
      options.onError?.()
      return
    }

    frameId = window.requestAnimationFrame(renderFrame)
  }

  const startLoop = (): void => {
    if (frameId !== null || paused) return
    lastTime = 0
    frameId = window.requestAnimationFrame(renderFrame)
  }

  const stopLoop = (): void => {
    if (frameId === null) return
    window.cancelAnimationFrame(frameId)
    frameId = null
  }

  const resize = (): void => {
    const nextWidth = Math.max(1, container.clientWidth || width)
    const nextHeight = Math.max(1, container.clientHeight || height)
    renderer.setSize(nextWidth, nextHeight, false)
    camera.aspect = nextWidth / nextHeight
    camera.updateProjectionMatrix()
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  observer?.observe(container)
  window.addEventListener('resize', resize)

  const pauseListener = (): void => {
    paused = true
    stopLoop()
  }
  const resumeListener = (): void => {
    paused = false
    startLoop()
  }
  const unsubscribePause = onGamePause(pauseListener)
  const unsubscribeResume = onGameResume(resumeListener)

  const handleContextLost = (event: Event): void => {
    event.preventDefault()
    paused = true
    stopLoop()
  }
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost)

  const setPaused = (next: boolean): void => {
    paused = next
    if (next) stopLoop()
    else startLoop()
  }

  const dispose = (): void => {
    stopLoop()
    unsubscribePause()
    unsubscribeResume()
    observer?.disconnect()
    window.removeEventListener('resize', resize)
    renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)

    disposeModel()
    scene.clear()
    renderer.dispose()
    renderer.forceContextLoss?.()
    renderer.domElement.remove()
  }

  startLoop()

  return { model, setPaused, dispose }
}
