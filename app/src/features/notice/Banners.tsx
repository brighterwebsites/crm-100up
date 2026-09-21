/**
 * Two banners, for two different problems that look similar from the outside.
 *
 * **Update available** is automatic. It compares the build id compiled into
 * this bundle against /version.json, so it appears exactly when this tab is
 * running code from before the last deploy — and never otherwise. Nobody
 * turns it on or off.
 *
 * **Maintenance notice** is manual, because "I am changing things right now,
 * expect wobble" is a judgement no amount of version comparison can make. It
 * comes from app_notice and expires on its own.
 *
 * Kept distinct on purpose. "Reload to get the latest" and "things may be
 * broken for a bit" call for different reactions, and a single banner saying
 * both would train people to ignore it.
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { STALE_CHECK_MS, isStale } from '../../lib/appVersion'
import { useData } from '../../lib/data'

export function UpdateBanner() {
  const [stale, setStale] = useState(false)

  const check = useCallback(() => { void isStale().then(setStale) }, [])

  useEffect(() => {
    check()
    // On focus, because that is the moment it becomes relevant — and on a
    // slow timer for a tab left open all afternoon.
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    const t = setInterval(check, STALE_CHECK_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
    }
  }, [check])

  if (!stale) return null
  return (
    <div className="app-banner app-banner-update">
      <RefreshCw size={14} aria-hidden />
      <span>
        <strong>An update has been deployed.</strong> Reload to pick it up — until you do,
        this tab is running the older version.
      </span>
      <button
        className="btn btn-primary"
        style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 12px' }}
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  )
}

export function MaintenanceBanner() {
  const { notice } = useData()
  // Expiry is enforced here as well as by whoever set it: a tab left open
  // past `until` should stop showing it without needing a write.
  const live =
    notice?.active &&
    (!notice.until || new Date(notice.until).getTime() > Date.now())
  if (!live) return null
  return (
    <div className="app-banner app-banner-maint">
      <TriangleAlert size={14} aria-hidden />
      <span>
        {notice.message ||
          'Updates are being made to the system right now — some things may briefly not work.'}
      </span>
    </div>
  )
}
