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
  fillParent?: boolean
}

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
  const setSelectedAgentId = useSimStore((s) => s.setSelectedAgentId)
  const { fitView } = useReactFlow()

  const agentList = useMemo(() => Object.values(agents), [agents])

  const initialNodes: Node<AgentNodeData>[] = useMemo(
    () =>
      agentList.map((agent) => ({
        id: agent.id,
        type: 'agent',
        position: agent.position,
        data: { agent, onSelect: setSelectedAgentId },
        draggable: true,
      })),
    // mount only — sync effect handles updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Sync agents into nodes (including newly created agents)
  useEffect(() => {
    setNodes((prev) => {
      const prevIds = new Set(prev.map((n) => n.id))
      const next = prev
        .filter((n) => agents[n.id])
        .map((n) => ({
          ...n,
          data: { agent: agents[n.id], onSelect: setSelectedAgentId },
          position: agents[n.id]?.position ?? n.position,
        }))

      for (const agent of Object.values(agents)) {
        if (!prevIds.has(agent.id)) {
          next.push({
            id: agent.id,
            type: 'agent',
            position: agent.position,
            data: { agent, onSelect: setSelectedAgentId },
            draggable: true,
            style: { opacity: 0, transform: 'scale(0.85)' },
          })
        }
      }
      return next
    })

    // Fade in new nodes
    requestAnimationFrame(() => {
      setNodes((prev) =>
        prev.map((n) =>
          n.style?.opacity === 0
            ? {
                ...n,
                style: {
                  opacity: 1,
                  transform: 'scale(1)',
                  transition: 'opacity 0.35s ease, transform 0.35s ease',
                },
              }
            : n,
        ),
      )
      fitView({ padding: 0.25, duration: 280 })
    })
  }, [agents, setNodes, setSelectedAgentId, fitView])

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
          style: {
            ...n.style,
            ...(staggerIn
              ? {
                  transition: `opacity 0.35s ease ${i * 0.08}s, transform 0.35s ease ${i * 0.08}s`,
                }
              : {}),
          },
        }))}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => setSelectedAgentId(node.id)}
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
