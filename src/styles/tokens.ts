export const colors = {
  bgDeep: '#070b12',
  bgPanel: '#0d1520',
  bgElevated: '#121c2a',
  borderSubtle: 'rgba(148, 163, 184, 0.12)',
  textPrimary: '#e8eef6',
  textMuted: '#8b9bb0',
  cyan: '#2dd4bf',
  amber: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  blue: '#38bdf8',
  slate: '#64748b',
} as const

/** Cosmetic domain colors for ambient swarm particles */
export const domainColors = [
  '#2dd4bf', // procurement
  '#38bdf8', // travel
  '#f59e0b', // finance
  '#34d399', // vendor mgmt
  '#94a3b8', // ops
  '#fb7185', // compliance
] as const

export const statusColors = {
  idle: '#64748b',
  working: '#2dd4bf',
  blocked: '#ef4444',
  escalated: '#f59e0b',
  under_review: '#38bdf8',
} as const

export const relationshipColors: Record<string, string> = {
  delegates_to: '#38bdf8',
  depends_on: '#f59e0b',
  provides_data_to: '#2dd4bf',
  requires_approval_from: '#a78bfa',
  blocks: '#ef4444',
  coordinates_with: '#94a3b8',
}

export const fonts = {
  display: '"Syne", sans-serif',
  body: '"DM Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const

export const zoomDurationMs = 2200
export const morphFallback = false // set true if hero-dot morph is fragile in rehearsal
