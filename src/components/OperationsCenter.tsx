import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StatusBar } from './StatusBar'
import { SwarmField, getHeroParticlePositions } from './SwarmField'
import { ZoomTransition, swarmZoomTransform } from './ZoomTransition'
import { AgentGraph } from './AgentGraph'
import { ActivityFeed } from './ActivityFeed'
import { OpportunityCard } from './OpportunityCard'
import { getScenarioPhase, useSimStore } from '../store/useSimStore'
import { AgentDetailPanel } from './AgentDetailPanel'
import { WhatIfPanel } from './WhatIfPanel'
import { CreateAgentModal } from './CreateAgentModal'
import { TimelineScrubber } from './TimelineScrubber'
import { useSimStore } from '../store/useSimStore'
import { getHeroScreenCenter } from '../data/swarmConfig'
import { morphFallback, zoomDurationMs, fonts, colors } from '../styles/tokens'
import { startAmbientFeed } from '../engine/eventEngine'

export function OperationsCenter() {
  const viewMode = useSimStore((s) => s.viewMode)
  const transitionProgress = useSimStore((s) => s.transitionProgress)
  const transitionDirection = useSimStore((s) => s.transitionDirection)
  const useMorphFallback = useSimStore((s) => s.useMorphFallback)
  const pulledBack = useSimStore((s) => s.pulledBack)
  const swarmPaused = useSimStore((s) => s.swarmPaused)
  const scenarioStarted = useSimStore((s) => s.scenarioStarted)
  const opportunity = useSimStore((s) => s.opportunity)
  const startZoom = useSimStore((s) => s.startZoom)
  const completeZoom = useSimStore((s) => s.completeZoom)
  const startPullBack = useSimStore((s) => s.startPullBack)
  const completePullBack = useSimStore((s) => s.completePullBack)
  const lerpMetricsToCluster = useSimStore((s) => s.lerpMetricsToCluster)
  const setTransitionProgress = useSimStore((s) => s.setTransitionProgress)
  const setUseMorphFallback = useSimStore((s) => s.setUseMorphFallback)
  const demoEpoch = useSimStore((s) => s.demoEpoch)
  const selectedAgentId = useSimStore((s) => s.selectedAgentId)

  const [heroCenter, setHeroCenter] = useState({ x: 0, y: 0 })
  const [heroOrigins, setHeroOrigins] = useState<
    { id: string; x: number; y: number }[]
  >([])
  const [viewport, setViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  })
  const [cullNonHero, setCullNonHero] = useState(false)
  const [showCluster, setShowCluster] = useState(false)
  const [clusterStagger, setClusterStagger] = useState(false)
  const [feedExpanded, setFeedExpanded] = useState(true)
  const rafRef = useRef<number>(0)
  const hasEnteredClusterRef = useRef(false)

  useEffect(() => {
    setUseMorphFallback(morphFallback)
  }, [setUseMorphFallback])

  // Full remount of local UI state when Reset Demo bumps demoEpoch
  useEffect(() => {
    setCullNonHero(false)
    setShowCluster(false)
    setClusterStagger(false)
    setFeedExpanded(true)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setHeroCenter(getHeroScreenCenter(window.innerWidth, window.innerHeight))
    setHeroOrigins(getHeroParticlePositions(window.innerWidth, window.innerHeight))
  }, [demoEpoch])

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

  // Ambient feed once in cluster; reset feed expanded only on first cluster entry
  useEffect(() => {
    if (viewMode !== 'cluster') return
    if (!hasEnteredClusterRef.current) {
      hasEnteredClusterRef.current = true
      setFeedExpanded(true)
    }
    return startAmbientFeed()
  }, [viewMode, demoEpoch])

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
  }, [viewMode, demoEpoch])

  useEffect(() => {
    if (viewMode !== 'cluster') return
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 300)
    return () => window.clearTimeout(t)
  }, [feedExpanded, viewMode, selectedAgentId])

  const runZoom = useCallback(() => {
    if (viewMode !== 'swarm') return

    const origins = getHeroParticlePositions(viewport.w, viewport.h)
    setHeroOrigins(origins)
    setHeroCenter(getHeroScreenCenter(viewport.w, viewport.h))
    startZoom()
    setCullNonHero(false)
    setShowCluster(false)

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

  const runPullBack = useCallback(() => {
    if (viewMode !== 'cluster') return
    const phase = getScenarioPhase({ scenarioStarted, opportunity })
    if (phase === 'playing') return

    const origins = getHeroParticlePositions(viewport.w, viewport.h)
    setHeroOrigins(origins)
    setHeroCenter(getHeroScreenCenter(viewport.w, viewport.h))
    startPullBack()
    setCullNonHero(true)
    setShowCluster(true)

    const start = performance.now()
    const duration = zoomDurationMs
    const fallback = morphFallback

    const tick = (now: number) => {
      const elapsed = now - start
      // progress goes 1 → 0 for reverse
      const p = Math.max(0, 1 - elapsed / duration)
      setTransitionProgress(p)
      lerpMetricsToCluster(p)

      if (p <= 0.55) {
        setCullNonHero(false)
      }
      if (p <= 0.45) {
        setShowCluster(false)
        setClusterStagger(fallback)
      }

      if (p > 0) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        completePullBack()
        setShowCluster(false)
        setCullNonHero(false)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [
    viewMode,
    viewport,
    scenarioStarted,
    opportunity,
    startPullBack,
    completePullBack,
    lerpMetricsToCluster,
    setTransitionProgress,
  ])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const swarmActive =
    viewMode === 'swarm' ||
    (viewMode === 'transitioning' &&
      (transitionDirection === 'in' || transitionDirection === 'out'))

  const swarmTransform =
    viewMode === 'transitioning'
      ? swarmZoomTransform(
          transitionProgress,
          heroCenter,
          viewport,
          transitionDirection,
        )
      : undefined

  // Background ambient swarm in cluster; fade in during late inbound zoom / early outbound
  const showBackgroundSwarm =
    viewMode === 'cluster' ||
    (viewMode === 'transitioning' &&
      transitionDirection === 'in' &&
      transitionProgress >= 0.55) ||
    (viewMode === 'transitioning' && transitionDirection === 'out')

  const backgroundOpacity = (() => {
    if (viewMode === 'cluster') return 1
    if (viewMode === 'transitioning' && transitionDirection === 'in') {
      return Math.min(1, (transitionProgress - 0.55) / 0.35)
    }
    if (viewMode === 'transitioning' && transitionDirection === 'out') {
      // Brighten toward foreground levels as we pull out — fade background as foreground takes over
      return Math.min(1, transitionProgress / 0.45)
    }
    return 0
  })()

  const graphOffset = {
    x: Math.max(40, (viewport.w - 900) / 2),
    y: Math.max(80, (viewport.h - 600) / 2 + 20),
  }

  const inClusterLayout = viewMode === 'cluster'
  const showGraph =
    showCluster || viewMode === 'cluster' || viewMode === 'transitioning'

  const scenarioPhase = getScenarioPhase({ scenarioStarted, opportunity })
  const canPullBack =
    viewMode === 'cluster' &&
    (scenarioPhase === 'idle' || scenarioPhase === 'resolved')

  const graphOpacity =
    viewMode === 'transitioning' && transitionDirection === 'out'
      ? Math.min(1, transitionProgress / 0.5)
      : viewMode === 'transitioning' && transitionDirection === 'in'
        ? transitionProgress >= 0.5
          ? Math.min(1, (transitionProgress - 0.5) / 0.35)
          : 0
        : 1
  const detailOpen = !!selectedAgentId && inClusterLayout

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{ background: colors.bgDeep }}
    >
      <StatusBar />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Ambient periphery swarm — always under cluster UI */}
        {showBackgroundSwarm && (
          <SwarmField
            mode="background"
            active
            paused={swarmPaused}
            opacity={backgroundOpacity}
          />
        )}

        <AnimatePresence>
          {swarmActive && (
            <motion.div
              key={`swarm-${demoEpoch}`}
              className="absolute inset-0 z-10"
              initial={
                transitionDirection === 'out' ? { opacity: 0 } : false
              }
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <SwarmField
                mode="foreground"
                active={swarmActive}
                zoomProgress={
                  viewMode === 'transitioning' ? transitionProgress : 0
                }
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
            direction={transitionDirection}
          />
        )}

        {viewMode === 'swarm' && (
          <EnterPrompt
            onEnter={runZoom}
            heroCenter={heroCenter}
            returnMode={pulledBack}
          />
        )}

        {showGraph && (
          <div
            className={`relative z-20 flex min-h-0 min-w-0 flex-1 ${
              inClusterLayout ? 'flex-row' : ''
            }`}
            style={{
              pointerEvents: inClusterLayout ? 'auto' : 'none',
              opacity: graphOpacity,
              transition: 'opacity 0.15s linear',
            }}
          >
            <div className="relative min-h-0 min-w-0 flex-1">
              <AgentGraph
                key={`graph-${demoEpoch}`}
                visible
                staggerIn={clusterStagger || useMorphFallback}
                fillParent
              />
              {inClusterLayout && <OpportunityCard />}

              {canPullBack && (
                <button
                  type="button"
                  onClick={runPullBack}
                  className="absolute bottom-5 left-5 z-40 flex items-center gap-1.5 text-[10px] tracking-[0.18em] uppercase opacity-45 transition hover:opacity-90"
                  style={{ fontFamily: fonts.mono, color: colors.textMuted }}
                  aria-label="Pull back to org-wide swarm"
                >
                  <span aria-hidden>◂</span>
                  Pull back
                </button>
              {inClusterLayout && (
                <>
                  <OpportunityCard />
                  <WhatIfPanel />
                  <TimelineScrubber />
                </>
              )}
            </div>

            {inClusterLayout && !detailOpen && (
              <ActivityFeed
                expanded={feedExpanded}
                onToggle={() => setFeedExpanded((v) => !v)}
              />
            )}

            {inClusterLayout && <AgentDetailPanel />}
          </div>
        )}

        {inClusterLayout && <CreateAgentModal />}
      </div>
    </div>
  )
}

function EnterPrompt({
  onEnter,
  heroCenter,
  returnMode,
}: {
  onEnter: () => void
  heroCenter: { x: number; y: number }
  returnMode: boolean
}) {
  const label = returnMode ? '◂ RETURN TO VANTIX AI' : 'ENTER VANTIX AI'
  const aria = returnMode ? 'Return to Vantix AI' : 'Enter Vantix AI'
  const diveLabel = returnMode ? '◂ Return to cluster' : 'Dive into cluster →'

  return (
    <>
      <button
        type="button"
        onClick={onEnter}
        className="absolute z-40 -translate-x-1/2 -translate-y-1/2"
        style={{ left: heroCenter.x, top: heroCenter.y + 56 }}
        aria-label={aria}
      >
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.2, repeat: Infinity }}
          className="rounded-full border px-4 py-2 text-[11px] font-semibold tracking-[0.25em]"
          style={{
            fontFamily: fonts.mono,
            color: colors.cyan,
            borderColor: 'rgba(77, 216, 255, 0.45)',
            background: 'rgba(10, 11, 15, 0.75)',
            boxShadow: '0 0 24px rgba(77, 216, 255, 0.25)',
          }}
        >
          {label}
        </motion.div>
      </button>

      <button
        type="button"
        onClick={onEnter}
        className="absolute bottom-6 right-6 z-40 text-[10px] tracking-[0.2em] uppercase opacity-40 transition hover:opacity-90"
        style={{ fontFamily: fonts.mono, color: colors.textMuted }}
      >
        {diveLabel}
      </button>
    </>
  )
}
