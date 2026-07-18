import { motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { startSynapseFlowScenario } from '../engine/eventEngine'
import { fonts } from '../styles/tokens'

export function OpportunityCard() {
  const opportunity = useSimStore((s) => s.opportunity)
  const label = useSimStore((s) => s.opportunityLabel)
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)

  if (opportunity === 'hidden') return null

  const isEscalated = opportunity === 'escalated'
  const canDeploy = opportunity === 'ready' && !scenarioStarted

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="absolute right-4 top-4 z-40 w-[340px] rounded-lg border p-4"
      style={{
        background: isEscalated
          ? 'linear-gradient(145deg, rgba(245,158,11,0.12), rgba(13,21,32,0.95))'
          : 'linear-gradient(145deg, rgba(45,212,191,0.1), rgba(13,21,32,0.95))',
        borderColor: isEscalated ? 'rgba(245,158,11,0.45)' : 'rgba(45,212,191,0.35)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="mb-1 text-[10px] font-medium tracking-[0.22em] uppercase"
        style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
      >
        {isEscalated ? 'Escalation' : 'New Opportunity'}
      </div>
      <h2
        className="mb-3 text-base font-semibold leading-snug"
        style={{ fontFamily: fonts.display }}
      >
        {label}
      </h2>

      {canDeploy && (
        <button
          type="button"
          onClick={() => startSynapseFlowScenario()}
          className="w-full rounded-md px-3 py-2.5 text-sm font-semibold tracking-wide transition hover:brightness-110 active:scale-[0.98]"
          style={{
            background: 'var(--accent-cyan)',
            color: '#041016',
            fontFamily: fonts.body,
          }}
        >
          Deploy agents to investigate
        </button>
      )}

      {opportunity === 'investigating' && (
        <p
          className="text-xs tracking-wide"
          style={{ color: 'var(--accent-cyan)', fontFamily: fonts.mono }}
        >
          Agents investigating…
        </p>
      )}

      {isEscalated && (
        <p
          className="text-xs tracking-wide"
          style={{ color: 'var(--accent-amber)', fontFamily: fonts.mono }}
        >
          Pending executive review
        </p>
      )}
    </motion.div>
  )
}
