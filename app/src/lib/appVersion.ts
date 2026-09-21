/**
 * Stale-tab detection.
 *
 * `__BUILD_ID__` is compiled in (vite.config.ts); `/version.json` is written
 * beside the bundle at the same build. If they differ, this tab is running
 * code from before the last deploy.
 *
 * Checked on focus and on a slow interval rather than continuously — the
 * question only matters when someone is actually looking at the screen, and
 * the answer never changes while the tab is in the background.
 */
declare const __BUILD_ID__: string

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

/** True when a newer build has been deployed since this tab loaded. */
export async function isStale(): Promise<boolean> {
  if (BUILD_ID === 'dev') return false
  try {
    // Cache-bust: the whole point is to read past any cached copy.
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const data = (await res.json()) as { buildId?: string }
    return Boolean(data.buildId) && data.buildId !== BUILD_ID
  } catch {
    // Offline, or the file is not there yet. Never nag on a failed check.
    return false
  }
}

export const STALE_CHECK_MS = 5 * 60 * 1000
