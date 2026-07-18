import { create } from 'zustand'
import { initialAgents } from '../data/initialAgents'
import type {
  Agent,
  FeedItem,
  Metrics,
  OpportunityState,
  Relationship,
  SimEvent,
  Task,
  ViewMode,
} from '../engine/types'
import { applyTrustUpdate } from '../engine/trustEngine'

export const SWARM_METRICS: Metrics = {
  activeAgents: 612,
  tasksInProgress: 1847,
  moneyUnderMgmt: 2_400_000,
  organizationalTrust: 87,
  blockedWorkflows: 0,
  approvalsWaiting: 0,
}

export const CLUSTER_METRICS: Metrics = {
  activeAgents: 5,
  tasksInProgress: 12,
  moneyUnderMgmt: 2_400_000,
  organizationalTrust: 87,
  blockedWorkflows: 0,
  approvalsWaiting: 0,
}

export type TransitionDirection = 'in' | 'out'
export type ScenarioPhase = 'idle' | 'playing' | 'resolved'

interface SimStore {
  viewMode: ViewMode
  metrics: Metrics
  displayMetrics: Metrics
  agents: Record<string, Agent>
  relationships: Relationship[]
  tasks: Task[]
  feed: FeedItem[]
  opportunity: OpportunityState
  opportunityLabel: string
  scenarioStarted: boolean
  scenarioPaused: boolean
  useMorphFallback: boolean
  transitionProgress: number
  transitionDirection: TransitionDirection
  /** True after pull-back until return zoom completes — camera move, not reset */
  pulledBack: boolean
  /** Cluster metrics captured at pull-back so return zoom restores scenario state */
  clusterMetricsSnapshot: Metrics | null
  /** Pause background swarm ticker (modals / overlays) */
  swarmPaused: boolean

  setViewMode: (mode: ViewMode) => void
  setTransitionProgress: (p: number) => void
  setDisplayMetrics: (m: Metrics) => void
  lerpMetricsToCluster: (t: number) => void
  startZoom: () => void
  completeZoom: () => void
  startPullBack: () => void
  completePullBack: () => void
  setUseMorphFallback: (v: boolean) => void
  setSwarmPaused: (v: boolean) => void

  setOpportunity: (state: OpportunityState, label?: string) => void
  setScenarioStarted: (v: boolean) => void

  updateAgent: (id: string, patch: Partial<Agent>) => void
  clearAgentFlash: (id: string) => void
  upsertRelationship: (rel: Relationship) => void
  removeRelationship: (id: string) => void
  upsertTask: (task: Task) => void
  pushFeed: (item: Omit<FeedItem, 'typed'> & { typed?: boolean }) => void
  markFeedTyped: (id: string) => void
  applySimEvent: (event: SimEvent) => void
  setMetrics: (patch: Partial<Metrics>) => void
}

/** Gate pull-back / presentational UI off scenario lifecycle */
export function getScenarioPhase(s: {
  scenarioStarted: boolean
  opportunity: OpportunityState
}): ScenarioPhase {
  if (!s.scenarioStarted) return 'idle'
  if (s.opportunity === 'escalated') return 'resolved'
  return 'playing'
}

function agentsMap(): Record<string, Agent> {
  return Object.fromEntries(initialAgents.map((a) => [a.id, structuredClone(a)]))
}

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t)
}

