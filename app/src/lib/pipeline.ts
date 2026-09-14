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

// Colours are `var(--stage-N*)` references, not hex literals — these values
// are consumed as inline `style={{ background: stage.light }}`, where a CSS
// custom property resolves normally. The palette lives in one place only
// (src/index.css), so a token change reaches the Pipeline board, and dark
// mode later needs no change here at all.
//
// This previously duplicated the hex values, which is why the CSS
// --stage-3/--stage-4 tokens had zero consumers and editing them changed
// nothing on screen.
export const PIPELINE: Record<number, StageDef> = {
  1: {
    name: 'Communication',
    short: 'Comms',
    color: 'var(--stage-1)',
    light: 'var(--stage-1-light)',
    text: 'var(--stage-1-text)',
    steps: ['First contact', 'Info collection', 'System proposals', 'Customer selects'],
  },
  2: {
    name: 'Quoting',
    short: 'Quote',
    color: 'var(--stage-2)',
    light: 'var(--stage-2-light)',
    text: 'var(--stage-2-text)',
    steps: ['Quote in Xero', 'Send quote', 'Deposit received'],
  },
  3: {
    name: 'Installation',
    short: 'Install',
    color: 'var(--stage-3)',
    light: 'var(--stage-3-light)',
    text: 'var(--stage-3-text)',
    steps: ['Job info to installer', 'Date booked', 'Parts ordered', 'Install in progress', 'Install complete'],
  },
  4: {
    name: 'Compliance & close',
    short: 'Compliance',
    color: 'var(--stage-4)',
    light: 'var(--stage-4-light)',
    text: 'var(--stage-4-text)',
    steps: ['CES submitted', 'Inspector review', 'Fixes complete', 'CES received', 'Rebate submitted', 'Rebate received', 'Job closed'],
  },
}

const STAGES = [1, 2, 3, 4]

// Derived from the step lists, never hardcoded. V46's SOFF constant, which
// this used to mirror, had stage 4 at 13 instead of 12: every Compliance dot
// on the Pipeline board sat one column to the right, and a closed job's dot
// (ordinal 19, one past the last column) drew nowhere.
export const TOTAL_STEPS = STAGES.reduce((n, s) => n + PIPELINE[s].steps.length, 0)
/** Flat ordinal offset per stage: the number of steps in all earlier stages. */
export const STAGE_OFFSET: Record<number, number> = Object.fromEntries(
  STAGES.map((s, i) => [s, STAGES.slice(0, i).reduce((n, p) => n + PIPELINE[p].steps.length, 0)]),
)

export function stepOrdinal(stage: number, step: number): number {
  return (STAGE_OFFSET[stage] ?? 0) + step
}

export function stepLabel(stage: number, step: number): string {
  return PIPELINE[stage]?.steps[step] ?? `Stage ${stage} / step ${step}`
}

export function isClosed(stage: number, step: number): boolean {
  return stage === 4 && step === PIPELINE[4].steps.length - 1
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
