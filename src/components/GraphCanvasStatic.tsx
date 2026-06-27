import React, { useRef, useEffect } from 'react'
import * as d3 from 'd3'
import { useGraphStore } from '../store/useGraphStore'
import type { FunctionNode, CallEdge } from '../types/graph'

// ─── Types ──────────────────────────────────────────────────────────

interface SimNode extends FunctionNode {
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
  vx?: number
  vy?: number
}

interface SimLink {
  source: string | SimNode
  target: string | SimNode
  callCount: number
  callSites: Array<{ file: string; line: number }>
}

// ─── Constants ──────────────────────────────────────────────────────

const MODULE_COLORS = [
  '#e94560', '#0f3460', '#16213e', '#533483', '#e67e22',
  '#2ecc71', '#3498db', '#f39c12', '#1abc9c', '#9b59b6',
  '#34495e', '#d35400',
]

const NODE_MIN_RADIUS = 6
const NODE_MAX_RADIUS = 30
const EDGE_MIN_WIDTH = 0.5
const EDGE_MAX_WIDTH = 8
const LABEL_FONT_SIZE = 10
const HIGHLIGHT_DURATION = 300

// ─── Scale cache (stable across re-renders) ────────────────────────

let colorScale = d3.scaleOrdinal<string, string>(MODULE_COLORS)
let radiusScale = d3.scaleSqrt().range([NODE_MIN_RADIUS, NODE_MAX_RADIUS])
let edgeWidthScale = d3.scaleSqrt().range([EDGE_MIN_WIDTH, EDGE_MAX_WIDTH])

function updateScales(nodes: FunctionNode[], edges: CallEdge[]) {
  const modules = [...new Set(nodes.map(n => n.module))]
  colorScale.domain(modules)

  const maxFan = Math.max(...nodes.map(n => n.fanIn + n.fanOut), 1)
  radiusScale.domain([0, maxFan])

  const maxCall = Math.max(...edges.map(e => e.callCount), 1)
  edgeWidthScale.domain([0, maxCall])
}

// ─── Component ──────────────────────────────────────────────────────

interface GraphCanvasStaticProps {
  width: number
  height: number
  onNodeClick?: (node: FunctionNode) => void
}

