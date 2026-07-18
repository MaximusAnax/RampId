import { synapseFlowScenario } from './scenario_synapseflow'
import { useSimStore } from '../store/useSimStore'

let timers: ReturnType<typeof setTimeout>[] = []
let running = false

export function stopScenario() {
  timers.forEach(clearTimeout)
  timers = []
  running = false
}

/**
 * Plays SynapseFlow from event index 1 (skips the opportunity card event —
 * that is already shown). Gated by Deploy click.
 */
export function startSynapseFlowScenario() {
  if (running) return
  running = true

  const store = useSimStore.getState()
  store.setScenarioStarted(true)
  store.setScenarioPaused(false)
  store.setOpportunity('investigating')

  const events = synapseFlowScenario.slice(1)

  let cumulative = 0
  events.forEach((event, i) => {
    cumulative += event.delayMs
    const delay = cumulative
    const absoluteIndex = i + 1 // account for skipped sf-1
    const t = setTimeout(() => {
      if (useSimStore.getState().scenarioPaused) return
      useSimStore.getState().applySimEvent(event, { index: absoluteIndex })
    }, delay)
    timers.push(t)
  })
}

/** Ambient idle feed ticks while waiting in swarm/cluster before deploy */
export function startAmbientFeed() {
  const lines = [
    { agentId: 'atlas', agentName: 'ATLAS', message: 'Reconciled 12 vendor invoices.' },
    { agentId: 'nova', agentName: 'NOVA', message: 'Flagged duplicate SaaS seat.' },
    { agentId: 'vega', agentName: 'VEGA', message: 'Closed rate negotiation — ACME.' },
    { agentId: 'sentinel', agentName: 'SENTINEL', message: 'Policy scan complete — clear.' },
    { agentId: 'aurora', agentName: 'AURORA', message: 'Approved quarterly budget envelope.' },
  ]

  let i = 0
  const tick = () => {
    const state = useSimStore.getState()
    if (state.scenarioStarted || state.viewMode === 'swarm') return
    const line = lines[i % lines.length]
    i++
    state.pushFeed({
      id: `ambient-${Date.now()}-${i}`,
      agentId: line.agentId,
      agentName: line.agentName,
      message: line.message,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    })
  }

  const interval = setInterval(tick, 2300)
  timers.push(interval as unknown as ReturnType<typeof setTimeout>)
  return () => clearInterval(interval)
}
