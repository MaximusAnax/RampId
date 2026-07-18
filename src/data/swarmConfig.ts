import { domainColors } from '../styles/tokens'
import type { SwarmParticle } from '../engine/types'
import { HERO_AGENT_IDS } from './initialAgents'

export const SWARM_PARTICLE_COUNT = 320

export const HERO_CLUSTER_CENTER = { x: 0.5, y: 0.48 }

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
