import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { motion, AnimatePresence } from 'framer-motion'
import { authorityLabel, formatMoney } from '../engine/trustEngine'
import type { Agent } from '../engine/types'
import { fonts, statusColors } from '../styles/tokens'

export type AgentNodeData = {
  agent: Agent
}

function AgentNodeComponent({ data }: NodeProps<AgentNodeData>) {
  const { agent } = data
  const statusColor = statusColors[agent.status]
  const isBlocked = agent.status === 'blocked'
  const borderColor = isBlocked
    ? statusColors.blocked
    : agent.flash === 'red'
      ? statusColors.blocked
      : agent.flash === 'green'
        ? statusColors.working
        : agent.flash === 'amber'
          ? statusColors.escalated
          : 'rgba(148, 163, 184, 0.25)'

  return (
    <div className="relative w-[200px]">
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

      <motion.div
        animate={{
          boxShadow: isBlocked
            ? '0 0 24px rgba(239, 68, 68, 0.45)'
            : agent.status === 'working'
              ? '0 0 20px rgba(45, 212, 191, 0.35)'
              : agent.status === 'escalated'
                ? '0 0 20px rgba(245, 158, 11, 0.35)'
                : '0 0 0 rgba(0,0,0,0)',
          scale: agent.status === 'working' ? [1, 1.02, 1] : 1,
        }}
        transition={{
          scale: { repeat: agent.status === 'working' ? Infinity : 0, duration: 1.6 },
        }}
        className="rounded-lg border px-3 py-2.5"
        style={{
          background: isBlocked
            ? 'linear-gradient(160deg, #1a0a0a 0%, #121c2a 100%)'
            : 'linear-gradient(160deg, #121c2a 0%, #0d1520 100%)',
          borderColor,
          fontFamily: fonts.body,
        }}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span
            className="text-sm font-bold tracking-[0.12em]"
            style={{ fontFamily: fonts.display }}
          >
            {agent.name}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
            style={{
              background: 'rgba(45, 212, 191, 0.12)',
              color: 'var(--accent-cyan)',
              fontFamily: fonts.mono,
            }}
          >
            {agent.trustScore}
          </span>
        </div>

        <div
          className="mb-2 text-[11px]"
          style={{ color: 'var(--text-muted)' }}
        >
          {agent.role} · {authorityLabel(agent.authorityLevel)}
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span
            className="flex items-center gap-1.5 uppercase tracking-wider"
            style={{ color: statusColor, fontFamily: fonts.mono }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: statusColor }}
            />
            {agent.status.replace('_', ' ')}
          </span>
          {agent.spendingLimit > 0 && (
            <span style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}>
              {formatMoney(agent.spendingLimit)}
            </span>
          )}
        </div>

        {agent.currentTask && (
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

        {isBlocked && agent.blockReason && (
          <div
            className="mt-2 text-[10px] font-semibold leading-snug"
            style={{ color: statusColors.blocked }}
          >
            {agent.blockReason}
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {agent.floatingDelta != null && (
          <motion.div
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: 1, y: -28 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute -right-1 -top-2 text-sm font-bold"
            style={{
              color: agent.floatingDelta < 0 ? statusColors.blocked : statusColors.working,
              fontFamily: fonts.mono,
              textShadow: '0 0 8px currentColor',
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
