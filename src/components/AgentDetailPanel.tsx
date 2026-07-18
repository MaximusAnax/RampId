import { motion, AnimatePresence } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { authorityLabel, formatMoney } from '../engine/trustEngine'
import { fonts, colors, trustScoreColor, WHAT_IF_NOVA_MAX } from '../styles/tokens'
import { AuthorityControl } from './AuthorityControl'
import { TrustHistoryChart } from './TrustHistoryChart'

export function AgentDetailPanel() {
  const selectedId = useSimStore((s) => s.selectedAgentId)
  const agent = useSimStore((s) => (selectedId ? s.agents[selectedId] : null))
  const setSelectedAgentId = useSimStore((s) => s.setSelectedAgentId)
  const setSpendingLimit = useSimStore((s) => s.setSpendingLimit)
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const opportunity = useSimStore((s) => s.opportunity)

  const show =
    !!agent &&
    // Prefer opening after story has progressed; still allow browse anytime in cluster
    true

  const scenarioKind = useSimStore((s) => s.scenarioKind)
  const whatIfPhase = useSimStore((s) => s.whatIfPhase)

  // Part 5: emphasize what-if after main story resolves (or during/after what-if replay)
  const enableNovaSlider =
    agent?.id === 'nova' &&
    scenarioStarted &&
    (opportunity === 'escalated' ||
      scenarioKind === 'whatif' ||
      whatIfPhase === 'armed' ||
      whatIfPhase === 'finished')

  const novaWhatIfReady =
    agent?.id === 'nova' &&
    opportunity === 'escalated' &&
    scenarioKind === 'main' &&
    whatIfPhase !== 'playing'

  return (
    <AnimatePresence>
      {show && agent && (
        <motion.aside
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          className="absolute bottom-0 right-0 top-0 z-50 flex w-[340px] flex-col border-l"
          style={{
            background: 'rgba(13, 21, 32, 0.98)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div
            className="flex items-start justify-between border-b px-4 py-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div>
              <h2
                className="text-lg font-bold tracking-[0.08em]"
                style={{ fontFamily: fonts.display }}
              >
                {agent.name}
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {agent.role} · {authorityLabel(agent.authorityLevel)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAgentId(null)}
              className="rounded px-2 py-1 text-sm transition hover:bg-white/5"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Close detail panel"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            <div>
              <Label>Objective</Label>
              <p className="text-sm leading-snug">{agent.objective}</p>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Model</span>
                <span style={{ fontFamily: fonts.mono }}>{agent.model}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Built by</span>
                <span style={{ fontFamily: fonts.mono }}>{agent.builtBy}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Trust Score</Label>
              <span
                className="text-xl font-semibold tabular-nums"
                style={{
                  color: trustScoreColor(agent.trustScore),
                  fontFamily: fonts.mono,
                }}
              >
                {agent.trustScore}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {Object.entries(agent.trustDimensions).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded border px-2 py-1.5"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}>
                    {k.replace(/([A-Z])/g, ' $1')}
                  </div>
                  <div className="font-semibold tabular-nums" style={{ fontFamily: fonts.mono }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Status</span>
              <span style={{ fontFamily: fonts.mono }}>{agent.status}</span>
            </div>

            {agent.currentTask && (
              <div>
                <Label>Current Task</Label>
                <p className="text-sm">{agent.currentTask}</p>
              </div>
            )}

            {agent.blockReason && (
              <p className="text-xs font-semibold" style={{ color: colors.red }}>
                {agent.blockReason}
              </p>
            )}

            {agent.spendingLimit > 0 && (
              <AuthorityControl
                agentId={agent.id}
                value={agent.spendingLimit}
                max={agent.id === 'nova' ? WHAT_IF_NOVA_MAX : Math.max(agent.spendingLimit * 2, 50_000)}
                onChange={(v) => setSpendingLimit(agent.id, v)}
                disabled={whatIfPhase === 'playing'}
                showWhatIfHint={enableNovaSlider || novaWhatIfReady}
              />
            )}

            {agent.spendingLimit === 0 && (
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Spending limit: n/a
              </div>
            )}

            {agent.requiredApprovals && (
              <div>
                <Label>Required Approvals</Label>
                <p className="text-sm">{agent.requiredApprovals}</p>
              </div>
            )}

            {agent.personalityBlurb && (
              <div>
                <Label>Profile</Label>
                <p className="text-sm leading-snug" style={{ color: 'var(--text-muted)' }}>
                  {agent.personalityBlurb}
                </p>
              </div>
            )}

            <TrustHistoryChart history={agent.history} currentScore={agent.trustScore} />

            <div className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}>
              Risk: {agent.riskTolerance}
              {agent.spendingLimit > 0 ? ` · Budget ${formatMoney(agent.spendingLimit)}` : ''}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1 text-[10px] tracking-[0.18em] uppercase"
      style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
    >
      {children}
    </div>
  )
}
