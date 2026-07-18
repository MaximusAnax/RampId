import { synapseFlowScenario } from './scenario_synapseflow'
import { synapseFlowWhatIfScenario } from './scenario_synapseflow_whatif'
import { useSimStore } from '../store/useSimStore'

let timers: ReturnType<typeof setTimeout>[] = []
let running = false

export function stopScenario() {
  timers.forEach(clearTimeout)
  timers = []
  running = false
}

function scheduleScenario(
  events: typeof synapseFlowScenario,
  startIndex: number,
) {
  let cumulative = 0
  events.forEach((event, i) => {
    cumulative += event.delayMs
    const delay = cumulative
    const absoluteIndex = startIndex + i
    const t = setTimeout(() => {
      if (useSimStore.getState().scenarioPaused) return
      useSimStore.getState().applySimEvent(event, { index: absoluteIndex })
    }, delay)
    timers.push(t)
  })
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
  store.setScenarioKind('main')
  store.setOpportunity('investigating')

  scheduleScenario(synapseFlowScenario.slice(1), 1)
}

/**
 * Plays the what-if alternate timeline from the start.
 * Resets cluster via prepareWhatIfRerun, preserving Nova's raised spend limit.
 */
export function startWhatIfScenario() {
  const store = useSimStore.getState()
  if (store.whatIfPhase !== 'armed' && store.whatIfPhase !== 'finished') return
  if ((store.agents.nova?.spendingLimit ?? 0) < 10_000) return

  stopScenario()
  running = true
  store.prepareWhatIfRerun()

  // Skip wf-1 (already reflected in prepareWhatIfRerun opportunity state)
  scheduleScenario(synapseFlowWhatIfScenario.slice(1), 1)
}

const HERO_AMBIENT_LINES = [
  { agentId: 'atlas', agentName: 'ATLAS', message: 'Reconciled 12 vendor invoices.' },
  { agentId: 'nova', agentName: 'NOVA', message: 'Flagged duplicate SaaS seat.' },
  { agentId: 'vega', agentName: 'VEGA', message: 'Closed rate negotiation — ACME.' },
  { agentId: 'sentinel', agentName: 'SENTINEL', message: 'Policy scan complete — clear.' },
  { agentId: 'aurora', agentName: 'AURORA', message: 'Approved quarterly budget envelope.' },
] as const

const FLUFF_MESSAGES = [
  'Processed expense batch.',
  'Synced vendor catalog entry.',
  'Cleared travel policy exception.',
  'Matched PO to invoice.',
  'Queued card limit review.',
  'Updated cost center mapping.',
  'Closed stale reimbursement thread.',
  'Verified receipt attachment.',
  'Routed approval to manager.',
  'Flagged unused license seat.',
  'Reconciled corporate card charge.',
  'Refreshed budget forecast slice.',
]

function randomFluffAgent(): { agentId: string; agentName: string } {
  const roll = Math.floor(Math.random() * 3)
  if (roll === 0) {
    const n = 1000 + Math.floor(Math.random() * 9000)
    return { agentId: `ag-${n}`, agentName: `AG-${n}` }
  }
  if (roll === 1) {
    const n = 100 + Math.floor(Math.random() * 900)
    return { agentId: `p-${n}`, agentName: `p-${n}` }
  }
  const n = 1000 + Math.floor(Math.random() * 9000)
  return { agentId: `ops-${n}`, agentName: `OPS-${n}` }
}

const AMBIENT_TASKS: Set<string> = new Set(HERO_AMBIENT_LINES.map((l) => l.message))

/**
 * Ambient idle feed ticks while waiting in cluster before deploy.
 * Rotates hero working status with hero lines; mixes org-wide fluff agents.
 * Stops posting (and clears ambient hero status) once scenarioStarted.
 */
export function startAmbientFeed() {
  let tickCount = 0
  let heroIndex = 0
  let ambientHeroId: string | null = null
  let clearedForScenario = false

  /** Release ambient ownership without clobbering scripted status/task. */
  const releaseAmbientHero = () => {
    if (!ambientHeroId) return
    const id = ambientHeroId
    ambientHeroId = null
    const agent = useSimStore.getState().agents[id]
    if (!agent) return
    if (agent.currentTask && !AMBIENT_TASKS.has(agent.currentTask)) return
    useSimStore.getState().updateAgent(id, { status: 'idle', currentTask: null })
  }

  const onScenarioStarted = () => {
    if (clearedForScenario) return
    clearedForScenario = true
    releaseAmbientHero()
  }

  const tick = () => {
    const state = useSimStore.getState()
    if (state.scenarioStarted) {
      onScenarioStarted()
      return
    }
    if (state.viewMode === 'swarm') return

    tickCount++
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })

    // ~1 in 3 ticks is a hero line; rest are org-wide fluff (~600-agent feel)
    const isHeroTick = tickCount % 3 === 1

    if (isHeroTick) {
      const line = HERO_AMBIENT_LINES[heroIndex % HERO_AMBIENT_LINES.length]
      heroIndex++

      if (ambientHeroId && ambientHeroId !== line.agentId) {
        state.updateAgent(ambientHeroId, { status: 'idle', currentTask: null })
      }
      ambientHeroId = line.agentId
      state.updateAgent(line.agentId, {
        status: 'working',
        currentTask: line.message,
      })
      state.pushFeed({
        id: `ambient-${Date.now()}-${tickCount}`,
        agentId: line.agentId,
        agentName: line.agentName,
        message: line.message,
        timestamp,
      })
      return
    }

    const fluff = randomFluffAgent()
    const message = FLUFF_MESSAGES[Math.floor(Math.random() * FLUFF_MESSAGES.length)]
    state.pushFeed({
      id: `ambient-${Date.now()}-${tickCount}`,
      agentId: fluff.agentId,
      agentName: fluff.agentName,
      message,
      timestamp,
    })
  }

  // Clear ambient hero as soon as deploy flips scenarioStarted (don't wait for next tick)
  const unsub = useSimStore.subscribe((s) => {
    if (s.scenarioStarted) onScenarioStarted()
  })

  const interval = setInterval(tick, 2300)
  timers.push(interval as unknown as ReturnType<typeof setTimeout>)
  return () => {
    unsub()
    clearInterval(interval)
    if (!useSimStore.getState().scenarioStarted) releaseAmbientHero()
  }
}
