import type { Enums } from '../types/database.types'

export type ProductType = Enums<'product_type'>
export type Phase = Enums<'electrical_phase'>

/** Precise per-product labels. These stay granular because the configurator
 * needs the distinction: a gateway is one per <=3 inverters, a mounting kit
 * is one per inverter, and the Deye stack base is two products per inverter.
 * Collapsing them would lose the quantity rule. */
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  panel: 'Panel',
  inverter: 'Inverter',
  battery: 'Battery',
  gateway: 'Gateway',
  mounting: 'Mounting',
  bms: 'BMS / stack base',
  gm_component: 'Ground mount',
  consumable: 'Consumable',
  other: 'Other',
}

export const PHASE_LABEL: Record<Phase, string> = {
  single: 'Single phase',
  three: 'Three phase',
  na: '—',
}

/** Coarser groupings for filtering. The precise types above are right for the
 * data and too granular for a filter row — the parts that bolt onto an
 * inverter (gateway, mounting kit, stack base) are one thing when you are
 * looking for them, and several when you are pricing them. */
export type ProductGroup = 'all' | 'panel' | 'inverter' | 'battery' | 'component' | 'gm' | 'other' | 'outofstock'

export const PRODUCT_GROUPS: { key: ProductGroup; label: string; types?: ProductType[] }[] = [
  { key: 'all',        label: 'All' },
  { key: 'panel',      label: 'Panels',       types: ['panel'] },
  { key: 'inverter',   label: 'Inverters',    types: ['inverter'] },
  { key: 'battery',    label: 'Batteries',    types: ['battery'] },
  { key: 'component',  label: 'Components',   types: ['gateway', 'mounting', 'bms'] },
  { key: 'gm',         label: 'Ground mount', types: ['gm_component'] },
  { key: 'other',      label: 'Other',        types: ['consumable', 'other'] },
  { key: 'outofstock', label: 'Out of stock' },
]

/** True when a product belongs in the given filter group. `outofstock` is a
 * stock-level question rather than a type one, so it is handled by the caller. */
export function inGroup(type: ProductType, group: ProductGroup): boolean {
  if (group === 'all' || group === 'outofstock') return true
  const g = PRODUCT_GROUPS.find((x) => x.key === group)
  return g?.types?.includes(type) ?? false
}
