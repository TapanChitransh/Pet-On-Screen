interface Props {
  icon: string
  label: string
  value: number
  /** hunger reads best inverted: high hunger = bad */
  inverted?: boolean
  color: string
}

export function StatBar({ icon, label, value, inverted = false, color }: Props): JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(100, value)))
  const good = inverted ? 100 - pct : pct
  return (
    <div className="statbar" title={`${label}: ${pct}%`}>
      <span className="statbar-icon">{icon}</span>
      <span className="statbar-label">{label}</span>
      <div className="statbar-track">
        <div className="statbar-fill" style={{ width: `${pct}%`, background: color, opacity: 0.55 + good / 220 }} />
      </div>
      <span className="statbar-value">{pct}%</span>
    </div>
  )
}
