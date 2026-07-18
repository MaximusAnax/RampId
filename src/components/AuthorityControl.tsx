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
  const crossed = showWhatIfHint && value >= WHAT_IF_NOVA_THRESHOLD
  const thresholdPct =
    max > min ? ((WHAT_IF_NOVA_THRESHOLD - min) / (max - min)) * 100 : 0

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
          className="text-sm font-semibold tabular-nums transition-colors"
          style={{
            color: crossed ? colors.amber : colors.cyan,
            fontFamily: fonts.mono,
            textShadow: crossed ? `0 0 12px ${colors.amber}66` : undefined,
          }}
        >
          {formatMoney(value)}
        </span>
      </div>
      <div className="relative">
        {showWhatIfHint && (
          <div
            className="pointer-events-none absolute top-1/2 z-0 h-3 w-px -translate-y-1/2"
            style={{
              left: `${thresholdPct}%`,
              background: colors.amber,
              boxShadow: `0 0 8px ${colors.amber}`,
            }}
            title={`Threshold ${formatMoney(WHAT_IF_NOVA_THRESHOLD)}`}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={500}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative z-10 w-full"
          style={{ accentColor: crossed ? colors.amber : colors.cyan }}
        />
      </div>
      {showWhatIfHint && (
        <p
          className="text-[10px] leading-snug"
          style={{
            color: crossed ? colors.amber : 'var(--text-muted)',
            fontFamily: fonts.mono,
          }}
        >
          {crossed
            ? 'Alternate branch active — Nova advances before Sentinel'
            : `Drag past ${formatMoney(WHAT_IF_NOVA_THRESHOLD)} to explore the alternate branch`}
        </p>
      )}
    </div>
  )
}
