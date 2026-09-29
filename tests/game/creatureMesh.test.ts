import { Box3, BufferGeometry, Group, Material, Mesh, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { buildCreatureMesh } from '../../src/game/creatureMesh'
import { buildModelRecipe } from '../../src/game/creatureModels'
import { elementIds } from '../../src/game/elements'

function meshesOf(group: Group): Mesh[] {
  return group.children.filter((child): child is Mesh => child instanceof Mesh)
}

describe('сборка меша существа', () => {
  it('рисует тело, глаза и лапки', () => {
    const recipe = buildModelRecipe({ id: 'mossling', elements: ['nature'], rarity: 'Common' })
    const { group, dispose } = buildCreatureMesh(recipe)

    const meshes = meshesOf(group)
    // Тело + два глаза + два зрачка + две лапки.
    expect(meshes.length).toBeGreaterThanOrEqual(7)
    expect(meshes.some((mesh) => mesh.name === 'body')).toBe(true)
    expect(meshes.filter((mesh) => mesh.name === 'eye')).toHaveLength(2)

    dispose()
  })

  it('собирается для каждой стихии без ошибок', () => {
    for (const element of elementIds) {
      const recipe = buildModelRecipe({ id: `creature-${element}`, elements: [element], rarity: 'Rare' })
      const { group, dispose } = buildCreatureMesh(recipe)
      expect(group.children.length).toBeGreaterThan(3)
      dispose()
    }
  })

  it('мифическое существо получает ауру вокруг тела', () => {
    const recipe = buildModelRecipe({ id: 'worldtree', elements: ['nature', 'fire'], rarity: 'Mythic' })
    const { group, dispose } = buildCreatureMesh(recipe)

    expect(meshesOf(group).some((mesh) => mesh.name === 'aura')).toBe(true)

    dispose()
  })

  it('освобождает все геометрии и материалы — утечек GPU-памяти нет', () => {
    const recipe = buildModelRecipe({ id: 'dewfin', elements: ['water'], rarity: 'Common' })
    const { group, dispose } = buildCreatureMesh(recipe)

    const geometries = new Set<BufferGeometry>()
    const materials = new Set<Material>()
    group.traverse((child) => {
      const mesh = child as Mesh
      if (!(mesh instanceof Mesh)) return
      geometries.add(mesh.geometry)
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((item) => materials.add(item))
      else materials.add(material)
    })

    const geometrySpies = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'))
    const materialSpies = [...materials].map((material) => vi.spyOn(material, 'dispose'))

    dispose()

    expect(geometrySpies.length).toBeGreaterThan(0)
    expect(materialSpies.length).toBeGreaterThan(0)
    for (const spy of [...geometrySpies, ...materialSpies]) expect(spy).toHaveBeenCalled()
    // Группа не остаётся на сцене после закрытия карточки.
    expect(group.parent).toBeNull()
    expect(group.children).toHaveLength(0)
  })

  it('модель помещается в витрину: размер в пределах разумного', () => {
    const recipe = buildModelRecipe({ id: 'prismdragon', elements: ['crystal', 'stone'], rarity: 'Mythic' })
    const { group, dispose } = buildCreatureMesh(recipe)

    const size = new Box3().setFromObject(group).getSize(new Vector3())

    expect(size.x).toBeLessThan(4)
    expect(size.y).toBeLessThan(4)
    expect(size.z).toBeLessThan(4)

    dispose()
  })
})
