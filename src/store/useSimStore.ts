import { create } from 'zustand'
import { initialAgents } from '../data/initialAgents'
import type {
  Agent,
  AuthorityLevel,
  FeedItem,
  Metrics,
  OpportunityState,
  Relationship,
  SimEvent,
  Task,
  ViewMode,
} from '../engine/types'
import { applyTrustUpdate } from '../engine/trustEngine'
import {
  WHAT_IF_NOVA_THRESHOLD,
  WHAT_IF_CALLOUT,
  WHAT_IF_OUTCOME_CALLOUT,
  WHAT_IF_PLAYING_CALLOUT,
} from '../styles/tokens'
import {
  replaySynapseFlowToIndex,
  replayWhatIfToIndex,
} from '../engine/replayEngine'

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
export type ScenarioKind = 'main' | 'whatif'
export type WhatIfPhase = 'armed' | 'playing' | 'finished' | null
export interface CreateAgentInput {
  name: string
  role: string
  objective: string
  spendingLimit: number
  authorityLevel: AuthorityLevel
  riskTolerance: Agent['riskTolerance']
  requiredApprovals: string
  personalityBlurb?: string
}

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
  selectedAgentId: string | null
  whatIfActive: boolean
  whatIfCallout: string | null
  scenarioEventIndex: number
  createModalOpen: boolean
  demoEpoch: number
  /** Full-screen cinematic beat: block stamp or trust pulse */
  cinematicImpact: 'block' | 'trust' | null
  cinematicEpoch: number
  /** Cold-open / swarm: increments when a financial decision "lands" */
  decisionPulse: number
  scenarioKind: ScenarioKind
  whatIfPhase: WhatIfPhase

  setViewMode: (mode: ViewMode) => void
  setScenarioKind: (kind: ScenarioKind) => void
  prepareWhatIfRerun: () => void
  rerunWhatIfTimeline: () => void
  triggerCinematic: (kind: 'block' | 'trust') => void
  pulseDecision: () => void
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
  setScenarioPaused: (v: boolean) => void
  setSelectedAgentId: (id: string | null) => void
  setCreateModalOpen: (v: boolean) => void

  updateAgent: (id: string, patch: Partial<Agent>) => void
  clearAgentFlash: (id: string) => void
  upsertRelationship: (rel: Relationship) => void
  removeRelationship: (id: string) => void
  upsertTask: (task: Task) => void
  pushFeed: (item: Omit<FeedItem, 'typed'> & { typed?: boolean }) => void
  markFeedTyped: (id: string) => void
  applySimEvent: (event: SimEvent, opts?: { silent?: boolean; index?: number }) => void
  setMetrics: (patch: Partial<Metrics>) => void

  setSpendingLimit: (agentId: string, amount: number) => void
  applyNovaWhatIf: (amount: number) => void
  createAgent: (input: CreateAgentInput) => string
  resetDemo: () => void
  scrubToEventIndex: (index: number) => void
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
  return Object.fromEntries(
    initialAgents.map((a) => [
      a.id,
      {
        ...structuredClone(a),
        isNew: false,
        requiredApprovals: null,
        personalityBlurb: null,
      },
    ]),
  )
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
  selectedAgentId: null,
  whatIfActive: false,
  whatIfCallout: null,
  scenarioEventIndex: -1,
  createModalOpen: false,
  demoEpoch: 0,
  cinematicImpact: null,
  cinematicEpoch: 0,
  decisionPulse: 0,
  scenarioKind: 'main',
  whatIfPhase: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  setScenarioKind: (kind) => set({ scenarioKind: kind }),
  pulseDecision: () => set((s) => ({ decisionPulse: s.decisionPulse + 1 })),
  triggerCinematic: (kind) => {
    set((s) => ({
      cinematicImpact: kind,
      cinematicEpoch: s.cinematicEpoch + 1,
    }))
    window.setTimeout(() => {
      const cur = get()
      if (cur.cinematicImpact === kind) {
        set({ cinematicImpact: null })
      }
    }, kind === 'block' ? 1800 : 700)
  },
  setTransitionProgress: (p) => set({ transitionProgress: p }),
  setDisplayMetrics: (m) => set({ displayMetrics: m }),
  setUseMorphFallback: (v) => set({ useMorphFallback: v }),
  setSwarmPaused: (v) => set({ swarmPaused: v }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setCreateModalOpen: (v) => set({ createModalOpen: v }),
  setScenarioPaused: (v) => set({ scenarioPaused: v }),

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
    set((s) => {
      if (!s.agents[id]) return s
      return {
        agents: {
          ...s.agents,
          [id]: { ...s.agents[id], ...patch },
        },
      }
    }),

  clearAgentFlash: (id) =>
    set((s) => {
      if (!s.agents[id]) return s
      return {
        agents: {
          ...s.agents,
          [id]: { ...s.agents[id], flash: null, floatingDelta: null },
        },
      }
    }),

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
      feed: [{ ...item, typed: item.typed ?? false }, ...s.feed].slice(0, 40),
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

  applySimEvent: (event, opts) => {
    const store = get()
    const silent = opts?.silent ?? false
    if (!silent) {
      const agentName =
        event.agentId === 'system'
          ? 'SYSTEM'
          : store.agents[event.agentId]?.name ?? event.agentId
      store.pushFeed({
        id: `feed-${event.id}-${Date.now()}`,
        agentId: event.agentId,
        agentName,
        message: event.message,
        timestamp: event.timestamp,
      })
    }

    for (const effect of event.downstreamEffects) {
      applyEffect(effect, event, get, { silent })
    }

    if (opts?.index != null) {
      set({ scenarioEventIndex: opts.index })
    }
  },

  setSpendingLimit: (agentId, amount) => {
    get().updateAgent(agentId, { spendingLimit: amount })
    if (agentId === 'nova') {
      get().applyNovaWhatIf(amount)
    }
  },

  applyNovaWhatIf: (amount) => {
    const crossed = amount >= WHAT_IF_NOVA_THRESHOLD
    const state = get()
    // Do not arm/disarm mid what-if playback
    if (state.whatIfPhase === 'playing') return

    const phase = getScenarioPhase(state)
    if (crossed && phase === 'resolved') {
      set({
        whatIfActive: true,
        whatIfPhase: 'armed',
        whatIfCallout: WHAT_IF_CALLOUT,
      })
    } else if (!crossed) {
      set({
        whatIfActive: false,
        whatIfPhase: null,
        whatIfCallout: null,
      })
    }
  },

  prepareWhatIfRerun: () => {
    const novaSpend = get().agents.nova?.spendingLimit ?? WHAT_IF_NOVA_THRESHOLD
    const agents = agentsMap()
    if (agents.nova) {
      agents.nova.spendingLimit = Math.max(novaSpend, WHAT_IF_NOVA_THRESHOLD)
    }
    set({
      agents,
      relationships: [],
      tasks: [],
      feed: [],
      opportunity: 'investigating',
      opportunityLabel:
        'WHAT-IF · Nova authority raised — replaying SynapseFlow',
      scenarioStarted: true,
      scenarioPaused: false,
      scenarioEventIndex: -1,
      scenarioKind: 'whatif',
      whatIfActive: true,
      whatIfPhase: 'playing',
      whatIfCallout: WHAT_IF_PLAYING_CALLOUT,
      metrics: { ...CLUSTER_METRICS },
      displayMetrics: { ...CLUSTER_METRICS },
      selectedAgentId: null,
      cinematicImpact: null,
      viewMode: 'cluster',
    })
  },

  rerunWhatIfTimeline: () => {
    const state = get()
    if (state.whatIfPhase !== 'armed' && state.whatIfPhase !== 'finished') return
    if ((state.agents.nova?.spendingLimit ?? 0) < WHAT_IF_NOVA_THRESHOLD) return
    // Playback is started by startWhatIfScenario (calls prepareWhatIfRerun)
  },

  createAgent: (input) => {
    const id = `agent-${Date.now()}`
    const count = Object.keys(get().agents).length
    const agent: Agent = {
      id,
      name: input.name.toUpperCase(),
      role: input.role,
      objective: input.objective,
      model: 'Custom',
      builtBy: 'Internal team',
      trustScore: 70,
      trustDimensions: {
        policyCompliance: 70,
        decisionQuality: 70,
        costEfficiency: 70,
        reliability: 70,
        riskAwareness: 70,
        collaboration: 70,
      },
      authorityLevel: input.authorityLevel,
      spendingLimit: input.spendingLimit,
      riskTolerance: input.riskTolerance,
      status: 'idle',
      currentTask: null,
      position: {
        x: 400 + (count % 3) * 40,
        y: 520 + Math.floor(count / 3) * 30,
      },
      history: [],
      flash: null,
      floatingDelta: null,
      blockReason: null,
      isNew: true,
      requiredApprovals: input.requiredApprovals || null,
      personalityBlurb: input.personalityBlurb ?? null,
    }

    set((s) => ({
      agents: { ...s.agents, [id]: agent },
      metrics: {
        ...s.metrics,
        activeAgents: Object.keys(s.agents).length + 1,
      },
      displayMetrics: {
        ...s.displayMetrics,
        activeAgents: Object.keys(s.agents).length + 1,
      },
      createModalOpen: false,
      selectedAgentId: id,
    }))

    setTimeout(() => {
      get().updateAgent(id, { isNew: false })
    }, 3000)

    return id
  },

  resetDemo: () => {
    set((s) => ({
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
      transitionProgress: 0,
      selectedAgentId: null,
      whatIfActive: false,
      whatIfCallout: null,
      scenarioEventIndex: -1,
      scenarioKind: 'main',
      whatIfPhase: null,
      createModalOpen: false,
      demoEpoch: s.demoEpoch + 1,
      cinematicImpact: null,
      decisionPulse: 0,
    }))
  },

  scrubToEventIndex: (index) => {
    const kind = get().scenarioKind
    const novaSpend = get().agents.nova?.spendingLimit
    const snapshot =
      kind === 'whatif'
        ? replayWhatIfToIndex(index, {
            preserveNovaSpend: Math.max(
              novaSpend ?? WHAT_IF_NOVA_THRESHOLD,
              WHAT_IF_NOVA_THRESHOLD,
            ),
          })
        : replaySynapseFlowToIndex(index)
    set({
      agents: snapshot.agents,
      relationships: snapshot.relationships,
      tasks: snapshot.tasks,
      feed: snapshot.feed,
      opportunity: snapshot.opportunity,
      opportunityLabel: snapshot.opportunityLabel,
      scenarioPaused: true,
      scenarioStarted: true,
      scenarioEventIndex: index,
      whatIfActive: kind === 'whatif',
      whatIfPhase:
        kind === 'whatif'
          ? snapshot.opportunity === 'escalated'
            ? 'finished'
            : 'playing'
          : null,
      whatIfCallout:
        kind === 'whatif'
          ? snapshot.opportunity === 'escalated'
            ? WHAT_IF_OUTCOME_CALLOUT
            : WHAT_IF_PLAYING_CALLOUT
          : null,
      viewMode: 'cluster',
      metrics: { ...CLUSTER_METRICS, ...snapshot.metrics },
      displayMetrics: { ...CLUSTER_METRICS, ...snapshot.metrics },
    })
  },
}))

