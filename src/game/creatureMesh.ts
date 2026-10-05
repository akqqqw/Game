/**
 * Сборка 3D-меша существа из рецепта (`creatureModels.ts`).
 *
 * Только геометрия: никакого WebGL, окна и рендера. Благодаря этому меш можно
 * собирать и проверять в тестах (jsdom), а витрина (`creatureViewer.ts`)
 * остаётся тонким слоем «камера + свет + цикл кадров».
 *
 * Все созданные геометрии и материалы собираются в список и освобождаются в
 * `dispose()`: карточку существа открывают часто, утечки GPU-памяти недопустимы.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import type { BodyShape, ModelFeature, ModelRecipe } from './creatureModels'

export type CreatureMesh = {
  /** Готовая модель: тело, глаза, украшения. */
  group: Group
  /** Освобождает геометрии и материалы. Вызывать при закрытии витрины. */
  dispose: () => void
}

type Builder = {
  group: Group
  /** Все созданные ресурсы GPU: освобождаются одной функцией. */
  resources: (BufferGeometry | Material)[]
  track: <T extends BufferGeometry | Material>(resource: T) => T
  bodyMaterial: MeshStandardMaterial
  accentMaterial: MeshStandardMaterial
  glowMaterial: MeshStandardMaterial
  /** Полувысота тела: украшения ставятся от его верхней точки. */
  bodyHeight: number
}

function bodyGeometry(shape: BodyShape): BufferGeometry {
  switch (shape) {
    case 'capsule':
      return new CapsuleGeometry(0.4, 0.5, 8, 20)
    case 'icosahedron':
      return new IcosahedronGeometry(0.68, 1)
    case 'octahedron':
      return new OctahedronGeometry(0.74, 0)
    case 'dodecahedron':
      return new DodecahedronGeometry(0.68, 0)
    case 'cone':
      return new ConeGeometry(0.6, 1.1, 18)
    case 'sphere':
    default:
      return new SphereGeometry(0.66, 32, 24)
  }
}

function createBuilder(recipe: ModelRecipe): Builder {
  const group = new Group()
  const resources: (BufferGeometry | Material)[] = []

  const track = <T extends BufferGeometry | Material>(resource: T): T => {
    resources.push(resource)
    return resource
  }

  const bodyMaterial = track(new MeshStandardMaterial({
    color: recipe.colors.body,
    roughness: 0.55,
    metalness: 0.08,
    emissive: recipe.colors.glow,
    emissiveIntensity: recipe.glowStrength * 0.35,
  }))
  const accentMaterial = track(new MeshStandardMaterial({
    color: recipe.colors.accent,
    roughness: 0.45,
    metalness: 0.12,
    emissive: recipe.colors.glow,
    emissiveIntensity: recipe.glowStrength * 0.2,
  }))
  const glowMaterial = track(new MeshStandardMaterial({
    color: recipe.colors.glow,
    roughness: 0.2,
    metalness: 0,
    emissive: recipe.colors.glow,
    emissiveIntensity: 0.5 + recipe.glowStrength * 0.5,
  }))

  return {
    group,
    resources,
    track,
    bodyMaterial,
    accentMaterial,
    glowMaterial,
    bodyHeight: 0.66 * recipe.bodyScale[1],
  }
}

/** Тело существа: основной силуэт. */
function addBody(builder: Builder, recipe: ModelRecipe): void {
  const geometry = builder.track(bodyGeometry(recipe.body))
  const mesh = new Mesh(geometry, builder.bodyMaterial)
  mesh.scale.set(recipe.bodyScale[0], recipe.bodyScale[1], recipe.bodyScale[2])
  mesh.name = 'body'
  builder.group.add(mesh)
}

/** Глаза: два светящихся шарика со зрачками — самое важное для «живости». */
function addEyes(builder: Builder, recipe: ModelRecipe): void {
  const eyeGeometry = builder.track(new SphereGeometry(0.1, 16, 12))
  const pupilGeometry = builder.track(new SphereGeometry(0.05, 12, 10))
  const pupilMaterial = builder.track(new MeshStandardMaterial({ color: 0x101820, roughness: 0.35 }))
  const depth = 0.6 * recipe.bodyScale[2]
  const height = 0.16 * recipe.bodyScale[1]
  const spread = 0.24

  for (const side of [-1, 1]) {
    const eye = new Mesh(eyeGeometry, builder.glowMaterial)
    eye.position.set(side * spread, height, depth * 0.82)
    eye.name = 'eye'
    builder.group.add(eye)

    const pupil = new Mesh(pupilGeometry, pupilMaterial)
    pupil.position.set(side * spread, height, depth * 0.82 + 0.06)
    builder.group.add(pupil)
  }
}

/** Лапки: две небольшие опоры в цвете украшений. */
function addFeet(builder: Builder, recipe: ModelRecipe): void {
  const geometry = builder.track(new CylinderGeometry(0.12, 0.16, 0.24, 12))
  const base = -builder.bodyHeight - 0.02

  for (const side of [-1, 1]) {
    const foot = new Mesh(geometry, builder.accentMaterial)
    foot.position.set(side * 0.22 * recipe.bodyScale[0], base, 0.12)
    builder.group.add(foot)
  }
}

