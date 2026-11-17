import type { ExperimentalTagHeatEffect } from '@/lib/types'

export type TagHeatRarity = 'base' | 'advanced' | 'collector' | 'secret'
export type ResolvedTagHeatEffect = Exclude<ExperimentalTagHeatEffect, 'auto'>

export function getTagHeatRarity(heatLevel: number): TagHeatRarity {
  if (heatLevel >= 0.82) return 'secret'
  if (heatLevel >= 0.56) return 'collector'
  if (heatLevel >= 0.28) return 'advanced'
  return 'base'
}

export function resolveTagHeatEffect(
  effect: ExperimentalTagHeatEffect,
  rarity: TagHeatRarity,
): ResolvedTagHeatEffect {
  if (effect !== 'auto') return effect
  if (rarity === 'secret') return 'galaxy'
  if (rarity === 'collector') return 'diamond'
  if (rarity === 'advanced') return 'foil'
  return 'none'
}
