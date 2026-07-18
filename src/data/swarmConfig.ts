import { domainColors } from '../styles/tokens'
import type { SwarmParticle } from '../engine/types'
import { HERO_AGENT_IDS } from './initialAgents'

export const SWARM_PARTICLE_COUNT = 320
export const BACKGROUND_PARTICLE_COUNT = 130

export const HERO_CLUSTER_CENTER = { x: 0.5, y: 0.48 }

/** Normalized exclusion ellipse covering hero cards + opportunity card */
const CENTER_EXCLUSION = { rx: 0.38, ry: 0.42 }

/** Relative offsets for the 5 hero particles around center (normalized 0–1) */
export const HERO_OFFSETS: Record<string, { x: number; y: number }> = {
  aurora: { x: 0, y: -0.04 },
  vega: { x: -0.035, y: 0.01 },
  sentinel: { x: 0.035, y: 0.01 },
  atlas: { x: -0.05, y: 0.05 },
  nova: { x: 0.05, y: 0.05 },
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export function createSwarmParticles(
  width: number,
  height: number,
): SwarmParticle[] {
  const particles: SwarmParticle[] = []
  const cx = width * HERO_CLUSTER_CENTER.x
  const cy = height * HERO_CLUSTER_CENTER.y

  // Hero particles first — denser, brighter cluster near center
  for (const agentId of HERO_AGENT_IDS) {
    const offset = HERO_OFFSETS[agentId]
    particles.push({
      id: `hero-${agentId}`,
      x: cx + offset.x * width + rand(-8, 8),
      y: cy + offset.y * height + rand(-8, 8),
      vx: rand(-0.15, 0.15),
      vy: rand(-0.15, 0.15),
      domainColor: domainColors[0],
      pulsePhase: rand(0, Math.PI * 2),
      isHero: true,
      heroAgentId: agentId,
    })
  }

  const ambientCount = SWARM_PARTICLE_COUNT - HERO_AGENT_IDS.length
  for (let i = 0; i < ambientCount; i++) {
    particles.push({
      id: `p-${i}`,
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-0.35, 0.35),
      vy: rand(-0.35, 0.35),
      domainColor: domainColors[i % domainColors.length],
      pulsePhase: rand(0, Math.PI * 2),
      isHero: false,
      heroAgentId: null,
    })
  }

  return particles
}

export function getHeroScreenCenter(width: number, height: number) {
  return {
    x: width * HERO_CLUSTER_CENTER.x,
    y: height * HERO_CLUSTER_CENTER.y,
  }
}

function inCenterExclusion(nx: number, ny: number): boolean {
  const dx = (nx - HERO_CLUSTER_CENTER.x) / CENTER_EXCLUSION.rx
  const dy = (ny - HERO_CLUSTER_CENTER.y) / CENTER_EXCLUSION.ry
  return dx * dx + dy * dy < 1
}

/**
 * Ambient periphery particles for cluster-mode background.
 * Density is highest at edges/corners; center card region is avoided.
 */
export function createBackgroundParticles(
  width: number,
  height: number,
  count = BACKGROUND_PARTICLE_COUNT,
): SwarmParticle[] {
  const particles: SwarmParticle[] = []
  let attempts = 0
  const maxAttempts = count * 40

  while (particles.length < count && attempts < maxAttempts) {
    attempts++
    // Bias toward edges: sample then reject center; also prefer high |edge| distance
    const nx = Math.random()
    const ny = Math.random()
    if (inCenterExclusion(nx, ny)) continue

    const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny)
    // Soft accept: closer to edge → higher keep probability
    const keepChance = 0.35 + (0.5 - Math.min(edgeDist, 0.5)) * 1.3
    if (Math.random() > keepChance) continue

    particles.push({
      id: `bg-${particles.length}`,
      x: nx * width,
      y: ny * height,
      vx: rand(-0.2, 0.2),
      vy: rand(-0.2, 0.2),
      domainColor: domainColors[particles.length % domainColors.length],
      pulsePhase: rand(0, Math.PI * 2),
      isHero: false,
      heroAgentId: null,
    })
  }

  // Fill any shortfall with pure edge-band samples
  while (particles.length < count) {
    const side = Math.floor(Math.random() * 4)
    let nx = 0
    let ny = 0
    if (side === 0) {
      nx = rand(0, 1)
      ny = rand(0, 0.12)
    } else if (side === 1) {
      nx = rand(0, 1)
      ny = rand(0.88, 1)
    } else if (side === 2) {
      nx = rand(0, 0.12)
      ny = rand(0, 1)
    } else {
      nx = rand(0.88, 1)
      ny = rand(0, 1)
    }
    if (inCenterExclusion(nx, ny)) continue
    particles.push({
      id: `bg-${particles.length}`,
      x: nx * width,
      y: ny * height,
      vx: rand(-0.2, 0.2),
      vy: rand(-0.2, 0.2),
      domainColor: domainColors[particles.length % domainColors.length],
      pulsePhase: rand(0, Math.PI * 2),
      isHero: false,
      heroAgentId: null,
    })
  }

  return particles
}
