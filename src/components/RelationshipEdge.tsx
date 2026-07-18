import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow'
import { relationshipColors, colors } from '../styles/tokens'
import type { RelationshipType } from '../engine/types'

export type RelationshipEdgeData = {
  relType: RelationshipType
  status: string
  showX?: boolean
  label?: string
}

function RelationshipEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps<RelationshipEdgeData>) {
  const relType = data?.relType ?? 'coordinates_with'
  const status = data?.status ?? 'active'
  const showX = data?.showX
  const isBlocked = status === 'blocked' || relType === 'blocks'
  const isSevered = status === 'severed'
  const isDepends = relType === 'depends_on'
  const isCoords = relType === 'coordinates_with'
  const isProvides = relType === 'provides_data_to'

  const color = isBlocked
    ? relationshipColors.blocks
    : isSevered
      ? colors.slate
      : relationshipColors[relType] ?? colors.slate

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  if (isSevered) {
    return null
  }

  let dash: string | undefined
  if (isDepends && !isBlocked) dash = '6 4'
  if (isCoords && !isBlocked) dash = '2 4'

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth: isBlocked ? 2.5 : isProvides ? 1.25 : 1.5,
          strokeDasharray: dash,
          opacity: 0.9,
          filter: isBlocked ? `drop-shadow(0 0 4px ${colors.red})` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          {showX && isBlocked && (
            <div
              className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold"
              style={{
                background: colors.red,
                color: '#fff',
                boxShadow: `0 0 12px ${colors.red}cc`,
              }}
            >
              ✕
            </div>
          )}
          {!showX && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] tracking-wide uppercase"
              style={{
                background: 'rgba(10,11,15,0.9)',
                color,
                border: `1px solid ${color}44`,
              }}
            >
              {relType.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const RelationshipEdge = memo(RelationshipEdgeComponent)
