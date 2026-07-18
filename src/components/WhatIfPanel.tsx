import { AnimatePresence, motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { fonts, colors } from '../styles/tokens'

/** Instant what-if callout — no spinner, offline, precomputed branch */
export function WhatIfPanel() {
  const callout = useSimStore((s) => s.whatIfCallout)
  const active = useSimStore((s) => s.whatIfActive)

  return (
    <AnimatePresence>
      {active && callout && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="absolute left-4 top-4 z-50 max-w-[360px] rounded-lg border p-4"
          style={{
            background: 'linear-gradient(145deg, rgba(255,184,77,0.14), rgba(13,21,32,0.96))',
            borderColor: 'rgba(255,184,77,0.5)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          }}
        >
          <div
            className="mb-1 text-[10px] font-medium tracking-[0.22em] uppercase"
            style={{ color: colors.amber, fontFamily: fonts.mono }}
          >
            What-If Outcome
          </div>
          <p
            className="text-sm font-medium leading-snug"
            style={{ fontFamily: fonts.body, color: 'var(--text-primary)' }}
          >
            {callout}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
