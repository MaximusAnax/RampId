import { AnimatePresence, motion } from 'framer-motion'
import { useSimStore, getScenarioPhase } from '../store/useSimStore'
import { startWhatIfScenario } from '../engine/eventEngine'
import {
  fonts,
  colors,
  WHAT_IF_CALLOUT,
  WHAT_IF_OUTCOME_CALLOUT,
  WHAT_IF_PLAYING_CALLOUT,
} from '../styles/tokens'

/** What-if arm / play / finish overlay — Re-run plays the alternate timeline */
export function WhatIfPanel() {
  const active = useSimStore((s) => s.whatIfActive)
  const phase = useSimStore((s) => s.whatIfPhase)
  const callout = useSimStore((s) => s.whatIfCallout)
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const opportunity = useSimStore((s) => s.opportunity)
  const scenarioPhase = getScenarioPhase({ scenarioStarted, opportunity })

  const show =
    active &&
    phase != null &&
    (scenarioPhase === 'resolved' || phase === 'playing')

  if (!show) return null

  const isPlaying = phase === 'playing'
  const isFinished = phase === 'finished'
  const isArmed = phase === 'armed'
  const body =
    callout ??
    (isFinished
      ? WHAT_IF_OUTCOME_CALLOUT
      : isPlaying
        ? WHAT_IF_PLAYING_CALLOUT
        : WHAT_IF_CALLOUT)

  return (
    <AnimatePresence>
      <motion.div
        key={phase ?? 'whatif'}
        initial={{ opacity: 0, y: -12, scale: 0.94, x: -8 }}
        animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-4 top-4 z-50 max-w-[400px] rounded-lg border p-4"
        style={{
          background: isFinished
            ? 'linear-gradient(145deg, rgba(255,77,94,0.18), rgba(13,21,32,0.97))'
            : 'linear-gradient(145deg, rgba(255,184,77,0.22), rgba(13,21,32,0.97))',
          borderColor: isFinished
            ? 'rgba(255,77,94,0.55)'
            : 'rgba(255,184,77,0.65)',
          boxShadow: isFinished
            ? `0 8px 40px rgba(0,0,0,0.5), 0 0 48px ${colors.red}33`
            : `0 8px 40px rgba(0,0,0,0.5), 0 0 48px ${colors.amber}33`,
        }}
      >
        <div className="mb-2 flex items-center gap-2">
          <motion.span
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: isFinished ? colors.red : colors.amber,
              boxShadow: `0 0 10px ${isFinished ? colors.red : colors.amber}`,
            }}
          />
          <div
            className="text-[10px] font-semibold tracking-[0.22em] uppercase"
            style={{
              color: isFinished ? colors.red : colors.amber,
              fontFamily: fonts.mono,
            }}
          >
            {isPlaying
              ? 'Live What-If · Playing'
              : isFinished
                ? 'Live What-If · Outcome'
                : 'Live What-If · Alternate Branch'}
          </div>
        </div>
        <p
          className="text-sm font-medium leading-snug"
          style={{ fontFamily: fonts.body, color: 'var(--text-primary)' }}
        >
          {body}
        </p>

        {(isArmed || isFinished) && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => startWhatIfScenario()}
            className="mt-3 w-full rounded-md px-3 py-2.5 text-sm font-semibold tracking-wide"
            style={{
              background: isFinished ? colors.red : colors.amber,
              color: '#0A0B0F',
              fontFamily: fonts.body,
              boxShadow: `0 0 20px ${(isFinished ? colors.red : colors.amber)}44`,
            }}
          >
            {isFinished ? 'Re-run alternate timeline' : 'Re-run alternate timeline'}
          </motion.button>
        )}

        {isPlaying && (
          <div
            className="mt-3 border-t pt-2 text-[10px] tracking-wide"
            style={{
              borderColor: 'rgba(255,184,77,0.25)',
              color: colors.textMuted,
              fontFamily: fonts.mono,
            }}
          >
            Playing alternate… watch Nova advance before Sentinel
          </div>
        )}

        {isArmed && (
          <div
            className="mt-2 text-[10px] tracking-wide"
            style={{
              color: colors.textMuted,
              fontFamily: fonts.mono,
            }}
          >
            Same vendor · one number changed · whole outcome flips
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
