import { AnimatePresence, motion } from 'framer-motion'
import { useSimStore, getScenarioPhase } from '../store/useSimStore'
import { fonts, colors } from '../styles/tokens'

/**
 * Lands Part 6 on pull-back after SynapseFlow resolves — say the line, stop talking.
 */
export function CloseTagline() {
  const viewMode = useSimStore((s) => s.viewMode)
  const pulledBack = useSimStore((s) => s.pulledBack)
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const opportunity = useSimStore((s) => s.opportunity)
  const phase = getScenarioPhase({ scenarioStarted, opportunity })

  const show =
    viewMode === 'swarm' && pulledBack && phase === 'resolved'

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.9, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none absolute inset-x-0 top-[22%] z-[35] text-center"
        >
          <div
            className="text-[11px] font-medium tracking-[0.4em] uppercase"
            style={{ color: colors.cyan, fontFamily: fonts.mono }}
          >
            Veridian
          </div>
          <h2
            className="mx-auto mt-3 max-w-xl px-6 text-3xl font-bold leading-tight tracking-tight md:text-4xl"
            style={{
              fontFamily: fonts.display,
              color: colors.textPrimary,
              textShadow: '0 0 48px rgba(77,216,255,0.25)',
            }}
          >
            Trust is the infrastructure
          </h2>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
