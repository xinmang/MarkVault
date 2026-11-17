import type { OceanBackgroundMode } from '@/lib/ocean-background'
import { SPECIES } from './species'
import { SHARK_KINDS, SHARK_NODES, type WorldSnapshot } from './world'

type ActiveMode = Exclude<OceanBackgroundMode, 'off'>
const snapshots = new Map<ActiveMode, WorldSnapshot>()
const STORAGE_PREFIX = 'markvault:ocean-state:v1:'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finiteFields(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => finite(value[key]))
}

/** 缓存可能被清理、损坏或来自旧代码，必须先校验再交给模拟和渲染器。 */
function validSnapshot(value: unknown): value is WorldSnapshot {
  if (
    !record(value) ||
    !finite(value.width) ||
    value.width <= 0 ||
    !finite(value.height) ||
    value.height <= 0 ||
    !finite(value.time) ||
    value.time < 0 ||
    !finite(value.lastSpawn) ||
    value.lastSpawn < 0 ||
    !Array.isArray(value.fish) ||
    value.fish.length < 1 ||
    value.fish.length > 240 ||
    !Array.isArray(value.sharks) ||
    value.sharks.length < 1 ||
    value.sharks.length > 4
  )
    return false

  const fishCount = value.fish.length
  return (
    value.fish.every(
      (fish: unknown) =>
        record(fish) &&
        finiteFields(fish, [
          'x',
          'y',
          'vx',
          'vy',
          'alarm',
          'respawnAt',
          'phase',
          'turn',
          'depth',
        ]) &&
        finite(fish.species) &&
        Number.isInteger(fish.species) &&
        fish.species >= 0 &&
        fish.species < SPECIES.length &&
        typeof fish.alive === 'boolean' &&
        (fish.millDir === 1 || fish.millDir === -1)
    ) &&
    value.sharks.every(
      (shark: unknown) =>
        record(shark) &&
        SHARK_KINDS.some((kind) => kind === shark.kind) &&
        finiteFields(shark, [
          'id',
          'heading',
          'speed',
          'phase',
          'turn',
          'hunger',
          'wander',
          'retargetAt',
          'depth',
        ]) &&
        finite(shark.length) &&
        shark.length > 0 &&
        finite(shark.orbitRadius) &&
        shark.orbitRadius > 0 &&
        (shark.orbitDir === 1 || shark.orbitDir === -1) &&
        Array.isArray(shark.nodes) &&
        shark.nodes.length === SHARK_NODES * 2 &&
        shark.nodes.every(finite) &&
        (shark.target === null ||
          (finite(shark.target) &&
            Number.isInteger(shark.target) &&
            shark.target >= 0 &&
            shark.target < fishCount))
    )
  )
}

export function loadOceanState(mode: ActiveMode): WorldSnapshot | undefined {
  const cached = snapshots.get(mode)
  if (cached) return cached
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + mode)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (validSnapshot(parsed)) {
      snapshots.set(mode, parsed)
      return parsed
    }
  } catch {
    // 禁用存储或缓存损坏时正常生成鱼群，不影响页面使用。
  }
}

export function saveOceanState(mode: ActiveMode, snapshot: WorldSnapshot) {
  if (snapshot.width < 1 || snapshot.height < 1 || snapshot.fish.length === 0) return
  snapshots.set(mode, snapshot)
  try {
    // 标签页之间互不抢占进度；只在离开页面或隐藏时写入，不增加逐帧 I/O。
    window.sessionStorage.setItem(STORAGE_PREFIX + mode, JSON.stringify(snapshot))
  } catch {
    // 存储不可用时仍通过内存保留站内页面切换的进度。
  }
}
