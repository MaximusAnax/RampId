import { motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { formatMoney } from '../engine/trustEngine'
import { fonts } from '../styles/tokens'

function Metric({
  label,
  value,
  emphasize,
}: {
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 first:pl-0 lg:px-4">
      <span
        className="text-[10px] font-medium tracking-[0.18em] uppercase"
        style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
      >
        {label}
      </span>
      <motion.span
        key={value}
        initial={{ opacity: 0.4, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="text-lg font-semibold tabular-nums tracking-tight"
        style={{
          fontFamily: fonts.mono,
          color: emphasize ? 'var(--accent-cyan)' : 'var(--text-primary)',
        }}
      >
        {value}
      </motion.span>
    </div>
  )
}

export function StatusBar() {
  const viewMode = useSimStore((s) => s.viewMode)
  const m = useSimStore((s) => s.displayMetrics)
  const showClusterExtras = viewMode === 'cluster' || viewMode === 'transitioning'

  return (
    <header
      className="relative z-50 flex items-center justify-between gap-6 border-b px-6 py-2.5"
      style={{
        background: 'rgba(7, 11, 18, 0.9)',
        borderColor: 'var(--border-subtle)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: fonts.display, color: 'var(--text-primary)' }}
        >
          RAMP IDENTITY
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
            Viewing: <span style={{ color: 'var(--text-primary)', opacity: 0.85 }}>Vantix AI</span>
          </span>
        </button>
      </div>

      <div
        className="flex shrink-0 items-center divide-x"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <Metric
          label="Active Agents"
          value={m.activeAgents.toLocaleString()}
          emphasize
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
        <Metric label="Org Trust" value={String(m.organizationalTrust)} emphasize />
      </div>
    </header>
  )
}
