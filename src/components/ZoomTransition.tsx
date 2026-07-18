import { motion } from 'framer-motion'
import { CLUSTER_LAYOUT } from '../data/initialAgents'
import { colors, fonts } from '../styles/tokens'

const HERO_ORDER = ['aurora', 'vega', 'sentinel', 'atlas', 'nova'] as const

const LABELS: Record<string, string> = {
  aurora: 'AURORA',
  vega: 'VEGA',
  sentinel: 'SENTINEL',
  atlas: 'ATLAS',
  nova: 'NOVA',
}

interface ZoomTransitionProps {
  progress: number // 0–1
  heroOrigins: { id: string; x: number; y: number }[]
  useFallback: boolean
  graphOffset: { x: number; y: number }
}

/**
 * Morph overlay: glowing dots fly from swarm hero positions to cluster card positions.
 * When useFallback is true, this layer is skipped (cards stagger in via AgentGraph).
 */
export function ZoomTransition({
  progress,
  heroOrigins,
  useFallback,
  graphOffset,
}: ZoomTransitionProps) {
  if (useFallback || progress <= 0 || progress >= 1) return null

  // Ease
  const t = easeInOutCubic(progress)
  // Cross-fade: dots fade out in second half as cards fade in
  const dotOpacity = progress < 0.55 ? 1 : Math.max(0, 1 - (progress - 0.55) / 0.35)

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {HERO_ORDER.map((id) => {
        const origin = heroOrigins.find((h) => h.id === id) ?? {
          id,
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }
        const layout = CLUSTER_LAYOUT[id]
        // Target center of agent card (~200x110)
        const targetX = graphOffset.x + layout.x + 100
        const targetY = graphOffset.y + layout.y + 55

        const x = origin.x + (targetX - origin.x) * t
        const y = origin.y + (targetY - origin.y) * t
        const scale = 1 + t * 8

        return (
          <motion.div
            key={id}
            className="absolute"
            style={{
              left: x,
              top: y,
              opacity: dotOpacity,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }}
          >
            <div
              className="rounded-full"
              style={{
                width: 8,
                height: 8,
                background: colors.cyan,
                boxShadow: `0 0 ${12 + t * 40}px ${colors.cyan}, 0 0 ${4 + t * 20}px ${colors.blue}`,
              }}
            />
            {progress > 0.35 && (
              <div
                className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold tracking-[0.2em]"
                style={{
                  fontFamily: fonts.display,
                  color: colors.textPrimary,
                  opacity: Math.min(1, (progress - 0.35) / 0.3) * dotOpacity,
                }}
              >
                {LABELS[id]}
              </div>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Compute CSS transform for swarm canvas during zoom */
export function swarmZoomTransform(
  progress: number,
  heroCenter: { x: number; y: number },
  viewport: { w: number; h: number },
): React.CSSProperties {
  const t = easeInOutCubic(Math.min(1, progress))
  const scale = 1 + t * 2.8
  const tx = (viewport.w / 2 - heroCenter.x) * t * scale
  const ty = (viewport.h / 2 - heroCenter.y) * t * scale
  const blur = t * 8
  const opacity = Math.max(0, 1 - t * 1.15)

  return {
    transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
    transformOrigin: `${heroCenter.x}px ${heroCenter.y}px`,
    filter: `blur(${blur}px) saturate(${1 - t * 0.7})`,
    opacity,
  }
}
