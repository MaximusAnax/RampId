import { AnimatePresence, motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { fonts, colors } from '../styles/tokens'

/**
 * Full-viewport flash when Sentinel blocks Nova — readable from the back of the room.
 */
export function CinematicImpact() {
  const impact = useSimStore((s) => s.cinematicImpact)
  const epoch = useSimStore((s) => s.cinematicEpoch)

  return (
    <AnimatePresence>
      {impact === 'block' && (
        <motion.div
          key={`block-${epoch}`}
          className="pointer-events-none absolute inset-0 z-[60]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Red wash */}
          <motion.div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse at 55% 45%, rgba(255,77,94,0.45) 0%, rgba(255,77,94,0.12) 40%, transparent 70%)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.55, 0] }}
            transition={{ duration: 1.35, times: [0, 0.08, 0.35, 1] }}
          />

          {/* Scanline burst */}
          <motion.div
            className="absolute inset-x-0 h-[2px]"
            style={{
              top: '42%',
              background: `linear-gradient(90deg, transparent, ${colors.red}, transparent)`,
              boxShadow: `0 0 28px ${colors.red}`,
            }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: [0, 1.2, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />

          {/* Center stamp */}
          <motion.div
            className="absolute left-1/2 top-[38%] -translate-x-1/2 text-center"
            initial={{ opacity: 0, scale: 0.7, y: 12 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.7, 1.08, 1, 1], y: [12, 0, 0, -8] }}
            transition={{ duration: 1.4, times: [0, 0.12, 0.7, 1] }}
          >
            <div
              className="text-[11px] font-semibold tracking-[0.45em] uppercase"
              style={{ color: colors.red, fontFamily: fonts.mono }}
            >
              Governance
            </div>
            <div
              className="mt-1 text-4xl font-extrabold tracking-[0.18em] uppercase"
              style={{
                fontFamily: fonts.display,
                color: '#fff',
                textShadow: `0 0 40px ${colors.red}, 0 0 80px ${colors.red}88`,
              }}
            >
              BLOCKED
            </div>
            <div
              className="mt-2 text-sm tracking-wide"
              style={{ color: 'rgba(255,220,220,0.9)', fontFamily: fonts.mono }}
            >
              SENTINEL → NOVA · Risk review incomplete
            </div>
          </motion.div>
        </motion.div>
      )}

      {impact === 'trust' && (
        <motion.div
          key={`trust-${epoch}`}
          className="pointer-events-none absolute inset-0 z-[55]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.35, 0] }}
          transition={{ duration: 0.7 }}
          style={{
            background:
              'radial-gradient(ellipse at 50% 50%, rgba(77,216,255,0.18) 0%, transparent 55%)',
          }}
        />
      )}
    </AnimatePresence>
  )
}
