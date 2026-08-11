import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  note?: string
}

/** Placeholder for Quote Designer tools not yet ported from the V46 suite.
 *
 * Note this is "not built yet", which is a different state from "built, no
 * data yet" — the design brief (section 4) flags that the two currently look
 * identical and should not. Left as-is for now; worth splitting when the
 * first real empty state appears. */
export default function StubPage({ icon: Icon, title, note }: Props) {
  return (
    <div className="stub-page">
      <div className="stub-card">
        <div className="stub-card-icon">
          <Icon size={32} strokeWidth={1.5} aria-hidden />
        </div>
        <h2>{title}</h2>
        <p>{note ?? 'Not built yet — coming soon.'}</p>
      </div>
    </div>
  )
}