export const useSimStore = create<SimStore>((set, get) => ({
  viewMode: 'swarm',
  metrics: { ...SWARM_METRICS },
  displayMetrics: { ...SWARM_METRICS },
  agents: agentsMap(),
  relationships: [],
  tasks: [],
  feed: [],
  opportunity: 'hidden',
  opportunityLabel:
    'SynapseFlow — 40% Lower Cost — $240,000 Potential Annual Savings',
  scenarioStarted: false,
  scenarioPaused: false,
  useMorphFallback: false,
  transitionProgress: 0,
  transitionDirection: 'in',
  pulledBack: false,
  clusterMetricsSnapshot: null,
  swarmPaused: false,

  setViewMode: (mode) => set({ viewMode: mode }),
  setTransitionProgress: (p) => set({ transitionProgress: p }),
  setDisplayMetrics: (m) => set({ displayMetrics: m }),
  setUseMorphFallback: (v) => set({ useMorphFallback: v }),
  setSwarmPaused: (v) => set({ swarmPaused: v }),

  lerpMetricsToCluster: (t) => {
    const state = get()
    const s = SWARM_METRICS
    // When returning from pull-back, lerp toward the snapshotted cluster metrics
    const c = state.clusterMetricsSnapshot ?? CLUSTER_METRICS
    set({
      displayMetrics: {
        activeAgents: lerp(s.activeAgents, c.activeAgents, t),
        tasksInProgress: lerp(s.tasksInProgress, c.tasksInProgress, t),
        moneyUnderMgmt: lerp(s.moneyUnderMgmt, c.moneyUnderMgmt, t),
        organizationalTrust: lerp(
          s.organizationalTrust,
          c.organizationalTrust,
          t,
        ),
        blockedWorkflows: lerp(s.blockedWorkflows, c.blockedWorkflows, t),
        approvalsWaiting: lerp(s.approvalsWaiting, c.approvalsWaiting, t),
      },
    })
  },

  startZoom: () =>
    set({
      viewMode: 'transitioning',
      transitionProgress: 0,
      transitionDirection: 'in',
      // Opportunity stays hidden — revealed ~30s after cluster settle
    }),

  completeZoom: () => {
    const state = get()
    // Return-from-pull-back restores snapshotted cluster metrics (incl. scenario patches).
    // Fresh first zoom uses CLUSTER_METRICS. Agent/feed/opportunity state is never cleared here.
    const restored = state.clusterMetricsSnapshot
    set({
      viewMode: 'cluster',
      transitionProgress: 1,
      transitionDirection: 'in',
      pulledBack: false,
      clusterMetricsSnapshot: null,
      metrics: restored ? { ...restored } : { ...CLUSTER_METRICS },
      displayMetrics: restored ? { ...restored } : { ...CLUSTER_METRICS },
    })
  },

  startPullBack: () => {
    const state = get()
    set({
      viewMode: 'transitioning',
      transitionProgress: 1,
      transitionDirection: 'out',
      pulledBack: true,
      clusterMetricsSnapshot: { ...state.displayMetrics },
    })
  },

  completePullBack: () =>
    set({
      viewMode: 'swarm',
      transitionProgress: 0,
      transitionDirection: 'out',
      pulledBack: true,
      metrics: { ...SWARM_METRICS },
      displayMetrics: { ...SWARM_METRICS },
      // Intentionally keep agents, feed, opportunity, scenarioStarted intact
    }),

  setOpportunity: (state, label) =>
    set({
      opportunity: state,
      ...(label ? { opportunityLabel: label } : {}),
    }),

  setScenarioStarted: (v) => set({ scenarioStarted: v }),

  updateAgent: (id, patch) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [id]: { ...s.agents[id], ...patch },
      },
    })),

  clearAgentFlash: (id) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [id]: { ...s.agents[id], flash: null, floatingDelta: null },
      },
    })),

  upsertRelationship: (rel) =>
    set((s) => {
      const idx = s.relationships.findIndex((r) => r.id === rel.id)
      if (idx === -1) return { relationships: [...s.relationships, rel] }
      const next = [...s.relationships]
      next[idx] = rel
      return { relationships: next }
    }),

  removeRelationship: (id) =>
    set((s) => ({
      relationships: s.relationships.filter((r) => r.id !== id),
    })),

  upsertTask: (task) =>
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === task.id)
      if (idx === -1) return { tasks: [...s.tasks, task] }
      const next = [...s.tasks]
      next[idx] = task
      return { tasks: next }
    }),

  pushFeed: (item) =>
    set((s) => ({
      feed: [
        { ...item, typed: item.typed ?? false },
        ...s.feed,
      ].slice(0, 40),
    })),

  markFeedTyped: (id) =>
    set((s) => ({
      feed: s.feed.map((f) => (f.id === id ? { ...f, typed: true } : f)),
    })),

  setMetrics: (patch) =>
    set((s) => ({
      metrics: { ...s.metrics, ...patch },
      displayMetrics: { ...s.displayMetrics, ...patch },
    })),

  applySimEvent: (event) => {
    const store = get()
    const agentName =
      event.agentId === 'system'
        ? 'SYSTEM'
        : store.agents[event.agentId]?.name ?? event.agentId

    store.pushFeed({
      id: `feed-${event.id}`,
      agentId: event.agentId,
      agentName,
      message: event.message,
      timestamp: event.timestamp,
    })

    for (const effect of event.downstreamEffects) {
      applyEffect(effect, event, get)
    }
  },
}))

