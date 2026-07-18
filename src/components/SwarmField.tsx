import { useEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import { createSwarmParticles, getHeroScreenCenter } from '../data/swarmConfig'
import {
  pulseBrightness,
  stepParticle,
  updateLinks,
  type SwarmLink,
} from '../engine/swarmEngine'
import type { SwarmParticle } from '../engine/types'
import { colors } from '../styles/tokens'

interface SwarmFieldProps {
  active: boolean
  /** 0–1 during zoom; fades periphery */
  zoomProgress?: number
  /** CSS transform applied to canvas wrapper during zoom */
  transformStyle?: React.CSSProperties
  onHeroCenter?: (center: { x: number; y: number }) => void
  cullNonHero?: boolean
}

export function SwarmField({
  active,
  zoomProgress = 0,
  transformStyle,
  onHeroCenter,
  cullNonHero = false,
}: SwarmFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<SwarmParticle[]>([])
  const linksRef = useRef<SwarmLink[]>([])
  const zoomRef = useRef(zoomProgress)
  const cullRef = useRef(cullNonHero)
  const onHeroCenterRef = useRef(onHeroCenter)

  useEffect(() => {
    zoomRef.current = zoomProgress
  }, [zoomProgress])

  useEffect(() => {
    cullRef.current = cullNonHero
  }, [cullNonHero])

  useEffect(() => {
    onHeroCenterRef.current = onHeroCenter
  }, [onHeroCenter])

  useEffect(() => {
    if (!active || !hostRef.current) return

    let cancelled = false
    let removeResize: (() => void) | undefined
    let app: Application | null = null
    const host = hostRef.current

    const boot = async () => {
      const instance = new Application()
      await instance.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      })

      if (cancelled) {
        instance.destroy(true, { children: true })
        return
      }

      app = instance
      host.appendChild(instance.canvas)

      const root = new Container()
      instance.stage.addChild(root)

      const linksGfx = new Graphics()
      const dotsGfx = new Graphics()
      const vignette = new Graphics()
      root.addChild(linksGfx)
      root.addChild(dotsGfx)
      root.addChild(vignette)

      const w = instance.screen.width
      const h = instance.screen.height
      particlesRef.current = createSwarmParticles(w, h)
      linksRef.current = []

      onHeroCenterRef.current?.(getHeroScreenCenter(w, h))

      const drawVignette = () => {
        const vw = instance.screen.width
        const vh = instance.screen.height
        vignette.clear()
        for (let i = 0; i < 6; i++) {
          const inset = i * Math.min(vw, vh) * 0.06
          const alpha = 0.04 + i * 0.035
          vignette.rect(0, 0, vw, vh)
          vignette.stroke({ width: inset + 40, color: 0x070b12, alpha })
        }
      }
      drawVignette()

      let last = performance.now()
      instance.ticker.add(() => {
        const now = performance.now()
        const dt = Math.min(now - last, 50)
        last = now
        const particles = particlesRef.current
        const zp = zoomRef.current
        const cull = cullRef.current

        for (const p of particles) {
          if (cull && !p.isHero) continue
          const speedScale = 1 - zp * 0.85
          stepParticle(
            p,
            dt * speedScale,
            instance.screen.width,
            instance.screen.height,
            now,
          )
        }

        linksRef.current = cull
          ? []
          : updateLinks(particles, linksRef.current, dt)

        linksGfx.clear()
        for (const link of linksRef.current) {
          const a = particles[link.a]
          const b = particles[link.b]
          if (!a || !b) continue
          if (cull && (!a.isHero || !b.isHero)) continue
          const alpha = (link.life / link.maxLife) * 0.25 * (1 - zp)
          linksGfx.moveTo(a.x, a.y)
          linksGfx.lineTo(b.x, b.y)
          linksGfx.stroke({ width: 1, color: 0x2dd4bf, alpha })
        }

        dotsGfx.clear()
        for (const p of particles) {
          if (cull && !p.isHero) continue

          let alpha = pulseBrightness(p, now)
          if (!p.isHero) {
            alpha *= Math.max(0, 1 - zp * 1.4)
            alpha *= 1 - zp * 0.5
          } else {
            alpha = Math.min(1, alpha + zp * 0.3)
          }

          if (alpha < 0.02) continue

          const radius = p.isHero ? 4.2 + zp * 6 : 2 + (alpha > 0.38 ? 0.5 : 0)
          const color = Number.parseInt(p.domainColor.replace('#', ''), 16)

          dotsGfx.circle(p.x, p.y, radius * (p.isHero ? 2.6 : 2.0))
          dotsGfx.fill({ color, alpha: alpha * (p.isHero ? 0.35 : 0.2) })
          dotsGfx.circle(p.x, p.y, radius)
          dotsGfx.fill({ color, alpha })
        }
      })

      const onResize = () => {
        drawVignette()
        onHeroCenterRef.current?.(
          getHeroScreenCenter(instance.screen.width, instance.screen.height),
        )
      }
      window.addEventListener('resize', onResize)
      removeResize = () => window.removeEventListener('resize', onResize)
    }

    void boot()

    return () => {
      cancelled = true
      removeResize?.()
      if (app) {
        const canvas = app.canvas
        try {
          app.destroy(true, { children: true })
        } catch {
          /* already destroyed */
        }
        if (canvas?.parentNode === host) {
          host.removeChild(canvas)
        }
      }
    }
  }, [active])

  if (!active) return null

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-0"
      style={{
      background: `radial-gradient(ellipse at 50% 48%, #0f1a28 0%, ${colors.bgDeep} 70%)`,
        ...transformStyle,
        willChange: 'transform, filter, opacity',
      }}
    />
  )
}

/** Expose current hero particle screen positions for morph overlay */
export function getHeroParticlePositions(
  width: number,
  height: number,
): { id: string; x: number; y: number }[] {
  const particles = createSwarmParticles(width, height)
  return particles
    .filter((p) => p.isHero && p.heroAgentId)
    .map((p) => ({ id: p.heroAgentId!, x: p.x, y: p.y }))
}
