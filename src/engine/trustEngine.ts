import type { Agent } from './types'

export function applyTrustUpdate(
  agent: Agent,
  delta: number,
  reason: string,
  timestamp: string,
): Partial<Agent> {
  const scoreBefore = agent.trustScore
  const scoreAfter = Math.max(0, Math.min(100, scoreBefore + delta))

  let spendingLimit = agent.spendingLimit
  // Scripted side-effects for known agents (deterministic demo)
  if (agent.id === 'nova' && delta < 0) {
    spendingLimit = 2_500
  }
  if (agent.id === 'vega' && delta > 0) {
    spendingLimit = 75_000
  }

  return {
    trustScore: scoreAfter,
    spendingLimit,
    history: [
      ...agent.history,
      { timestamp, scoreBefore, scoreAfter, reason },
    ],
  }
}

export function authorityLabel(level: number): string {
  return (
    ['Observer', 'Assistant', 'Operator', 'Autonomous', 'Strategic'][level] ??
    'Unknown'
  )
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}
