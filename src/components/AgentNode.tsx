import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { motion, AnimatePresence } from 'framer-motion'
import { authorityLabel, formatMoney } from '../engine/trustEngine'
import type { Agent } from '../engine/types'
import { fonts, statusColors, trustScoreColor, colors } from '../styles/tokens'
import { getScenarioPhase, useSimStore } from '../store/useSimStore'

export type AgentNodeData = {
  agent: Agent
  onSelect?: (id: string) => void
}

function TrustOdometer({
  score,
  dropping,
}: {
  score: number
  dropping: boolean
}) {
  const [display, setDisplay] = useState(score)
  const scoreColor = trustScoreColor(score, dropping)

  useEffect(() => {
    if (display === score) return
    const from = display
    const to = score
    const start = performance.now()
    const duration = 700
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score])

  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
      style={{
        background: `${scoreColor}22`,
        color: scoreColor,
        fontFamily: fonts.mono,
        boxShadow: dropping ? `0 0 12px ${colors.amber}66` : undefined,
      }}
    >
      {display}
    </span>
  )
}

function AgentNodeComponent({ data }: NodeProps<AgentNodeData>) {
  const { agent, onSelect } = data
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const opportunity = useSimStore((s) => s.opportunity)
  const phase = getScenarioPhase({ scenarioStarted, opportunity })
  const statusColor = statusColors[agent.status]
  const isBlocked = agent.status === 'blocked'
  const isGovernanceLock = isBlocked && !!agent.blockReason
  const dropping = agent.floatingDelta != null && agent.floatingDelta < 0
  const isFocal =
    agent.status === 'working' ||
    agent.status === 'escalated' ||
    isGovernanceLock ||
    agent.flash != null ||
    agent.floatingDelta != null
  const dimmed = phase === 'playing' && !isFocal
  const borderColor = isGovernanceLock
    ? statusColors.blocked
    : agent.flash === 'red'
      ? statusColors.blocked
      : agent.flash === 'green'
        ? statusColors.working
        : agent.flash === 'amber' || isBlocked
          ? statusColors.escalated
          : 'rgba(148, 163, 184, 0.25)'

  return (
    <div
      className="relative w-[210px] cursor-pointer"
      onClick={() => onSelect?.(agent.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect?.(agent.id)
      }}
      role="button"
      tabIndex={0}
      style={{
        opacity: dimmed ? 0.42 : 1,
        filter: dimmed ? 'saturate(0.65)' : undefined,
        transition: 'opacity 0.4s ease, filter 0.4s ease',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0"
        style={{ background: statusColor }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0"
        style={{ background: statusColor }}
      />

      <AnimatePresence>
        {agent.isNew && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute -right-2 -top-2 z-10 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider"
            style={{
              background: colors.cyan,
              color: '#0A0B0F',
              fontFamily: fonts.mono,
            }}
          >
            NEW
          </motion.span>
        )}
      </AnimatePresence>

      {/* Expanding ring on governance block — back-of-room readable */}
      <AnimatePresence>
        {isGovernanceLock && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: [0.7, 0.25, 0.55], scale: [1, 1.18, 1.08] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -inset-3 rounded-xl"
            style={{
              border: `2px solid ${colors.red}`,
              boxShadow: `0 0 32px ${colors.red}88`,
            }}
          />
        )}
      </AnimatePresence>

      <motion.div
        animate={{
          boxShadow: isGovernanceLock
            ? `0 0 36px ${colors.red}99, inset 0 0 24px ${colors.red}22`
            : agent.status === 'working'
              ? `0 0 20px ${colors.cyan}59`
              : agent.status === 'escalated' || isBlocked
                ? `0 0 20px ${colors.amber}59`
                : '0 0 0 rgba(0,0,0,0)',
          scale: isGovernanceLock
            ? [1, 1.04, 0.98, 1]
            : agent.status === 'working'
              ? [1, 1.02, 1]
              : 1,
          x: isGovernanceLock ? [0, -3, 3, -2, 2, 0] : 0,
        }}
        transition={{
          scale: {
            repeat: isGovernanceLock
              ? 0
              : agent.status === 'working'
                ? Infinity
                : 0,
            duration: isGovernanceLock ? 0.45 : 1.6,
          },
          x: { duration: 0.45 },
          boxShadow: { duration: isGovernanceLock ? 0.05 : 0.3 },
        }}
        className="rounded-lg border px-3 py-2.5"
        style={{
          background: isGovernanceLock
            ? 'linear-gradient(160deg, #2a080c 0%, #1a0a10 50%, #121c2a 100%)'
            : agent.flash === 'red'
              ? 'linear-gradient(160deg, #2a1014 0%, #121c2a 100%)'
              : 'linear-gradient(160deg, #121c2a 0%, #0d1520 100%)',
          borderColor,
          borderWidth: isGovernanceLock ? 2 : 1,
          fontFamily: fonts.body,
          transition: agent.flash === 'red' || isGovernanceLock ? 'none' : undefined,
        }}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span
            className="text-sm font-bold tracking-[0.12em]"
            style={{ fontFamily: fonts.display }}
          >
            {agent.name}
          </span>
          <TrustOdometer score={agent.trustScore} dropping={dropping} />
        </div>

        <div className="mb-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {agent.role} · {authorityLabel(agent.authorityLevel)}
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span
            className="flex items-center gap-1.5 uppercase tracking-wider"
            style={{
              color: isGovernanceLock
                ? statusColors.blocked
                : isBlocked
                  ? statusColors.escalated
                  : statusColor,
              fontFamily: fonts.mono,
              fontWeight: isGovernanceLock ? 700 : 400,
              letterSpacing: isGovernanceLock ? '0.14em' : undefined,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: isGovernanceLock
                  ? statusColors.blocked
                  : isBlocked
                    ? statusColors.escalated
                    : statusColor,
                boxShadow: isGovernanceLock ? `0 0 8px ${colors.red}` : undefined,
              }}
            />
            {isGovernanceLock
              ? 'LOCKED'
              : isBlocked
                ? 'waiting'
                : agent.status.replace('_', ' ')}
          </span>
          {agent.spendingLimit > 0 && (
            <span style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}>
              {formatMoney(agent.spendingLimit)}
            </span>
          )}
        </div>

        {agent.currentTask && !isGovernanceLock && (
          <div
            className="mt-2 truncate border-t pt-1.5 text-[10px]"
            style={{
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-muted)',
            }}
          >
            {agent.currentTask}
          </div>
        )}

        {isGovernanceLock && agent.blockReason && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-2 border-t pt-2 text-[11px] font-bold leading-snug tracking-wide"
            style={{
              borderColor: `${colors.red}55`,
              color: '#ffb4bb',
              textShadow: `0 0 12px ${colors.red}66`,
            }}
          >
            {agent.blockReason}
          </motion.div>
        )}
      </motion.div>

      <AnimatePresence>
        {agent.floatingDelta != null && (
          <motion.div
            initial={{ opacity: 0, y: 0, scale: 0.8 }}
            animate={{ opacity: 1, y: -36, scale: 1.15 }}
            exit={{ opacity: 0, y: -48 }}
            transition={{ duration: 0.55 }}
            className="pointer-events-none absolute -right-2 -top-1 text-lg font-extrabold"
            style={{
              color:
                agent.floatingDelta < 0 ? statusColors.blocked : statusColors.working,
              fontFamily: fonts.mono,
              textShadow: '0 0 14px currentColor',
            }}
          >
            {agent.floatingDelta > 0 ? '+' : ''}
            {agent.floatingDelta}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const AgentNode = memo(AgentNodeComponent)