type Get = () => SimStore

export function applyEffect(
  effect: string,
  event: SimEvent,
  get: Get,
  opts?: { silent?: boolean },
) {
  const silent = opts?.silent ?? false
  const [kind, ...rest] = effect.split(':')
  const payload = rest.join(':')

  switch (kind) {
    case 'status': {
      const [id, status] = payload.split(':')
      get().updateAgent(id, { status: status as Agent['status'] })
      break
    }
    case 'task': {
      const [id, ...taskParts] = payload.split(':')
      get().updateAgent(id, { currentTask: taskParts.join(':') })
      break
    }
    case 'flash': {
      if (silent) break
      const [id, color] = payload.split(':')
      get().updateAgent(id, { flash: color as Agent['flash'] })
      setTimeout(() => get().clearAgentFlash(id), 1800)
      break
    }
    case 'block_reason': {
      const [id, ...reasonParts] = payload.split(':')
      get().updateAgent(id, {
        blockReason: reasonParts.join(':'),
        status: 'blocked',
      })
      if (!silent) get().triggerCinematic('block')
      break
    }
    case 'clear_block': {
      get().updateAgent(payload, { blockReason: null })
      break
    }
    case 'rel': {
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
        flash: silent ? null : delta < 0 ? 'red' : 'green',
        floatingDelta: silent ? null : delta,
      })
      if (!silent) {
        if (Math.abs(delta) >= 2) get().triggerCinematic('trust')
        setTimeout(() => get().clearAgentFlash(id), 2800)
      }
      break
    }
    case 'spend': {
      const [id, amount] = payload.split(':')
      get().updateAgent(id, { spendingLimit: Number(amount) })
      break
    }
    case 'opportunity': {
      const [state, ...labelParts] = payload.split(':')
      get().setOpportunity(
        state as OpportunityState,
        labelParts.join(':') || undefined,
      )
      if (state === 'escalated' && get().scenarioKind === 'whatif') {
        useSimStore.setState({
          whatIfActive: true,
          whatIfPhase: 'finished',
          whatIfCallout: WHAT_IF_OUTCOME_CALLOUT,
        })
      }
      break
    }
    case 'metrics': {
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
