// Static mirror of the pipeline_steps table (the DB copy is the
// FK-integrity source of truth; this one exists so the UI never fetches
// data that essentially never changes). Stage colors ported from the V46
// PIPELINE constant for visual continuity.

export interface StageDef {
  name: string
  short: string
  color: string
  light: string
  text: string
  steps: string[]
}

export const PIPELINE: Record<number, StageDef> = {
  1: {
    name: 'Communication',
    short: 'Comms',
    color: '#1D9E75',
    light: '#E1F5EE',
    text: '#085041',
    steps: ['First contact', 'Info collection', 'System proposals', 'Customer selects'],
  },
  2: {
    name: 'Quoting',
    short: 'Quote',
    color: '#534AB7',
    light: '#EEEDFE',
    text: '#3C3489',
    steps: ['Quote in Xero', 'Send quote', 'Deposit received'],
  },
  3: {
    name: 'Installation',
    short: 'Install',
    color: '#993C1D',
    light: '#FAECE7',
    text: '#712B13',
    steps: ['Job info to installer', 'Date booked', 'Parts ordered', 'Install in progress', 'Install complete'],
  },
  4: {
    name: 'Compliance & close',
    short: 'Compliance',
    color: '#854F0B',
    light: '#FAEEDA',
    text: '#633806',
    steps: ['CES submitted', 'Inspector review', 'Fixes complete', 'CES received', 'Rebate submitted', 'Rebate received', 'Job closed'],
  },
}

export const TOTAL_STEPS = 19
/** Flat ordinal offset per stage (mirror of the old SOFF constant). */
export const STAGE_OFFSET: Record<number, number> = { 1: 0, 2: 4, 3: 7, 4: 13 }

export function stepOrdinal(stage: number, step: number): number {
  return (STAGE_OFFSET[stage] ?? 0) + step
}

export function stepLabel(stage: number, step: number): string {
  return PIPELINE[stage]?.steps[step] ?? `Stage ${stage} / step ${step}`
}

export function isClosed(stage: number, step: number): boolean {
  return stage === 4 && step === 6
}

/** Steps whose Advance action needs a date from the user (mirrors the old
 * pendingAdvance date-picker behavior: booked, install start, install done). */
export function nextStepNeedsDate(
  stage: number,
  step: number,
): 'planned_install_date' | 'install_start_date' | 'install_completion_date' | null {
  const maxStep = (PIPELINE[stage]?.steps.length ?? 0) - 1
  let ns = stage
  let np = step + 1
  if (step >= maxStep) {
    if (stage >= 4) return null
    ns = stage + 1
    np = 0
  }
  if (ns === 3 && np === 1) return 'planned_install_date'
  if (ns === 3 && np === 3) return 'install_start_date'
  if (ns === 3 && np === 4) return 'install_completion_date'
  return null
}
