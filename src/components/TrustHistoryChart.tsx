import { fonts, colors } from '../styles/tokens'
import type { TrustHistoryEntry } from '../engine/types'

interface TrustHistoryChartProps {
  history: TrustHistoryEntry[]
  currentScore: number
}

export function TrustHistoryChart({ history, currentScore }: TrustHistoryChartProps) {
  const points =
    history.length === 0
      ? [currentScore, currentScore]
      : [history[0].scoreBefore, ...history.map((h) => h.scoreAfter)]

  const w = 220
  const h = 48
  const min = Math.min(...points, 60)
  const max = Math.max(...points, 100)
  const range = Math.max(1, max - min)

  const coords = points.map((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * (w - 8) + 4
    const y = h - 6 - ((p - min) / range) * (h - 12)
    return `${x},${y}`
  })

  return (
    <div>
      <div
        className="mb-1 text-[10px] tracking-[0.18em] uppercase"
        style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
      >
        Trust History
      </div>
      <svg width={w} height={h} className="overflow-visible">
        <polyline
          fill="none"
          stroke={colors.cyan}
          strokeWidth="1.5"
          points={coords.join(' ')}
        />
        {coords.map((c, i) => {
          const [x, y] = c.split(',').map(Number)
          return <circle key={i} cx={x} cy={y} r={2} fill={colors.cyan} />
        })}
      </svg>
      {history.length === 0 && (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          No trust events yet
        </p>
      )}
    </div>
  )
}
