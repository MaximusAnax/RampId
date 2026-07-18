import { useEffect } from 'react'
import { useSimStore, getScenarioPhase } from '../store/useSimStore'
import {
  startSynapseFlowScenario,
  startWhatIfScenario,
  stopScenario,
} from '../engine/eventEngine'
import { WHAT_IF_NOVA_THRESHOLD } from '../styles/tokens'

const OPPORTUNITY_LABEL =
  'SynapseFlow — 40% Lower Cost — $240,000 Potential Annual Savings'

/**
 * Silent presenter controls — never shown on screen.
 * Enter  → zoom into / return to cluster
 * O      → surface SynapseFlow opportunity now
 * D      → deploy agents
 * W      → re-run what-if alternate (when armed/finished)
 * B      → pull back (when allowed)
 * Shift+R → full reset
 */
export function PresenterHotkeys({
  onEnter,
  onPullBack,
}: {
  onEnter: () => void
  onPullBack: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return

      const s = useSimStore.getState()
      const key = e.key.toLowerCase()

      if (key === 'enter' && s.viewMode === 'swarm') {
        e.preventDefault()
        onEnter()
        return
      }

      if (key === 'o' && s.viewMode === 'cluster' && s.opportunity === 'hidden') {
        e.preventDefault()
        s.setOpportunity('ready', OPPORTUNITY_LABEL)
        s.pushFeed({
          id: `feed-sf-hotkey-${Date.now()}`,
          agentId: 'system',
          agentName: 'SYSTEM',
          message: OPPORTUNITY_LABEL,
          timestamp: '10:14:00',
        })
        return
      }

      if (
        key === 'd' &&
        s.viewMode === 'cluster' &&
        s.opportunity === 'ready' &&
        !s.scenarioStarted
      ) {
        e.preventDefault()
        startSynapseFlowScenario()
        return
      }

      if (
        key === 'w' &&
        s.viewMode === 'cluster' &&
        (s.whatIfPhase === 'armed' || s.whatIfPhase === 'finished') &&
        (s.agents.nova?.spendingLimit ?? 0) >= WHAT_IF_NOVA_THRESHOLD
      ) {
        e.preventDefault()
        startWhatIfScenario()
        return
      }

      if (key === 'b' && s.viewMode === 'cluster') {
        const phase = getScenarioPhase(s)
        if (phase === 'idle' || phase === 'resolved') {
          e.preventDefault()
          onPullBack()
        }
        return
      }

      if (key === 'r' && e.shiftKey) {
        e.preventDefault()
        stopScenario()
        s.resetDemo()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEnter, onPullBack])

  return null
}
