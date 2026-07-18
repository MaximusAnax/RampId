import type { SwarmParticle } from './types'

export interface SwarmLink {
  a: number
  b: number
  life: number
  maxLife: number
}

const LINK_DISTANCE = 70
const LINK_CHANCE = 0.008

/** Soft wander — organic drift, not straight lines */
export function stepParticle(
  p: SwarmParticle,
  dt: number,
  width: number,
  height: number,
  time: number,
): void {
  // Perlin-ish wander via stacked sines
  const ax =
    Math.sin(time * 0.0004 + p.pulsePhase) * 0.02 +
    Math.sin(time * 0.0011 + p.x * 0.01) * 0.015
  const ay =
    Math.cos(time * 0.00035 + p.pulsePhase * 1.3) * 0.02 +
    Math.cos(time * 0.0009 + p.y * 0.01) * 0.015

  p.vx += ax
  p.vy += ay

  // Dampen
  p.vx *= 0.99
  p.vy *= 0.99

  // Cap speed — heroes drift slower
  const maxSpeed = p.isHero ? 0.25 : 0.55
  const speed = Math.hypot(p.vx, p.vy)
  if (speed > maxSpeed) {
    p.vx = (p.vx / speed) * maxSpeed
    p.vy = (p.vy / speed) * maxSpeed
  }

  p.x += p.vx * dt
  p.y += p.vy * dt
  p.pulsePhase += dt * 0.002

  // Soft wrap
  if (p.x < -10) p.x = width + 10
  if (p.x > width + 10) p.x = -10
  if (p.y < -10) p.y = height + 10
  if (p.y > height + 10) p.y = -10
}

export function updateLinks(
  particles: SwarmParticle[],
  links: SwarmLink[],
  dt: number,
): SwarmLink[] {
  const next: SwarmLink[] = []

  for (const link of links) {
    link.life -= dt
    if (link.life > 0) next.push(link)
  }

  // Occasionally spawn faint links between nearby particles
  if (Math.random() < LINK_CHANCE * dt) {
    const i = Math.floor(Math.random() * particles.length)
    const a = particles[i]
    let best = -1
    let bestDist = LINK_DISTANCE
    for (let j = 0; j < particles.length; j++) {
      if (j === i) continue
      const b = particles[j]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < bestDist) {
        bestDist = d
        best = j
      }
    }
    if (best >= 0) {
      next.push({
        a: i,
        b: best,
        life: 400 + Math.random() * 600,
        maxLife: 800,
      })
    }
  }

  return next
}

export function pulseBrightness(p: SwarmParticle, time: number): number {
  // Heroes ~60–70% opacity; ambient ~30–40% (Section 12 swarm)
  const base = p.isHero ? 0.62 : 0.34
  const shimmer = p.isHero
    ? 0.08 * Math.sin(time * 0.003 + p.pulsePhase)
    : 0.06 * Math.sin(time * 0.003 + p.pulsePhase)
  const burst =
    !p.isHero && Math.sin(time * 0.001 + p.pulsePhase * 3) > 0.97 ? 0.12 : 0
  return Math.min(p.isHero ? 0.72 : 0.42, base + shimmer + burst)
}
