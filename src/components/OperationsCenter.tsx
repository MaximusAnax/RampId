import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StatusBar } from './StatusBar'
import { SwarmField, getHeroParticlePositions } from './SwarmField'
import { ZoomTransition, swarmZoomTransform } from './ZoomTransition'
import { AgentGraph } from './AgentGraph'
import { ActivityFeed } from './ActivityFeed'
import { OpportunityCard } from './OpportunityCard'
import { useSimStore } from '../store/useSimStore'
import { getHeroScreenCenter } from '../data/swarmConfig'
import { morphFallback, zoomDurationMs, fonts, colors } from '../styles/tokens'
import { startAmbientFeed } from '../engine/eventEngine'

export function OperationsCenter() {
  const viewMode = useSimStore((s) => s.viewMode)
  const transitionProgress = useSimStore((s) => s.transitionProgress)
  const useMorphFallback = useSimStore((s) => s.useMorphFallback)
  const startZoom = useSimStore((s) => s.startZoom)
  const completeZoom = useSimStore((s) => s.completeZoom)
  const lerpMetricsToCluster = useSimStore((s) => s.lerpMetricsToCluster)
  const setTransitionProgress = useSimStore((s) => s.setTransitionProgress)
  const setUseMorphFallback = useSimStore((s) => s.setUseMorphFallback)

  const [heroCenter, setHeroCenter] = useState({ x: 0, y: 0 })
  const [heroOrigins, setHeroOrigins] = useState<
    { id: string; x: number; y: number }[]
  >([])
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [cullNonHero, setCullNonHero] = useState(false)
  const [showCluster, setShowCluster] = useState(false)
  const [clusterStagger, setClusterStagger] = useState(false)
  const [feedExpanded, setFeedExpanded] = useState(true)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    setUseMorphFallback(morphFallback)
  }, [setUseMorphFallback])

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    setHeroCenter(getHeroScreenCenter(window.innerWidth, window.innerHeight))
    setHeroOrigins(
      getHeroParticlePositions(window.innerWidth, window.innerHeight),
    )
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Ambient feed once in cluster; reset feed expanded on entry
  useEffect(() => {
    if (viewMode !== 'cluster') return
    setFeedExpanded(true)
    return startAmbientFeed()
  }, [viewMode])

  // SynapseFlow opportunity appears ~30s after entering cluster (not on zoom)
  useEffect(() => {
    if (viewMode !== 'cluster') return
    const store = useSimStore.getState()
    if (store.opportunity !== 'hidden' || store.scenarioStarted) return

    const timer = window.setTimeout(() => {
      const s = useSimStore.getState()
      if (s.opportunity !== 'hidden' || s.scenarioStarted) return
      s.setOpportunity(
        'ready',
        'SynapseFlow — 40% Lower Cost — $240,000 Potential Annual Savings',
      )
      s.pushFeed({
        id: 'feed-sf-1',
        agentId: 'system',
        agentName: 'SYSTEM',
        message:
          'SynapseFlow — 40% Lower Cost — $240,000 Potential Annual Savings',
        timestamp: '10:14:00',
      })
    }, 30_000)

    return () => window.clearTimeout(timer)
  }, [viewMode])

  // Notify React Flow to remeasure after rail toggle animation
  useEffect(() => {
    if (viewMode !== 'cluster') return
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 300)
    return () => window.clearTimeout(t)
  }, [feedExpanded, viewMode])

  const runZoom = useCallback(() => {
    if (viewMode !== 'swarm') return

    const origins = getHeroParticlePositions(viewport.w, viewport.h)
    setHeroOrigins(origins)
    setHeroCenter(getHeroScreenCenter(viewport.w, viewport.h))
    startZoom()

    const start = performance.now()
    const duration = zoomDurationMs
    const fallback = morphFallback

    const tick = (now: number) => {
      const elapsed = now - start
      const p = Math.min(1, elapsed / duration)
      setTransitionProgress(p)
      lerpMetricsToCluster(p)

      if (p >= 0.45) setCullNonHero(true)

      if (p >= 0.5) {
        setShowCluster(true)
        setClusterStagger(fallback)
      }

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        completeZoom()
        setShowCluster(true)
        setCullNonHero(true)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [
    viewMode,
    viewport,
    startZoom,
    completeZoom,
    lerpMetricsToCluster,
    setTransitionProgress,
  ])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const swarmActive = viewMode === 'swarm' || viewMode === 'transitioning'
  const swarmTransform =
    viewMode === 'transitioning'
      ? swarmZoomTransform(transitionProgress, heroCenter, viewport)
      : undefined

  const graphOffset = {
    x: Math.max(40, (viewport.w - 900) / 2),
    y: Math.max(80, (viewport.h - 600) / 2 + 20),
  }

  const inClusterLayout = viewMode === 'cluster'
  const showGraph = showCluster || viewMode === 'cluster' || viewMode === 'transitioning'

  return (
    <div className="relative flex h-full w-full flex-col" style={{ background: colors.bgDeep }}>
      <StatusBar />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence>
          {swarmActive && (
            <motion.div
              key="swarm"
              className="absolute inset-0 z-10"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <SwarmField
                active={swarmActive}
                zoomProgress={transitionProgress}
                transformStyle={swarmTransform}
                cullNonHero={cullNonHero}
                onHeroCenter={setHeroCenter}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {viewMode === 'transitioning' && !useMorphFallback && (
          <ZoomTransition
            progress={transitionProgress}
            heroOrigins={heroOrigins}
            useFallback={useMorphFallback}
            graphOffset={graphOffset}
          />
        )}

        {viewMode === 'swarm' && (
          <EnterPrompt onEnter={runZoom} heroCenter={heroCenter} />
        )}

        {/* Cluster: graph pane + activity rail share real layout width */}
        {showGraph && (
          <div
            className={`relative z-20 flex min-h-0 min-w-0 flex-1 ${
              inClusterLayout ? 'flex-row' : ''
            }`}
            style={{
              // During transition, graph is full-bleed under morph; rail only in cluster
              pointerEvents: inClusterLayout ? 'auto' : 'none',
            }}
          >
            <div className="relative min-h-0 min-w-0 flex-1">
              <AgentGraph
                visible
                staggerIn={clusterStagger || useMorphFallback}
                fillParent
              />
              {inClusterLayout && <OpportunityCard />}
            </div>

            {inClusterLayout && (
              <ActivityFeed
                expanded={feedExpanded}
                onToggle={() => setFeedExpanded((v) => !v)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EnterPrompt({
  onEnter,
  heroCenter,
}: {
  onEnter: () => void
  heroCenter: { x: number; y: number }
}) {
  return (
    <>
      <button
        type="button"
        onClick={onEnter}
        className="absolute z-40 -translate-x-1/2 -translate-y-1/2"
        style={{ left: heroCenter.x, top: heroCenter.y + 56 }}
        aria-label="Enter Vantix AI"
      >
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.2, repeat: Infinity }}
          className="rounded-full border px-4 py-2 text-[11px] font-semibold tracking-[0.25em]"
          style={{
            fontFamily: fonts.mono,
            color: colors.cyan,
            borderColor: 'rgba(45, 212, 191, 0.45)',
            background: 'rgba(7, 11, 18, 0.75)',
            boxShadow: '0 0 24px rgba(45, 212, 191, 0.25)',
          }}
        >
          ENTER VANTIX AI
        </motion.div>
      </button>

      <button
        type="button"
        onClick={onEnter}
        className="absolute bottom-6 right-6 z-40 text-[10px] tracking-[0.2em] uppercase opacity-40 transition hover:opacity-90"
        style={{ fontFamily: fonts.mono, color: colors.textMuted }}
      >
        Dive into cluster →
      </button>
    </>
  )
}
