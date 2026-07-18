import { synapseFlowScenario } from '../engine/scenario_synapseflow'
import { synapseFlowWhatIfScenario } from '../engine/scenario_synapseflow_whatif'
import {
  TIMELINE_TICKS,
  WHATIF_TIMELINE_TICKS,
} from '../engine/replayEngine'
import { stopScenario } from '../engine/eventEngine'
import { useSimStore } from '../store/useSimStore'
import { fonts, colors } from '../styles/tokens'

export function TimelineScrubber() {
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const eventIndex = useSimStore((s) => s.scenarioEventIndex)
  const scenarioKind = useSimStore((s) => s.scenarioKind)
  const scrubToEventIndex = useSimStore((s) => s.scrubToEventIndex)
  const setScenarioPaused = useSimStore((s) => s.setScenarioPaused)

  if (!scenarioStarted) return null

  const isWhatIf = scenarioKind === 'whatif'
  const scenario = isWhatIf ? synapseFlowWhatIfScenario : synapseFlowScenario
  const ticks = isWhatIf ? WHATIF_TIMELINE_TICKS : TIMELINE_TICKS
  const max = scenario.length - 1
  const value = Math.max(0, eventIndex)
  const currentEvent = scenario[value]
  const onBlockBeat =
    currentEvent?.type === 'block' ||
    (isWhatIf && (currentEvent?.id === 'wf-8' || currentEvent?.id === 'wf-9'))

  const onScrub = (next: number) => {
    stopScenario()
    setScenarioPaused(true)
    scrubToEventIndex(next)
  }

  return (
    <div
      className="absolute bottom-3 left-3 right-[340px] z-40 rounded-lg border px-4 py-3"
      style={{
        background: onBlockBeat
          ? 'rgba(40, 12, 18, 0.94)'
          : isWhatIf
            ? 'rgba(40, 28, 12, 0.94)'
            : 'rgba(13, 21, 32, 0.94)',
        borderColor: onBlockBeat
          ? `${colors.red}55`
          : isWhatIf
            ? `${colors.amber}44`
            : 'var(--border-subtle)',
        maxWidth: 'calc(100% - 360px)',
        boxShadow: onBlockBeat ? `0 0 24px ${colors.red}22` : undefined,
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className="text-[10px] tracking-[0.2em] uppercase"
          style={{
            color: onBlockBeat
              ? colors.red
              : isWhatIf
                ? colors.amber
                : 'var(--text-muted)',
            fontFamily: fonts.mono,
          }}
        >
          {isWhatIf
            ? onBlockBeat
              ? 'What-If Timeline · EXPOSURE'
              : 'What-If Timeline · Alternate'
            : onBlockBeat
              ? 'Timeline · GOVERNANCE BLOCK'
              : 'Timeline · 10:14:00 → 10:14:28'}
        </span>
        <span
          className="text-[10px] tabular-nums"
          style={{
            color: onBlockBeat ? colors.red : isWhatIf ? colors.amber : colors.cyan,
            fontFamily: fonts.mono,
          }}
        >
          {currentEvent?.timestamp ?? '—'}
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
        style={{
          accentColor: onBlockBeat
            ? colors.red
            : isWhatIf
              ? colors.amber
              : colors.cyan,
        }}
      />

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {ticks.map((tick) => {
          const isBlockedTick =
            tick.label.toLowerCase().includes('block') ||
            tick.label.toLowerCase().includes('commit') ||
            tick.label.toLowerCase().includes('too late') ||
            tick.label.toLowerCase().includes('exposure')
          const active = value >= tick.index
          return (
            <button
              key={tick.label}
              type="button"
              onClick={() => onScrub(tick.index)}
              className="text-[9px] tracking-wide uppercase transition hover:opacity-100"
              style={{
                color: isBlockedTick
                  ? colors.red
                  : active
                    ? isWhatIf
                      ? colors.amber
                      : colors.cyan
                    : 'var(--text-muted)',
                fontFamily: fonts.mono,
                opacity: active ? 1 : 0.55,
                fontWeight: isBlockedTick ? 700 : 400,
                textShadow:
                  isBlockedTick && active
                    ? `0 0 10px ${colors.red}88`
                    : undefined,
              }}
            >
              {tick.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
