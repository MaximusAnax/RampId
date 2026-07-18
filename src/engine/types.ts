export type AuthorityLevel = 0 | 1 | 2 | 3 | 4 // Observer, Assistant, Operator, Autonomous, Strategic

export interface TrustDimensions {
  policyCompliance: number
  decisionQuality: number
  costEfficiency: number
  reliability: number
  riskAwareness: number
  collaboration: number
}

export interface TrustHistoryEntry {
  timestamp: string
  scoreBefore: number
  scoreAfter: number
  reason: string
}

/** Context-conditioned reputation — per-domain scores (arXiv 2605.00073) */
export interface ReputationCard {
  domain: string
  score: number
  taskCount: number
  verificationBreakdown: {
    low: number
    medium: number
    high: number
  }
  lastUpdated: string
}

export type VerificationStrength = 'none' | 'low' | 'medium' | 'high'

export interface Agent {
  id: string
  name: string
  role: string
  objective: string
  trustScore: number
  trustDimensions: TrustDimensions
  authorityLevel: AuthorityLevel
  spendingLimit: number
  riskTolerance: 'conservative' | 'moderate' | 'aggressive'
  status: 'idle' | 'working' | 'blocked' | 'escalated' | 'under_review'
  currentTask: string | null
  position: { x: number; y: number }
  history: TrustHistoryEntry[]
  /** Visual flash overlay: null | 'green' | 'red' | 'amber' */
  flash: 'green' | 'red' | 'amber' | null
  floatingDelta: number | null
  blockReason: string | null
  /** Show NEW badge briefly after CreateAgentModal submit */
  isNew?: boolean
  requiredApprovals?: string | null
  personalityBlurb?: string | null
  /** Per-domain reputation cards — additive; scalar trustScore retained */
  reputationCards: ReputationCard[]
}

export type RelationshipType =
  | 'delegates_to'
  | 'depends_on'
  | 'provides_data_to'
  | 'requires_approval_from'
  | 'blocks'
  | 'coordinates_with'

export interface Relationship {
  id: string
  sourceAgentId: string
  targetAgentId: string
  type: RelationshipType
  status: 'active' | 'blocked' | 'pending' | 'complete' | 'severed'
  reason: string | null
  activeTaskId: string | null
  showX?: boolean
}

export interface Task {
  id: string
  name: string
  ownerAgentId: string
  dependsOnTaskIds: string[]
  status: 'pending' | 'in_progress' | 'blocked' | 'complete'
  riskLevel: 'low' | 'medium' | 'high'
  financialValue: number | null
  requiredAuthority: AuthorityLevel
  verificationStrength: VerificationStrength
  verificationMethod: string | null
}

export interface SimEvent {
  id: string
  timestamp: string
  type:
    | 'discovery'
    | 'analysis'
    | 'block'
    | 'trust_update'
    | 'authority_update'
    | 'escalation'
    | 'resolution'
    | 'system'
  agentId: string
  taskId: string | null
  message: string
  trustImpact: number | null
  authorityImpact: number | null
  downstreamEffects: string[]
  /** Delay before this event fires after previous (ms) */
  delayMs: number
}

export interface SwarmParticle {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  domainColor: string
  pulsePhase: number
  isHero: boolean
  heroAgentId: string | null
}

export interface FeedItem {
  id: string
  agentId: string
  agentName: string
  message: string
  timestamp: string
  typed: boolean
}

export interface Metrics {
  activeAgents: number
  tasksInProgress: number
  moneyUnderMgmt: number
  organizationalTrust: number
  blockedWorkflows: number
  approvalsWaiting: number
}

export type ViewMode = 'swarm' | 'transitioning' | 'cluster'

export type OpportunityState = 'hidden' | 'ready' | 'investigating' | 'escalated'
