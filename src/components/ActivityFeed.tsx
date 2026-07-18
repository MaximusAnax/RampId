import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { fonts } from '../styles/tokens'

export const FEED_RAIL_WIDTH = 320
const ANIM_MS = 0.28

function TypingLine({
  id,
  agentName,
  message,
  timestamp,
  onDone,
  emphasis,
}: {
  id: string
  agentName: string
  message: string
  timestamp: string
  onDone: () => void
  emphasis?: 'block' | 'trust' | null
}) {
  const [shown, setShown] = useState('')

  useEffect(() => {
    let i = 0
    const speed = emphasis === 'block' ? 10 : 16
    const interval = setInterval(() => {
      i++
      setShown(message.slice(0, i))
      if (i >= message.length) {
        clearInterval(interval)
        onDone()
      }
    }, speed)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const nameColor =
    emphasis === 'block'
      ? 'var(--accent-red)'
      : emphasis === 'trust'
        ? 'var(--accent-amber)'
        : 'var(--accent-cyan)'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="shrink-0 text-[11px] font-semibold tracking-wider"
          style={{ color: nameColor, fontFamily: fonts.mono }}
        >
          {agentName}
        </span>
        <span
          className="shrink-0 text-[10px] tabular-nums"
          style={{ color: 'var(--text-muted)', fontFamily: fonts.mono, opacity: 0.7 }}
        >
          {timestamp}
        </span>
      </div>
      <span
        className="text-[12px] leading-relaxed"
        style={{
          color: emphasis === 'block' ? '#ffb4bb' : 'var(--text-primary)',
          fontWeight: emphasis === 'block' ? 600 : 400,
        }}
      >
        {shown}
        <span className="animate-pulse opacity-60">▌</span>
      </span>
    </div>
  )
}

function feedEmphasis(message: string): 'block' | 'trust' | null {
  const m = message.toUpperCase()
  if (m.includes('BLOCKED')) return 'block'
  if (m.includes('TRUST UPDATE')) return 'trust'
  return null
}

interface ActivityFeedProps {
  expanded: boolean
  onToggle: () => void
}

export function ActivityFeed({ expanded, onToggle }: ActivityFeedProps) {
  const feed = useSimStore((s) => s.feed)
  const markFeedTyped = useSimStore((s) => s.markFeedTyped)

  return (
    <div className="relative z-30 flex h-full shrink-0">
      {/* Slim edge tab when collapsed */}
      <AnimatePresence>
        {!expanded && (
          <motion.button
            type="button"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: ANIM_MS }}
            onClick={onToggle}
            className="absolute right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-md border border-r-0 px-1.5 py-6"
            style={{
              background: 'rgba(13, 21, 32, 0.95)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-muted)',
              fontFamily: fonts.mono,
            }}
            aria-label="Expand activity feed"
            title="Show activity feed"
          >
            <span className="block text-[10px] tracking-wider" style={{ writingMode: 'vertical-rl' }}>
              FEED
            </span>
            <span className="mt-2 block text-xs">‹</span>
          </motion.button>
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{
          width: expanded ? FEED_RAIL_WIDTH : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={{ duration: ANIM_MS, ease: [0.4, 0, 0.2, 1] }}
        className="flex h-full flex-col overflow-hidden border-l"
        style={{
          background: 'rgba(13, 21, 32, 0.98)',
          borderColor: 'var(--border-subtle)',
        }}
        aria-hidden={!expanded}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-3 py-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <span
            className="text-[10px] font-medium tracking-[0.2em] uppercase"
            style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
          >
            Activity Feed
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="flex h-7 w-7 items-center justify-center rounded text-sm transition hover:bg-white/5"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Collapse activity feed"
            title="Collapse feed"
          >
            ›
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto">
          <AnimatePresence initial={false}>
            {feed.map((item) => {
              const emphasis = feedEmphasis(item.message)
              return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="border-b px-3 py-2.5"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background:
                    emphasis === 'block'
                      ? 'rgba(255,77,94,0.08)'
                      : emphasis === 'trust'
                        ? 'rgba(255,184,77,0.06)'
                        : undefined,
                }}
              >
                {!item.typed ? (
                  <TypingLine
                    id={item.id}
                    agentName={item.agentName}
                    message={item.message}
                    timestamp={item.timestamp}
                    onDone={() => markFeedTyped(item.id)}
                    emphasis={emphasis}
                  />
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="shrink-0 text-[11px] font-semibold tracking-wider"
                        style={{
                          color:
                            emphasis === 'block'
                              ? 'var(--accent-red)'
                              : emphasis === 'trust'
                                ? 'var(--accent-amber)'
                                : 'var(--accent-cyan)',
                          fontFamily: fonts.mono,
                        }}
                      >
                        {item.agentName}
                      </span>
                      <span
                        className="shrink-0 text-[10px] tabular-nums"
                        style={{
                          color: 'var(--text-muted)',
                          fontFamily: fonts.mono,
                          opacity: 0.7,
                        }}
                      >
                        {item.timestamp}
                      </span>
                    </div>
                    <span
                      className="text-[12px] leading-relaxed"
                      style={{
                        color: emphasis === 'block' ? '#ffb4bb' : 'var(--text-primary)',
                        fontWeight: emphasis === 'block' ? 600 : 400,
                      }}
                    >
                      {item.message}
                    </span>
                  </div>
                )}
              </motion.div>
              )
            })}
          </AnimatePresence>
          {feed.length === 0 && (
            <p className="px-3 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              Awaiting agent activity…
            </p>
          )}
        </div>
      </motion.aside>
    </div>
  )
}
