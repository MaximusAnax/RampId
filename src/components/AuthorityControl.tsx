import { formatMoney } from '../engine/trustEngine'
import { fonts, WHAT_IF_NOVA_THRESHOLD, WHAT_IF_NOVA_MAX, colors } from '../styles/tokens'

interface AuthorityControlProps {
  agentId: string
  value: number
  min?: number
  max?: number
  disabled?: boolean
  onChange: (value: number) => void
  showWhatIfHint?: boolean
}

export function AuthorityControl({
  agentId,
  value,
  min = 0,
  max = agentId === 'nova' ? WHAT_IF_NOVA_MAX : 100_000,
  disabled,
  onChange,
  showWhatIfHint,
}: AuthorityControlProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span
          className="text-[10px] tracking-[0.18em] uppercase"
          style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
        >
          Spending Authority
        </span>
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color: colors.cyan, fontFamily: fonts.mono }}
        >
          {formatMoney(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={500}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      {showWhatIfHint && (
        <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
          Drag past {formatMoney(WHAT_IF_NOVA_THRESHOLD)} to explore the alternate branch
        </p>
      )}
    </div>
  )
}
