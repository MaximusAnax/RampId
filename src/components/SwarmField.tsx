import { useEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import {
  createBackgroundParticles,
  createSwarmParticles,
  getHeroScreenCenter,
} from '../data/swarmConfig'
import {
  pulseBrightness,
  stepParticle,
  updateLinks,
  type SwarmLink,
} from '../engine/swarmEngine'
import type { SwarmParticle } from '../engine/types'
import { colors } from '../styles/tokens'

export type SwarmFieldMode = 'foreground' | 'background'

interface SwarmFieldProps {
  active: boolean
  mode?: SwarmFieldMode
  /** Pause ticker without unmounting (background mode when modals open) */
  paused?: boolean
  /** 0–1 during zoom; fades periphery (foreground only) */
  zoomProgress?: number
  /** CSS transform applied to canvas wrapper during zoom */
  transformStyle?: React.CSSProperties
  onHeroCenter?: (center: { x: number; y: number }) => void
  cullNonHero?: boolean
  /** Extra CSS opacity multiplier (e.g. fade-in during transition overlap) */
  opacity?: number
}

const BG_MAX_ALPHA = 0.16
const BG_BLUR_PX = 8

export function SwarmField({
  active,
  mode = 'foreground',
  paused = false,
  zoomProgress = 0,
  transformStyle,
  onHeroCenter,
  cullNonHero = false,
  opacity = 1,
}: SwarmFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<SwarmParticle[]>([])
  const linksRef = useRef<SwarmLink[]>([])
  const zoomRef = useRef(zoomProgress)
  const cullRef = useRef(cullNonHero)
  const pausedRef = useRef(paused)
  const modeRef = useRef(mode)
  const onHeroCenterRef = useRef(onHeroCenter)

  useEffect(() => {
    zoomRef.current = zoomProgress
  }, [zoomProgress])

  useEffect(() => {
    cullRef.current = cullNonHero
  }, [cullNonHero])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    onHeroCenterRef.current = onHeroCenter
  }, [onHeroCenter])

  useEffect(() => {
    if (!active || !hostRef.current) return

    let cancelled = false
    let removeResize: (() => void) | undefined
    let app: Application | null = null
    const host = hostRef.current
    const isBackground = mode === 'background'

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
      particlesRef.current = isBackground
        ? createBackgroundParticles(w, h)
        : createSwarmParticles(w, h)
      linksRef.current = []

      if (!isBackground) {
        onHeroCenterRef.current?.(getHeroScreenCenter(w, h))
      }

      const drawVignette = () => {
        if (isBackground) {
          vignette.clear()
          return
        }
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
        if (pausedRef.current) {
          last = performance.now()
          return
        }

        const now = performance.now()
        const dt = Math.min(now - last, 50)
        last = now
        const particles = particlesRef.current
        const zp = zoomRef.current
        const cull = cullRef.current
        const bg = modeRef.current === 'background'

        for (const p of particles) {
          if (!bg && cull && !p.isHero) continue
          const speedScale = bg ? 0.45 : 1 - zp * 0.85
          stepParticle(
            p,
            dt * speedScale,
            instance.screen.width,
            instance.screen.height,
            now,
          )
        }

        if (bg) {
          linksRef.current = []
          linksGfx.clear()
        } else {
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
        }

        dotsGfx.clear()
        for (const p of particles) {
          if (!bg && cull && !p.isHero) continue

          let alpha: number
          if (bg) {
            // Soft ambient only — no pulse-brightening events
            alpha = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.001 + p.pulsePhase))
            alpha = Math.min(BG_MAX_ALPHA, alpha)
          } else {
            alpha = pulseBrightness(p, now)
            if (!p.isHero) {
              alpha *= Math.max(0, 1 - zp * 1.4)
              alpha *= 1 - zp * 0.5
            } else {
              alpha = Math.min(1, alpha + zp * 0.3)
            }
          }

          if (alpha < 0.02) continue

          const radius = bg
            ? 2.5
            : p.isHero
              ? 3.5 + zp * 6
              : 2 + (alpha > 0.7 ? 1 : 0)
          const color = Number.parseInt(p.domainColor.replace('#', ''), 16)

          dotsGfx.circle(p.x, p.y, radius * (bg ? 3 : 2.2))
          dotsGfx.fill({ color, alpha: alpha * (bg ? 0.4 : 0.25) })
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
        if (!isBackground) {
          onHeroCenterRef.current?.(
            getHeroScreenCenter(instance.screen.width, instance.screen.height),
          )
        }
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
  }, [active, mode])

  if (!active) return null

  const isBackground = mode === 'background'

  return (
    <div
      ref={hostRef}
      className={`absolute inset-0 ${isBackground ? 'pointer-events-none z-0' : 'z-0'}`}
      style={{
        background: isBackground
          ? 'transparent'
          : `radial-gradient(ellipse at 50% 48%, #0f1a28 0%, ${colors.bgDeep} 70%)`,
      background: `radial-gradient(ellipse at 50% 48%, #0f1a28 0%, ${colors.bgDeep} 70%)`,
        ...transformStyle,
        opacity: isBackground ? opacity : transformStyle?.opacity ?? opacity,
        filter: isBackground
          ? `blur(${BG_BLUR_PX}px)`
          : transformStyle?.filter,
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