const GraphCanvasStatic: React.FC<GraphCanvasStaticProps> = ({ width, height, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const initializedRef = useRef(false)

  // D3 refs - stable across renders
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const prevNodePositionsRef = useRef<Map<string, { x?: number; y?: number; vx?: number; vy?: number }>>(new Map())
  const stableOnClickRef = useRef<((node: FunctionNode) => void) | undefined>(undefined)
  stableOnClickRef.current = onNodeClick

  // Store subscriptions
  const nodes = useGraphStore(s => s.nodes)
  const edges = useGraphStore(s => s.edges)
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const highlightedNodeIds = useGraphStore(s => s.highlightedNodeIds)
  const analysisStatus = useGraphStore(s => s.analysisStatus)

  // ── Effect 1: Initialize SVG, zoom, groups (runs ONCE) ──────────
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (initializedRef.current) return
    initializedRef.current = true

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current!)
    svg.selectAll('*').remove()

    // Arrow marker
    const defs = svg.append('defs')
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#888')

    // Graphics container
    const g = svg.append('g').attr('class', 'graph-root')
    gRef.current = g

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)
    zoomRef.current = zoom

    // Center initial view
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8))

    // Cleanup
    return () => {
      svg.on('.zoom', null)
      initializedRef.current = false
    }
  }, [analysisStatus, width, height])

  // ── Effect 2: Update data (incremental, runs when nodes/edges change) ──
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (!gRef.current) return

    const g = gRef.current

    // Update scales
    updateScales(nodes, edges)

    // Build sim data, preserving previous positions
    const prevPositions = prevNodePositionsRef.current
    const totalNodes = nodes.length
    const simNodes: SimNode[] = nodes.map((n, i) => {
      const old = prevPositions.get(n.id)
      if (old?.x !== undefined && old?.y !== undefined) {
        // Preserve existing position from previous layout
        return {
          ...n,
          x: old.x,
          y: old.y,
          vx: old.vx ?? 0,
          vy: old.vy ?? 0,
        }
      }
      // Position on a circle around the center (no force simulation)
      const angle = (i / Math.max(totalNodes, 1)) * 2 * Math.PI
      const radius = Math.min(width, height) * 0.35
      return {
        ...n,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      }
    })
    const nodeMap = new Map<string, SimNode>()
    for (const n of simNodes) nodeMap.set(n.id, n)

    const simLinks: SimLink[] = edges.map(e => ({
      source: e.source,
      target: e.target,
      callCount: e.callCount,
      callSites: e.callSites,
    }))

    // ── Links: D3 join with key function ──
    const linkGroup = g.selectAll<SVGGElement, unknown>('.link-group').data([null])
    const linkContainer = linkGroup.join('g').attr('class', 'link-group')

    const link = linkContainer
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, d => `${(d.source as SimNode).id}:${(d.target as SimNode).id}`)

    link.exit()
      .transition().duration(200).attr('stroke-opacity', 0)
      .remove()

    const linkEnter = link.join('line')
      .attr('stroke', '#555')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => edgeWidthScale(d.callCount))
      .attr('marker-end', 'url(#arrow)')

    // ── Nodes: D3 join with key function ──
    const nodeGroup = g.selectAll<SVGGElement, unknown>('.node-group').data([null])
    const nodeContainer = nodeGroup.join('g').attr('class', 'node-group')

    const node = nodeContainer
      .selectAll<SVGGElement, SimNode>('.node')
      .data(simNodes, d => d.id)

    // Exit: remove old nodes
    node.exit()
      .transition().duration(200).attr('opacity', 0)
      .remove()

    // Enter: create new nodes
    const nodeEnter = node.enter()
      .append('g')
      .attr('class', 'node')
      .attr('cursor', 'pointer')
      .attr('opacity', 0)

    nodeEnter.append('circle')
      .attr('r', d => radiusScale(d.fanIn + d.fanOut))
      .attr('fill', d => colorScale(d.module))
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)

    nodeEnter.append('text')
      .attr('dx', d => radiusScale(d.fanIn + d.fanOut) + 4)
      .attr('dy', 4)
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('fill', '#ccc')
      .attr('pointer-events', 'none')
      .style('text-shadow', '1px 1px 2px rgba(0,0,0,0.8)')

    nodeEnter.append('title')

    // Merge: update all nodes
    const nodeMerge = nodeEnter.merge(node)

    // Update circle
    nodeMerge.select('circle')
      .attr('r', d => radiusScale(d.fanIn + d.fanOut))
      .attr('fill', d => colorScale(d.module))

    // Update text
    nodeMerge.select('text')
      .text(d => d.name)
      .attr('dx', d => radiusScale(d.fanIn + d.fanOut) + 4)

    // Update tooltip
    nodeMerge.select('title')
      .text(d => `${d.name}\n${d.filePath}:${d.line}\nmodule: ${d.module}\nfan-in: ${d.fanIn} | fan-out: ${d.fanOut}`)

    // Fade in new nodes
    nodeEnter.transition().duration(300).attr('opacity', 1)

    // ── Click handler (uses stable ref to avoid effect re-trigger) ──
    nodeMerge.on('click', (_event, d) => {
      useGraphStore.getState().setSelectedNode(d.id)
      stableOnClickRef.current?.(d)
    })

    // ── No drag behavior (static layout — no force simulation to drive it) ──

    // ── Static positioning: place directly at circle layout positions ──
    // Position nodes at their circle positions (replaces tick handler)
    nodeMerge.attr('transform', d => `translate(${d.x},${d.y})`)

    // Position links using source/target node positions from the circle layout
    linkContainer
      .selectAll<SVGLineElement, SimLink>('line')
      .attr('x1', d => nodeMap.get(d.source as string)?.x ?? 0)
      .attr('y1', d => nodeMap.get(d.source as string)?.y ?? 0)
      .attr('x2', d => nodeMap.get(d.target as string)?.x ?? 0)
      .attr('y2', d => nodeMap.get(d.target as string)?.y ?? 0)

    // Save positions for stability across data updates
    for (const n of simNodes) {
      if (n.x !== undefined) {
        prevNodePositionsRef.current.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy })
      }
    }
  }, [nodes, edges, analysisStatus, width, height])

  // ── Effect 3: Update highlights (independent of data) ────────────
  useEffect(() => {
    const svg = d3.select(svgRef.current)
    if (svg.empty() || !gRef.current) return

    const g = gRef.current

    // Node highlights
    g.selectAll<SVGGElement, SimNode>('.node').each(function (d) {
      const sel = d3.select(this)
      const circle = sel.select('circle')
      const isSelected = d.id === selectedNodeId
      const isHighlighted = highlightedNodeIds.includes(d.id)
      const hasHighlights = highlightedNodeIds.length > 0

      if (isSelected) {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#ffd700').attr('stroke-width', 3).attr('opacity', 1)
        sel.raise()
      } else if (isHighlighted) {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#00ff88').attr('stroke-width', 2.5).attr('opacity', 1)
      } else if (hasHighlights) {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('opacity', 0.3).attr('stroke', '#555').attr('stroke-width', 1)
      } else {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('opacity', 0.9).attr('stroke', '#fff').attr('stroke-width', 1.5)
      }
    })

    // Link highlights
    g.selectAll<SVGLineElement, SimLink>('.link-group line').each(function (d) {
      const line = d3.select(this)
      const sourceId = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
      const targetId = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
      const selectedInvolved = sourceId === selectedNodeId || targetId === selectedNodeId
      const sourceHL = highlightedNodeIds.includes(sourceId)
      const targetHL = highlightedNodeIds.includes(targetId)
      const hasHL = highlightedNodeIds.length > 0

      if (selectedInvolved) {
        line.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#ffd700').attr('stroke-opacity', 0.9)
      } else if (sourceHL || targetHL) {
        line.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#00ff88').attr('stroke-opacity', 0.8)
      } else if (hasHL || selectedNodeId) {
        line.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke-opacity', 0.08)
      } else {
        line.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#555').attr('stroke-opacity', 0.6)
      }
    })
  }, [selectedNodeId, highlightedNodeIds])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ background: '#1a1a2e', display: 'block' }}
    />
  )
}

export default GraphCanvasStatic
