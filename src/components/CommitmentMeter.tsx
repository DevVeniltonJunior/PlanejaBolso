import { formatPercent } from '../domain/format'

/** Horizontal bar showing how much of the expected income is committed. */
export function CommitmentMeter({ value, compareTo, label }: { value: number | null; compareTo?: number | null; label?: string }) {
  const width = (v: number | null) => `${Math.min(Math.max(v ?? 0, 0), 100)}%`
  const over = (value ?? 0) > 100
  return (
    <div className="meter-wrap">
      {label && <span className="meter-label">{label}</span>}
      <div className="meter" role="img" aria-label={`${formatPercent(value)} da renda prevista comprometida`}>
        {compareTo !== undefined && <div className="meter-fill previous" style={{ width: width(compareTo) }} />}
        <div className={`meter-fill${over ? ' over' : ''}`} style={{ width: width(value) }} />
      </div>
    </div>
  )
}
