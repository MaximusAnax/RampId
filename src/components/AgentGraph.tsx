import { useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { motion } from 'framer-motion'
import { useSimStore } from '../store/useSimStore'
import { AgentNode, type AgentNodeData } from './AgentNode'
import { RelationshipEdge, type RelationshipEdgeData } from './RelationshipEdge'

const nodeTypes = { agent: AgentNode }
const edgeTypes = { relationship: RelationshipEdge }

interface AgentGraphProps {
  visible: boolean
  staggerIn: boolean
  /** When true, fill parent flex pane (graph area excludes activity rail) */
  fillParent?: boolean
}

/** Refits the viewport when the parent pane resizes (rail collapse/expand). */
function FitViewOnPaneResize() {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const onResize = () => {
      requestAnimationFrame(() => {
        fitView({ padding: 0.25, duration: 280 })
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitView])

  return null
}

function AgentGraphInner({ visible, staggerIn }: AgentGraphProps) {
  const agents = useSimStore((s) => s.agents)
  const relationships = useSimStore((s) => s.relationships)

  const initialNodes: Node<AgentNodeData>[] = useMemo(
    () =>
      Object.values(agents).map((agent) => ({
        id: agent.id,
        type: 'agent',
        position: agent.position,
        data: { agent },
        draggable: true,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: { agent: agents[n.id] },
        position: agents[n.id]?.position ?? n.position,
      })),
    )
  }, [agents, setNodes])

  useEffect(() => {
    const next: Edge<RelationshipEdgeData>[] = relationships
      .filter((r) => r.status !== 'severed')
      .map((r) => ({
        id: r.id,
        source: r.sourceAgentId,
        target: r.targetAgentId,
        type: 'relationship',
        animated: r.status === 'active' && r.type !== 'blocks',
        data: {
          relType: r.type,
          status: r.status,
          showX: r.showX,
        },
      }))
    setEdges(next)
  }, [relationships, setEdges])

  if (!visible) return null

  return (
    <motion.div
      className="absolute inset-0 z-20"
      initial={staggerIn ? { opacity: 0 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <ReactFlow
        nodes={nodes.map((n, i) => ({
          ...n,
          style: staggerIn
            ? {
                opacity: 1,
                transition: `opacity 0.35s ease ${i * 0.08}s, transform 0.35s ease ${i * 0.08}s`,
              }
            : undefined,
        }))}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background color="#1e293b" gap={28} size={1} />
        <FitViewOnPaneResize />
      </ReactFlow>
    </motion.div>
  )
}

export function AgentGraph(props: AgentGraphProps) {
  return (
    <ReactFlowProvider>
      <AgentGraphInner {...props} />
    </ReactFlowProvider>
  )
}