type Get = () => SimStore

function applyEffect(
  effect: string,
  event: SimEvent,
  get: Get,
) {
  const [kind, ...rest] = effect.split(':')
  const payload = rest.join(':')

  switch (kind) {
    case 'status': {
      // status:nova:blocked
      const [id, status] = payload.split(':')
      get().updateAgent(id, {
        status: status as Agent['status'],
      })
      break
    }
    case 'task': {
      // task:nova:Estimated annual savings analysis
      const [id, ...taskParts] = payload.split(':')
      get().updateAgent(id, { currentTask: taskParts.join(':') })
      break
    }
    case 'flash': {
      const [id, color] = payload.split(':')
      get().updateAgent(id, {
        flash: color as Agent['flash'],
      })
      setTimeout(() => get().clearAgentFlash(id), 1800)
      break
    }
    case 'block_reason': {
      const [id, ...reasonParts] = payload.split(':')
      get().updateAgent(id, {
        blockReason: reasonParts.join(':'),
        status: 'blocked',
      })
      break
    }
    case 'clear_block': {
      get().updateAgent(payload, {
        blockReason: null,
      })
      break
    }
    case 'rel': {
      // rel:atlas-nova:provides_data_to:atlas:nova:active
      const [id, type, source, target, status] = payload.split(':')
      get().upsertRelationship({
        id,
        type: type as Relationship['type'],
        sourceAgentId: source,
        targetAgentId: target,
        status: (status as Relationship['status']) ?? 'active',
        reason: null,
        activeTaskId: null,
      })
      break
    }
    case 'rel_block': {
      // rel_block:sentinel-nova:SENTINEL blocked NOVA
      const [id, ...reasonParts] = payload.split(':')
      const existing = get().relationships.find((r) => r.id === id)
      get().upsertRelationship({
        id,
        type: 'blocks',
        sourceAgentId: existing?.sourceAgentId ?? 'sentinel',
        targetAgentId: existing?.targetAgentId ?? 'nova',
        status: 'blocked',
        reason: reasonParts.join(':') || 'Blocked',
        activeTaskId: null,
        showX: true,
      })
      break
    }
    case 'rel_sever': {
      get().upsertRelationship({
        id: payload,
        type: 'provides_data_to',
        sourceAgentId: 'nova',
        targetAgentId: 'vega',
        status: 'severed',
        reason: 'Workflow severed',
        activeTaskId: null,
      })
      break
    }
    case 'add_task': {
      // add_task:vendor-verification:Vendor Verification:atlas:pending:medium
      const [id, name, owner, status, risk] = payload.split(':')
      get().upsertTask({
        id,
        name,
        ownerAgentId: owner,
        dependsOnTaskIds: [],
        status: status as Task['status'],
        riskLevel: (risk as Task['riskLevel']) ?? 'medium',
        financialValue: null,
        requiredAuthority: 2,
      })
      break
    }
    case 'trust': {
      // trust:nova:-8:Attempted to proceed without verification
      const [id, deltaStr, ...reasonParts] = payload.split(':')
      const delta = Number(deltaStr)
      const agent = get().agents[id]
      if (!agent) break
      const updated = applyTrustUpdate(
        agent,
        delta,
        reasonParts.join(':') || event.message,
        event.timestamp,
      )
      get().updateAgent(id, {
        ...updated,
        flash: delta < 0 ? 'red' : 'green',
        floatingDelta: delta,
      })
      setTimeout(() => get().clearAgentFlash(id), 2200)
      break
    }
    case 'spend': {
      // spend:nova:2500
      const [id, amount] = payload.split(':')
      get().updateAgent(id, { spendingLimit: Number(amount) })
      break
    }
    case 'opportunity': {
      // opportunity:escalated:Escalated to Vega — pending executive review.
      const [state, ...labelParts] = payload.split(':')
      get().setOpportunity(
        state as OpportunityState,
        labelParts.join(':') || undefined,
      )
      break
    }
    case 'metrics': {
      // metrics:blockedWorkflows:1:approvalsWaiting:1
      const parts = payload.split(':')
      const patch: Partial<Metrics> = {}
      for (let i = 0; i < parts.length; i += 2) {
        const key = parts[i] as keyof Metrics
        patch[key] = Number(parts[i + 1])
      }
      get().setMetrics(patch)
      break
    }
    default:
      break
  }
}
