import { motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { startSynapseFlowScenario } from '../engine/eventEngine'
import { fonts, colors } from '../styles/tokens'

export function OpportunityCard() {
  const opportunity = useSimStore((s) => s.opportunity)
  const label = useSimStore((s) => s.opportunityLabel)
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)

  if (opportunity === 'hidden') return null

  const isEscalated = opportunity === 'escalated'
  const canDeploy = opportunity === 'ready' && !scenarioStarted

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.92 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        boxShadow: canDeploy
          ? [
              '0 8px 32px rgba(0,0,0,0.4), 0 0 0 0 rgba(77,216,255,0)',
              '0 8px 40px rgba(0,0,0,0.45), 0 0 48px rgba(77,216,255,0.35)',
              '0 8px 32px rgba(0,0,0,0.4), 0 0 0 0 rgba(77,216,255,0)',
            ]
          : '0 8px 32px rgba(0,0,0,0.4)',
      }}
      transition={{
        boxShadow: canDeploy
          ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
          : undefined,
      }}
      className="absolute right-4 top-4 z-40 w-[360px] rounded-lg border p-4"
      style={{
        background: isEscalated
          ? 'linear-gradient(145deg, rgba(245,158,11,0.14), rgba(13,21,32,0.96))'
          : 'linear-gradient(145deg, rgba(45,212,191,0.12), rgba(13,21,32,0.96))',
        borderColor: isEscalated
          ? 'rgba(245,158,11,0.5)'
          : 'rgba(77,216,255,0.45)',
      }}
    >
      <div
        className="mb-1 text-[10px] font-medium tracking-[0.22em] uppercase"
        style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
      >
        {isEscalated ? 'Escalation' : 'New Opportunity'}
      </div>
      <h2
        className="mb-1 text-base font-semibold leading-snug"
        style={{ fontFamily: fonts.display }}
      >
        {label.includes('$') ? label.split('—').slice(0, 2).join('—').trim() : label}
      </h2>
      {!isEscalated && (
        <div
          className="mb-3 text-2xl font-bold tabular-nums tracking-tight"
          style={{
            fontFamily: fonts.mono,
            color: canDeploy ? colors.cyan : colors.amber,
            textShadow: canDeploy ? `0 0 20px ${colors.cyan}55` : undefined,
          }}
        >
          $240,000
          <span
            className="ml-2 text-[11px] font-medium tracking-wide"
            style={{ color: colors.textMuted }}
          >
            potential annual savings
          </span>
        </div>
      )}

      {canDeploy && (
        <motion.button
          type="button"
          onClick={() => startSynapseFlowScenario()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full rounded-md px-3 py-3 text-sm font-semibold tracking-wide"
          style={{
            background: colors.cyan,
            color: '#041016',
            fontFamily: fonts.body,
            boxShadow: `0 0 24px ${colors.cyan}44`,
          }}
        >
          Deploy agents to investigate
        </motion.button>
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
        <>
          <p
            className="mb-2 text-xs leading-snug"
            style={{ color: colors.textPrimary, fontFamily: fonts.body }}
          >
            Organization reweighted itself — Vega leads negotiation pending executive review.
          </p>
          <p
            className="text-xs tracking-wide"
            style={{ color: 'var(--accent-amber)', fontFamily: fonts.mono }}
          >
            Pending executive review
          </p>
        </>
      )}
    </motion.div>
  )
}
