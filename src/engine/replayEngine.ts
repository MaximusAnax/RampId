import { initialAgents } from '../data/initialAgents'
import { synapseFlowScenario } from './scenario_synapseflow'
import type {
  Agent,
  FeedItem,
  Metrics,
  OpportunityState,
  Relationship,
  SimEvent,
  Task,
} from './types'
import { applyTrustUpdate } from './trustEngine'

export interface ReplaySnapshot {
  agents: Record<string, Agent>
  relationships: Relationship[]
  tasks: Task[]
  feed: FeedItem[]
  opportunity: OpportunityState
  opportunityLabel: string
  metrics: Partial<Metrics>
}

function seedAgents(): Record<string, Agent> {
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

/**
 * Pure replay of SynapseFlow events 0..index (inclusive).
 * No timers, no flashes — rebuilds cluster state for the timeline scrubber.
 */
export function replaySynapseFlowToIndex(index: number): ReplaySnapshot {
  const agents = seedAgents()
  const relationships: Relationship[] = []
  const tasks: Task[] = []
  const feed: FeedItem[] = []
  let opportunity: OpportunityState = 'hidden'
  let opportunityLabel =
    'SynapseFlow — 40% Lower Cost — $240,000 Potential Annual Savings'
  const metrics: Partial<Metrics> = {
    blockedWorkflows: 0,
    approvalsWaiting: 0,
  }

  const capped = Math.max(-1, Math.min(index, synapseFlowScenario.length - 1))
  if (capped < 0) {
    return {
      agents,
      relationships,
      tasks,
      feed,
      opportunity,
      opportunityLabel,
      metrics,
    }
  }

  const upsertRel = (rel: Relationship) => {
    const i = relationships.findIndex((r) => r.id === rel.id)
    if (i === -1) relationships.push(rel)
    else relationships[i] = rel
  }

  const upsertTask = (task: Task) => {
    const i = tasks.findIndex((t) => t.id === task.id)
    if (i === -1) tasks.push(task)
    else tasks[i] = task
  }

  const applyEffect = (effect: string, event: SimEvent) => {
    const [kind, ...rest] = effect.split(':')
    const payload = rest.join(':')

    switch (kind) {
      case 'status': {
        const [id, status] = payload.split(':')
        if (agents[id]) agents[id].status = status as Agent['status']
        break
      }
      case 'task': {
        const [id, ...taskParts] = payload.split(':')
        if (agents[id]) agents[id].currentTask = taskParts.join(':')
        break
      }
      case 'block_reason': {
        const [id, ...reasonParts] = payload.split(':')
        if (agents[id]) {
          agents[id].blockReason = reasonParts.join(':')
          agents[id].status = 'blocked'
        }
        break
      }
      case 'rel': {
        const [id, type, source, target, status] = payload.split(':')
        upsertRel({
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
        const existing = relationships.find((r) => r.id === id)
        upsertRel({
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
        upsertRel({
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
        upsertTask({
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
        const agent = agents[id]
        if (!agent) break
        const updated = applyTrustUpdate(
          agent,
          delta,
          reasonParts.join(':') || event.message,
          event.timestamp,
        )
        Object.assign(agent, updated, { flash: null, floatingDelta: null })
        break
      }
      case 'spend': {
        const [id, amount] = payload.split(':')
        if (agents[id]) agents[id].spendingLimit = Number(amount)
        break
      }
      case 'opportunity': {
        const [state, ...labelParts] = payload.split(':')
        opportunity = state as OpportunityState
        if (labelParts.length) opportunityLabel = labelParts.join(':')
        break
      }
      case 'metrics': {
        const parts = payload.split(':')
        for (let i = 0; i < parts.length; i += 2) {
          const key = parts[i] as keyof Metrics
          metrics[key] = Number(parts[i + 1]) as never
        }
        break
      }
      default:
        break
    }
  }

  for (let i = 0; i <= capped; i++) {
    const event = synapseFlowScenario[i]
    const agentName =
      event.agentId === 'system'
        ? 'SYSTEM'
        : agents[event.agentId]?.name ?? event.agentId
    feed.unshift({
      id: `feed-replay-${event.id}`,
      agentId: event.agentId,
      agentName,
      message: event.message,
      timestamp: event.timestamp,
      typed: true,
    })
    for (const effect of event.downstreamEffects) {
      applyEffect(effect, event)
    }
  }

  return {
    agents,
    relationships,
    tasks,
    feed: feed.slice(0, 40),
    opportunity,
    opportunityLabel,
    metrics,
  }
}

export const TIMELINE_TICKS = [
  { index: 1, label: 'Vendor Found', time: '10:14:02' },
  { index: 3, label: 'Agents Converge', time: '10:14:08' },
  { index: 4, label: 'Correlation Detected', time: '10:14:11' },
  { index: 7, label: 'Blocked', time: '10:14:16' },
  { index: 9, label: 'Trust Changes', time: '10:14:22' },
  { index: 11, label: 'Resolution', time: '10:14:28' },
] as const
