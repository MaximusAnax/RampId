import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  CLUSTER_METRICS,
  SWARM_METRICS,
  useSimStore,
} from '../store/useSimStore'
import { formatMoney } from '../engine/trustEngine'
import { fonts, colors } from '../styles/tokens'
import { stopScenario } from '../engine/eventEngine'

const ORG_WIDE_EXTRA =
  SWARM_METRICS.activeAgents - CLUSTER_METRICS.activeAgents

function Metric({
  label,
  value,
  emphasize,
  subline,
  trailing,
}: {
  label: string
  value: string
  emphasize?: boolean
  subline?: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-2.5 first:pl-0 lg:px-3.5">
      <span
        className="text-[10px] font-medium tracking-[0.18em] uppercase"
        style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <motion.span
          key={value}
          initial={{ opacity: 0.4, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="text-lg font-semibold tabular-nums tracking-tight"
          style={{
            fontFamily: fonts.mono,
            color: emphasize ? colors.cyan : 'var(--text-primary)',
          }}
        >
          {value}
        </motion.span>
        {trailing}
      </div>
      {subline && (
        <span
          className="text-[10px] tabular-nums tracking-wide"
          style={{
            fontFamily: fonts.mono,
            color: 'var(--text-muted)',
            opacity: 0.75,
          }}
        >
          {subline}
        </span>
      )}
    </div>
  )
}

export function StatusBar() {
  const viewMode = useSimStore((s) => s.viewMode)
  const m = useSimStore((s) => s.displayMetrics)
  const resetDemo = useSimStore((s) => s.resetDemo)
  const setCreateModalOpen = useSimStore((s) => s.setCreateModalOpen)
  const showClusterExtras = viewMode === 'cluster' || viewMode === 'transitioning'
  const showOrgWide = viewMode === 'cluster'

  const onReset = () => {
    stopScenario()
    resetDemo()
  }

  return (
    <header
      className="relative z-50 flex items-center justify-between gap-4 border-b py-2.5 pl-6 pr-8"
      style={{
        background: 'rgba(10, 11, 15, 0.92)',
        borderColor: 'var(--border-subtle)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: fonts.display, color: 'var(--text-primary)' }}
        >
          VERIDIAN
        </h1>
        <span
          className="text-[10px] font-medium tracking-[0.2em] uppercase"
          style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
        >
          Agent Operations Center
        </span>
        <button
          type="button"
          className="mt-0.5 flex w-fit items-center gap-1 text-left text-[11px] transition hover:opacity-80"
          style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
          aria-disabled="true"
          title="Organization switcher (demo — Vantix AI only)"
          onClick={(e) => e.preventDefault()}
        >
          <span className="opacity-70" aria-hidden>
            ▾
          </span>
          <span className="tracking-wide">
            Viewing:{' '}
            <span style={{ color: 'var(--text-primary)', opacity: 0.85 }}>Vantix AI</span>
          </span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        {viewMode === 'cluster' && (
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="rounded border px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase transition hover:bg-white/5"
            style={{
              borderColor: 'rgba(77,216,255,0.35)',
              color: colors.cyan,
              fontFamily: fonts.mono,
            }}
          >
            + Agent
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="rounded border px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase transition hover:bg-white/5"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
            fontFamily: fonts.mono,
          }}
          title="Reset fully to swarm cold open"
        >
          Reset Demo
        </button>

        <div
          className="flex shrink-0 items-center divide-x"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Metric
            label="Active Agents"
            value={m.activeAgents.toLocaleString()}
            emphasize
            subline={
              showOrgWide ? `+${ORG_WIDE_EXTRA.toLocaleString()} org-wide` : undefined
            }
          />
          <Metric
            label="Tasks In Progress"
            value={m.tasksInProgress.toLocaleString()}
          />
          {showClusterExtras && (
            <>
              <Metric label="Blocked Workflows" value={String(m.blockedWorkflows)} />
              <Metric label="Approvals Waiting" value={String(m.approvalsWaiting)} />
            </>
          )}
          <Metric label="Money Under Mgmt" value={formatMoney(m.moneyUnderMgmt)} />
          <Metric
            label="Org Trust"
            value={String(m.organizationalTrust)}
            emphasize
            trailing={
              m.blockedWorkflows > 0 ? (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: [0, 1, 0.7], scale: 1 }}
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: colors.red, boxShadow: `0 0 8px ${colors.red}` }}
                  title="Blocked workflows affecting trust"
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </header>
  )
}
