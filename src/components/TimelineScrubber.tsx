import { synapseFlowScenario } from '../engine/scenario_synapseflow'
import { TIMELINE_TICKS } from '../engine/replayEngine'
import { stopScenario } from '../engine/eventEngine'
import { useSimStore } from '../store/useSimStore'
import { fonts, colors } from '../styles/tokens'

export function TimelineScrubber() {
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const eventIndex = useSimStore((s) => s.scenarioEventIndex)
  const scrubToEventIndex = useSimStore((s) => s.scrubToEventIndex)
  const setScenarioPaused = useSimStore((s) => s.setScenarioPaused)

  if (!scenarioStarted) return null

  const max = synapseFlowScenario.length - 1
  const value = Math.max(0, eventIndex)

  const onScrub = (next: number) => {
    stopScenario()
    setScenarioPaused(true)
    scrubToEventIndex(next)
  }

  return (
    <div
      className="absolute bottom-3 left-3 right-[340px] z-40 rounded-lg border px-4 py-3"
      style={{
        background: 'rgba(13, 21, 32, 0.94)',
        borderColor: 'var(--border-subtle)',
        maxWidth: 'calc(100% - 360px)',
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-[10px] tracking-[0.2em] uppercase"
          style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
        >
          Timeline · 10:14:00 → 10:14:28
        </span>
        <span
          className="text-[10px] tabular-nums"
          style={{ color: colors.cyan, fontFamily: fonts.mono }}
        >
          {synapseFlowScenario[value]?.timestamp ?? '—'}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onScrub(Number(e.target.value))}
        className="w-full"
      />

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {TIMELINE_TICKS.map((tick) => (
          <button
            key={tick.label}
            type="button"
            onClick={() => onScrub(tick.index)}
            className="text-[9px] tracking-wide uppercase transition hover:opacity-100"
            style={{
              color: value >= tick.index ? colors.cyan : 'var(--text-muted)',
              fontFamily: fonts.mono,
              opacity: value >= tick.index ? 1 : 0.65,
            }}
          >
            {tick.label}
          </button>
        ))}
      </div>
    </div>
  )
}
