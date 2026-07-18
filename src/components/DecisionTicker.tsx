import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { fonts, colors } from '../styles/tokens'

/**
 * Cold-open proof of life: financial decisions ticking while the presenter speaks.
 * Anchors Part 1's "forty-one financial decisions" beat.
 */
export function DecisionTicker() {
  const viewMode = useSimStore((s) => s.viewMode)
  const pulledBack = useSimStore((s) => s.pulledBack)
  const demoEpoch = useSimStore((s) => s.demoEpoch)
  const [count, setCount] = useState(pulledBack ? 41 : 28)

  useEffect(() => {
    setCount(pulledBack ? 41 : 28)
  }, [demoEpoch, pulledBack])

  useEffect(() => {
    if (viewMode !== 'swarm') return
    const id = window.setInterval(() => {
      setCount((c) => c + 1)
      useSimStore.getState().pulseDecision()
    }, 1100)
    return () => window.clearInterval(id)
  }, [viewMode, demoEpoch])

  if (viewMode !== 'swarm') return null

  return (
    <motion.div
      key={`ticker-${demoEpoch}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.6 }}
      className="pointer-events-none absolute bottom-8 left-1/2 z-30 -translate-x-1/2 text-center"
    >
      <div
        className="text-[10px] font-medium tracking-[0.28em] uppercase"
        style={{ color: colors.textMuted, fontFamily: fonts.mono }}
      >
        Financial decisions · this session
      </div>
      <motion.div
        key={count}
        initial={{ opacity: 0.5, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-1 text-3xl font-bold tabular-nums tracking-tight"
        style={{
          fontFamily: fonts.mono,
          color: colors.cyan,
          textShadow: `0 0 24px ${colors.cyan}55`,
        }}
      >
        {count.toLocaleString()}
      </motion.div>
      <div
        className="mt-1.5 text-[11px] tracking-wide"
        style={{ color: colors.textMuted, fontFamily: fonts.body, opacity: 0.85 }}
      >
        Nobody approved them. Nobody clicked accept.
      </div>
    </motion.div>
  )
}
