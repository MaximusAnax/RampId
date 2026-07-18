export const colors = {
  bgDeep: '#0A0B0F',
  bgPanel: '#0d1520',
  bgElevated: '#121c2a',
  borderSubtle: 'rgba(148, 163, 184, 0.12)',
  textPrimary: '#E4E7EB',
  textMuted: '#8b9bb0',
  cyan: '#4DD8FF',
  amber: '#FFB84D',
  red: '#FF4D5E',
  green: '#22c55e',
  blue: '#4DD8FF',
  slate: '#94a3b8',
  gold: '#FFB84D',
} as const

/** Trust score color bands (Section 12) */
export function trustScoreColor(score: number, dropping = false): string {
  if (score < 60 || dropping) return colors.amber
  if (score >= 85) return colors.cyan
  return colors.textPrimary
}

/** Subtle domain tint variants — same cyan family, not rainbow */
export const domainColors = [
  '#4DD8FF',
  '#3BC4EB',
  '#5ADFFF',
  '#6AE0FF',
  '#94a3b8',
  '#7DD3F0',
] as const

export const SWARM_BASE_COLOR = '#4DD8FF'
export const SWARM_AMBIENT_OPACITY = 0.35
export const SWARM_HERO_OPACITY = 0.65

export const statusColors = {
  idle: '#64748b',
  working: '#4DD8FF',
  blocked: '#FF4D5E',
  escalated: '#FFB84D',
  under_review: '#4DD8FF',
} as const

/** Edge styling by relationship type (Section 12) */
export const relationshipColors: Record<string, string> = {
  delegates_to: '#94a3b8',
  depends_on: '#94a3b8',
  provides_data_to: '#4DD8FF',
  requires_approval_from: '#FFB84D',
  blocks: '#FF4D5E',
  coordinates_with: '#94a3b8',
}

export const fonts = {
  display: '"Syne", sans-serif',
  body: '"DM Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const

export const zoomDurationMs = 2200
export const morphFallback = false

/** What-if: NOVA spending limit threshold for alternate branch */
export const WHAT_IF_NOVA_THRESHOLD = 10_000
export const WHAT_IF_NOVA_MAX = 25_000
export const WHAT_IF_CALLOUT =
  'Nova would have advanced the transaction before Sentinel could intervene.'
export const WHAT_IF_OUTCOME_CALLOUT =
  'Same vendor. One number. Nova committed $18,400 before Sentinel could stop it — that is the cost of over-autonomy.'
export const WHAT_IF_PLAYING_CALLOUT =
  'Playing alternate timeline — Nova authority $25,000…'
