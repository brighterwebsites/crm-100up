interface Props {
  icon: string
  title: string
  note?: string
}

/** Placeholder for Quote Designer tools not yet ported from the V46 suite. */
export default function StubPage({ icon, title, note }: Props) {
  return (
    <div className="stub-page">
      <div className="stub-card">
        <div className="stub-card-icon">{icon}</div>
        <h2>{title}</h2>
        <p>{note ?? 'Not built yet — coming soon.'}</p>
      </div>
    </div>
  )
}