/** Украшение одного вида: сколько элементов и как их расставить. */
function addFeature(builder: Builder, recipe: ModelRecipe, feature: ModelFeature): void {
  const size = feature.size * (0.8 + recipe.bodyScale[1] * 0.3)

  switch (feature.kind) {
    case 'spikes': {
      const geometry = builder.track(new ConeGeometry(0.1 * size, 0.34 * size, 12))
      for (let index = 0; index < feature.count; index += 1) {
        const angle = (index / feature.count) * Math.PI * 2
        const spike = new Mesh(geometry, builder.accentMaterial)
        spike.position.set(
          Math.cos(angle) * 0.42 * recipe.bodyScale[0],
          builder.bodyHeight * 0.72,
          Math.sin(angle) * 0.42 * recipe.bodyScale[2],
        )
        spike.rotation.z = -Math.cos(angle) * 0.5
        spike.rotation.x = Math.sin(angle) * 0.5
        builder.group.add(spike)
      }
      break
    }
    case 'fins': {
      const geometry = builder.track(new ConeGeometry(0.18 * size, 0.5 * size, 4))
      for (let index = 0; index < feature.count; index += 1) {
        const angle = (index / feature.count) * Math.PI * 2 + 0.4
        const fin = new Mesh(geometry, builder.accentMaterial)
        fin.position.set(
          Math.cos(angle) * 0.6 * recipe.bodyScale[0],
          -0.12 * recipe.bodyScale[1],
          Math.sin(angle) * 0.6 * recipe.bodyScale[2],
        )
        fin.scale.set(1, 1, 0.35)
        fin.rotation.x = Math.PI / 2.4
        fin.rotation.z = angle
        builder.group.add(fin)
      }
      break
    }
    case 'wings': {
      const geometry = builder.track(new ConeGeometry(0.34 * size, 0.9 * size, 4))
      for (const side of [-1, 1]) {
        const wing = new Mesh(geometry, builder.accentMaterial)
        wing.position.set(side * 0.62 * recipe.bodyScale[0], 0.16, -0.06)
        wing.scale.set(1, 0.4, 1)
        wing.rotation.z = side * 0.9
        wing.rotation.y = side * 0.3
        builder.group.add(wing)
      }
      break
    }
    case 'crystals': {
      const geometry = builder.track(new OctahedronGeometry(0.16 * size, 0))
      for (let index = 0; index < feature.count; index += 1) {
        const angle = (index / feature.count) * Math.PI * 2 + 0.9
        const crystal = new Mesh(geometry, builder.glowMaterial)
        crystal.position.set(
          Math.cos(angle) * 0.5 * recipe.bodyScale[0],
          0.28 * recipe.bodyScale[1] - (index % 2 === 0 ? 0 : 0.24),
          Math.sin(angle) * 0.5 * recipe.bodyScale[2],
        )
        crystal.rotation.y = angle
        builder.group.add(crystal)
      }
      break
    }
    case 'crown': {
      const ring = builder.track(new TorusGeometry(0.24 * size, 0.045 * size, 10, 24))
      const crown = new Mesh(ring, builder.glowMaterial)
      crown.position.y = builder.bodyHeight * 0.98
      crown.rotation.x = Math.PI / 2
      builder.group.add(crown)

      const toothGeometry = builder.track(new ConeGeometry(0.05 * size, 0.16 * size, 8))
      for (const side of [-1, 0, 1]) {
        const tooth = new Mesh(toothGeometry, builder.glowMaterial)
        tooth.position.set(side * 0.16 * size, builder.bodyHeight * 0.98 + 0.08 * size, 0)
        builder.group.add(tooth)
      }
      break
    }
    case 'tail': {
      const geometry = builder.track(new ConeGeometry(0.16 * size, 0.6 * size, 12))
      const tail = new Mesh(geometry, builder.accentMaterial)
      tail.position.set(0, -0.1, -0.62 * recipe.bodyScale[2])
      tail.rotation.x = Math.PI / 2.2
      builder.group.add(tail)
      break
    }
    case 'ears': {
      const geometry = builder.track(new ConeGeometry(0.11 * size, 0.3 * size, 10))
      for (const side of [-1, 1]) {
        const ear = new Mesh(geometry, builder.accentMaterial)
        ear.position.set(side * 0.26 * recipe.bodyScale[0], builder.bodyHeight * 0.86, 0.05)
        ear.rotation.z = side * 0.34
        builder.group.add(ear)
      }
      break
    }
    case 'aura': {
      const geometry = builder.track(new TorusGeometry(0.95 * size, 0.02, 8, 48))
      const auraMaterial = builder.track(new MeshStandardMaterial({
        color: recipe.colors.glow,
        emissive: recipe.colors.glow,
        emissiveIntensity: 1,
        transparent: true,
        opacity: 0.34,
        roughness: 0.3,
      }))
      const aura = new Mesh(geometry, auraMaterial)
      aura.position.y = 0.04
      aura.rotation.x = Math.PI / 2.6
      aura.name = 'aura'
      builder.group.add(aura)
      break
    }
    default: {
      // Неизвестное украшение просто пропускаем: модель остаётся целой.
      const geometry = builder.track(new BoxGeometry(0.1, 0.1, 0.1))
      const extra = new Mesh(geometry, builder.accentMaterial)
      builder.group.add(extra)
    }
  }
}

/**
 * Собирает модель существа: тело, глаза, лапки и украшения стихии.
 * Возвращает группу и функцию освобождения ресурсов.
 */
export function buildCreatureMesh(recipe: ModelRecipe): CreatureMesh {
  const builder = createBuilder(recipe)

  addBody(builder, recipe)
  addEyes(builder, recipe)
  addFeet(builder, recipe)
  for (const feature of recipe.features) addFeature(builder, recipe, feature)

  return {
    group: builder.group,
    dispose: () => {
      for (const resource of builder.resources) resource.dispose()
      builder.group.clear()
      builder.group.removeFromParent()
    },
  }
}
