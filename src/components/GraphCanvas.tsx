import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { hierarchy, tree as d3tree } from 'd3-hierarchy'
import { useGraphStore } from '../store/useGraphStore'
import { useLSPClient } from '../hooks/useLSPClient'
import type { FunctionNode, CallEdge } from '../types/graph'
import { getDisplayName } from '../types/graph'
import EdgeStateOverlay from './EdgeStateOverlay'

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
  isExternal: boolean
  edgeKind?: 'call' | 'trait_impl'
}

// ─── Constants ──────────────────────────────────────────────────────

const MODULE_COLORS = [
  '#e94560', '#0f3460', '#16213e', '#533483', '#e67e22',
  '#2ecc71', '#3498db', '#f39c12', '#1abc9c', '#9b59b6',
  '#34495e', '#d35400',
]

const NODE_MIN_RADIUS = 4
const NODE_MAX_RADIUS = 14
const EDGE_MIN_WIDTH = 0.3
const EDGE_MAX_WIDTH = 4
const LABEL_FONT_SIZE = 10
const HIGHLIGHT_DURATION = 300

// ─── Static scales (fixed domain for subgraphs) ────────────────────

const colorScale = d3.scaleOrdinal<string>(MODULE_COLORS)
const radiusScale = d3.scaleSqrt().domain([0, 10]).range([NODE_MIN_RADIUS, NODE_MAX_RADIUS])
const edgeWidthScale = d3.scaleSqrt().domain([0, 10]).range([EDGE_MIN_WIDTH, EDGE_MAX_WIDTH])

// ─── Layout mode selection ──────────────────────────────────────────

type LayoutMode = 'radial' | 'tree' | 'force'

function selectLayoutMode(nodeCount: number): LayoutMode {
  if (nodeCount <= 35) return 'radial'
  if (nodeCount <= 40) return 'tree'
  return 'force'
}

// ─── Simple markdown renderer for hover tooltips ────────────────────

function renderHoverMarkdown(md: string): React.ReactNode {
  // Split into lines and process
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block fence
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} style={{
            background: '#0a0a1e',
            padding: '6px 8px',
            borderRadius: 4,
            overflow: 'auto',
            fontSize: 11,
            lineHeight: 1.4,
            margin: '4px 0',
          }}>
            <code>{codeBlockLines.join('\n')}</code>
          </pre>
        )
        codeBlockLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeBlockLines = []
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockLines.push(line)
      continue
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={`br-${i}`} />)
      continue
    }

    // Render inline content with basic markdown formatting
    const rendered = renderInlineMarkdown(line)
    elements.push(<div key={`line-${i}`} style={{ marginBottom: 2 }}>{rendered}</div>)
  }

  // Unclosed code block (shouldn't happen, but handle gracefully)
  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <pre key={`code-${lines.length}`} style={{
        background: '#0a0a1e', padding: '6px 8px', borderRadius: 4, fontSize: 11,
      }}>
        <code>{codeBlockLines.join('\n')}</code>
      </pre>
    )
  }

  return <>{elements}</>
}

/**
 * Render a single line of inline markdown (bold, code, inline code).
 */
function renderInlineMarkdown(line: string): React.ReactNode {
  // Bold: **text**
  const parts: React.ReactNode[] = []
  let remaining = line
  let key = 0

  // Simple tokenizer for inline formatting
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(remaining)) !== null) {
    // Plain text before match
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{remaining.slice(lastIndex, match.index)}</span>)
    }

    if (match[1]?.startsWith('**')) {
      // Bold: **text**
      parts.push(<strong key={key++} style={{ color: '#fff' }}>{match[2]}</strong>)
    } else if (match[3] !== undefined) {
      // Inline code: `code`
      parts.push(
        <code key={key++} style={{
          background: '#0a0a1e',
          padding: '1px 4px',
          borderRadius: 3,
          fontSize: 11,
          color: '#e94560',
        }}>
          {match[3]}
        </code>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text after last match
  if (lastIndex < remaining.length) {
    parts.push(<span key={key++}>{remaining.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? <>{parts}</> : line
}

// ─── Component ──────────────────────────────────────────────────────

interface GraphCanvasProps {
  width: number
  height: number
  focusNodeId: string | null
  onNodeClick?: (node: FunctionNode) => void
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({ width, height, focusNodeId, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const initializedRef = useRef(false)

  // D3 refs - stable across renders
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const stableOnClickRef = useRef<((node: FunctionNode) => void) | undefined>(undefined)
  const diagLoggedRef = useRef(false)
  const prevEffectKeyRef = useRef<string | null>(null)
  stableOnClickRef.current = onNodeClick

  // Loading / error state for edge fetching
  const [isLoadingEdges, setIsLoadingEdges] = useState(false)
  const [edgeError, setEdgeError] = useState<string | null>(null)
  const [edgeLoadingMessage, setEdgeLoadingMessage] = useState('')

  // ── Tooltip / hover state ──
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipContent, setTooltipContent] = useState<string | null>(null)
  const [tooltipLoading, setTooltipLoading] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const tooltipCacheRef = useRef<Map<string, string>>(new Map())
  const tooltipLoadingSetRef = useRef<Set<string>>(new Set())
  const hoveredNodeIdRef = useRef<string | null>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Peek refs
  const hoverPeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodePositionsRef = useRef<Map<string, {x: number; y: number}>>(new Map())
  const didDragRef = useRef(false)
  const isFirstFocusRef = useRef(true)
  const tooltipPosInitializedRef = useRef(false)

  // Compute opposite-corner position from mouse (used during drag)
  const computeRepelPos = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const container = svgRef.current?.parentElement
    if (!container) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const relX = clientX - rect.left
    const relY = clientY - rect.top
    const left = relX > w / 2   // mouse on right → put on left
    const top = relY > h / 2    // mouse on bottom → put on top
    return { x: left ? 12 : w - 412, y: top ? 12 : h - 412 }
  }, [])

  // Edge shortening: line endpoints are pulled back so arrow tips clear node circles
  const GAP_MAIN = 9   // node radius(6) + outside gap(3)
  const GAP_PEEK = 6   // peek node radius(4) + outside gap(2)
  const shortenTarget = useCallback(
    (sx: number, sy: number, tx: number, ty: number, amount: number): { x: number; y: number } => {
      const dx = tx - sx
      const dy = ty - sy
      const len = Math.sqrt(dx * dx + dy * dy)
      if (len < 0.001) return { x: tx, y: ty }
      return { x: tx - (dx / len) * amount, y: ty - (dy / len) * amount }
    },
    []
  )

  // Peek state from store
  const peekStack = useGraphStore(s => s.peekStack)
  const transientPeekNodeId = useGraphStore(s => s.transientPeekNodeId)
  const pushPeek = useGraphStore(s => s.pushPeek)
  const popToPeek = useGraphStore(s => s.popToPeek)
  const setTransientPeekNode = useGraphStore(s => s.setTransientPeekNode)
  const clearAllPeeks = useGraphStore(s => s.clearAllPeeks)

  // Store subscriptions
  const nodes = useGraphStore(s => s.nodes)
  const edges = useGraphStore(s => s.edges)
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const highlightedNodeIds = useGraphStore(s => s.highlightedNodeIds)
  const analysisStatus = useGraphStore(s => s.analysisStatus)
  const showExternal = useGraphStore(s => s.showExternal)

  // LSP client for on-demand edge loading
  const { loadEdgesRecursively, getHoverInfo } = useLSPClient()

  // Shared helper: load edges with progress and stale-navigation guards
  const loadEdgesWithProgress = useCallback((nodeId: string) => {
    setEdgeError(null)
    setIsLoadingEdges(true)
    setEdgeLoadingMessage('Loading edges (level 1/5)...')

    const node = useGraphStore.getState().nodes.find(n => n.id === nodeId)
    if (!node) {
      setIsLoadingEdges(false)
      setEdgeLoadingMessage('')
      return
    }

    loadEdgesRecursively(node, 5, (level, maxDepth, nodeCount) => {
      setEdgeLoadingMessage(`Loading edges (level ${level}/${maxDepth}) — ${nodeCount} nodes...`)
    })
      .then(() => {
        if (useGraphStore.getState().selectedNodeId !== nodeId) return
        setIsLoadingEdges(false)
        setEdgeLoadingMessage('')
      })
      .catch((err: unknown) => {
        if (useGraphStore.getState().selectedNodeId !== nodeId) return
        setEdgeError(err instanceof Error ? err.message : String(err))
        setIsLoadingEdges(false)
        setEdgeLoadingMessage('')
      })
  }, [loadEdgesRecursively])

  // ── Effect 1a: Initialize SVG, zoom, groups (runs ONCE) ──────────
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (initializedRef.current) return
    initializedRef.current = true

    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current!)

    // Remove only Effect 1's own children (recreated below) — do NOT wipe D3 nodes from Effect 2
    svg.selectAll<SVGDefsElement, unknown>('defs').remove()
    let g = svg.select<SVGGElement>('.graph-root')
    if (g.empty()) {
      g = svg.append('g').attr('class', 'graph-root')
    }

    // Arrow marker (scaled down for subgraph)
    const defs = svg.append('defs')
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -6 12 12')
      .attr('refX', 12)
      .attr('refY', 0)
      .attr('markerWidth', 10)
      .attr('markerHeight', 10)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-6L12,0L0,6')
      .attr('fill', '#e94560')

    // Graphics container — reuse existing if present
    gRef.current = g

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 10])
      .filter(event => {
        return !(event.target as Element).closest('.node')
      })
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom)
    zoomRef.current = zoom

    // Center initial view
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.5))

    // Cleanup
    return () => {
      if (simRef.current) simRef.current.stop()
      svg.on('.zoom', null)
      initializedRef.current = false
    }
  }, [analysisStatus])

  // ── Effect 1b: Center zoom (runs when dimensions change) ───────
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (!svgRef.current || !zoomRef.current) return
    if (!initializedRef.current) return

    const svg = d3.select(svgRef.current)
    svg.call(zoomRef.current.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8))
  }, [width, height])

  // ── Effect: SVG blur filters for peek layers (stable, never torn down) ──
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    const svg = d3.select(svgRef.current)
    if (svg.empty()) return
    // Use a separate defs group so Effect 1a's svg.selectAll('defs').remove() doesn't affect it
    const defs = svg.append('defs').attr('class', 'peek-defs')
    const blurLevels = [
      { id: 'peek-blur-1', stdDev: 0.5 },
      { id: 'peek-blur-2', stdDev: 1.2 },
      { id: 'peek-blur-3', stdDev: 2.0 },
    ]
    for (const { id, stdDev } of blurLevels) {
      const filter = defs.append('filter').attr('id', id)
      filter.append('feGaussianBlur').attr('stdDeviation', stdDev)
    }

    // Add arrow marker for peek edges (userSpaceOnUse so it doesn't scale with stroke-width)
    const arrowMarker = defs.append('marker')
      .attr('id', 'peek-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 8)
      .attr('markerHeight', 8)
      .attr('markerUnits', 'userSpaceOnUse')
      .attr('orient', 'auto')
    arrowMarker.append('path')
      .attr('d', 'M0,-4L10,0L0,4')
      .attr('fill', '#aaa')
    return () => { defs.remove() }
  }, [analysisStatus])

  // ── Effect: SVG event delegation for right-click on ALL nodes (main + peek) ──
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)

    function getNodeId(event: MouseEvent): string | null {
      const target = event.target as Element
      const nodeEl = target.closest('.node, .peek-node') as Element | null
      if (!nodeEl) return null
      const datum = d3.select(nodeEl).datum() as Record<string, unknown> | undefined
      if (!datum) return null
      return (datum.id as string) ?? null
    }

    // ── Context menu: right-click toggle persistent peek ──
    svg.on('contextmenu.peek-global', (event: MouseEvent) => {
      event.preventDefault()
      const nodeId = getNodeId(event)
      if (!nodeId || nodeId === focusNodeId) return

      // Cancel any pending hover peek
      if (hoverPeekTimerRef.current !== null) {
        clearTimeout(hoverPeekTimerRef.current)
        hoverPeekTimerRef.current = null
      }
      setTransientPeekNode(null)  // clear transient

      const state = useGraphStore.getState()
      const idx = state.peekStack.indexOf(nodeId)
      if (idx !== -1) {
        // Already persistent — dismiss this level and all deeper
        state.popToPeek(nodeId)
      } else {
        // Not persistent — push to stack
        state.pushPeek(nodeId)
      }
    })

    return () => {
      svg.on('contextmenu.peek-global', null)
    }
  }, [analysisStatus, focusNodeId, setTransientPeekNode, pushPeek, popToPeek])

  // ── Effect: Recursive edge loading on focus change ──────────────
  useEffect(() => {
    if (!focusNodeId) return
    if (analysisStatus !== 'ready') return
    loadEdgesWithProgress(focusNodeId)
  }, [focusNodeId, analysisStatus, loadEdgesWithProgress])

  // ── Effect 2: Focus subgraph simulation ──────────────────────────
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (!gRef.current) return
    if (!focusNodeId) return

    const g = gRef.current

    // ── Early exit: focus node must exist ──
    const focusNode = nodes.find(n => n.id === focusNodeId)
    if (!focusNode) return

    // ── Filter to subgraph ──
    const relatedEdges = edges.filter(
      e => e.source === focusNodeId || e.target === focusNodeId,
    )
    const visibleEdges = showExternal
      ? relatedEdges
      : relatedEdges.filter(e => !e.isExternal)
    const relatedNodeIds = new Set<string>([focusNodeId])
    for (const e of visibleEdges) {
      relatedNodeIds.add(e.source)
      relatedNodeIds.add(e.target)
    }
    const subgraphNodes = nodes.filter(n => relatedNodeIds.has(n.id))
    if (subgraphNodes.length === 0) return

    // ── Duplicate render guard ──
    // Effect 2 sometimes fires twice with identical data due to React batching edge cases.
    // Skip the D3 join entirely when the key matches, preventing duplicate DOM elements.
    const effectKey = `${focusNodeId}:${nodes.length}:${edges.length}:${showExternal}`
    if (prevEffectKeyRef.current === effectKey) {
      console.log('[GC] Duplicate Effect 2, skip render')
      return  // Skip the rest — DOM already matches data
    }
    prevEffectKeyRef.current = effectKey
    diagLoggedRef.current = false

    // Clear stale node positions from previous graph render
    nodePositionsRef.current.clear()

    // Diagnostic: check for duplicate node IDs in subgraph
    const subgraphIdSet = new Set<string>()
    const subgraphDuplicates: string[] = []
    for (const n of subgraphNodes) {
      if (subgraphIdSet.has(n.id)) subgraphDuplicates.push(n.id)
      subgraphIdSet.add(n.id)
    }
    if (subgraphDuplicates.length > 0) {
      console.warn('[GC] ⚠️ Duplicate node IDs in subgraphNodes:', subgraphDuplicates)
    }

    // ── Identify caller/callee sets (used by radial and tree layouts) ──
    const callerIds = new Set(visibleEdges.filter(e => e.target === focusNodeId).map(e => e.source))
    const calleeIds = new Set(visibleEdges.filter(e => e.source === focusNodeId).map(e => e.target))

    const mode = selectLayoutMode(subgraphNodes.length)
    console.log('[GC] Layout mode:', mode, 'nodes:', subgraphNodes.length)

    // ── Build sim data with layout-specific positions ──
    let simNodes: SimNode[]

    if (mode === 'radial') {
      // Init all nodes at origin; positions assigned below
      simNodes = subgraphNodes.map(n => {
        if (n.id === focusNodeId) return { ...n, x: 0, y: 0, fx: 0, fy: 0, vx: 0, vy: 0 }
        return { ...n, x: 0, y: 0, vx: 0, vy: 0 }
      })

      const callers = simNodes.filter(n => callerIds.has(n.id)).sort((a, b) => a.name.localeCompare(b.name))
      const callees = simNodes.filter(n => calleeIds.has(n.id)).sort((a, b) => a.name.localeCompare(b.name))
      const baseRadius = Math.max(Math.min(width, height) * 0.35, 180)
      const radius = baseRadius * (0.6 + 0.4 * Math.min(subgraphNodes.length / 15, 2.0))

      // Track positioned nodes to prevent dual-role overwrite
      const positionedIds = new Set<string>()

      // Adaptive gap proportional to total node count — prevents overlap at endpoints
      const gapAngle = Math.PI / (callers.length + callees.length + 2)

      // Left semi-circle: callers (clockwise from slightly-below-top through left to slightly-above-bottom)
      const callerStartAngle = -Math.PI / 2 + gapAngle
      const callerEndAngle = -(3 * Math.PI / 2) - gapAngle
      for (let i = 0; i < callers.length; i++) {
        const angle = callers.length === 1
          ? callerStartAngle
          : callerStartAngle + (i / (callers.length - 1)) * (callerEndAngle - callerStartAngle)
        callers[i].x = radius * Math.cos(angle)
        callers[i].y = radius * Math.sin(angle)
        callers[i].fx = callers[i].x
        callers[i].fy = callers[i].y
        positionedIds.add(callers[i].id)
      }

      // Right semi-circle: callees (counter-clockwise from 90°+gap through right to -90°-gap)
      const calleeStartAngle = Math.PI / 2 + gapAngle
      const calleeEndAngle = -Math.PI / 2 - gapAngle
      for (let i = 0; i < callees.length; i++) {
        // Skip dual-role nodes already positioned by callers loop
        if (positionedIds.has(callees[i].id)) continue
        const angle = callees.length === 1
          ? calleeStartAngle
          : calleeStartAngle + (i / (callees.length - 1)) * (calleeEndAngle - calleeStartAngle)
        callees[i].x = radius * Math.cos(angle)
        callees[i].y = radius * Math.sin(angle)
        callees[i].fx = callees[i].x
        callees[i].fy = callees[i].y
      }

      // ── Diagnostic: detect overlapping node positions ──
      console.group('[GC] Radial layout diagnostics')
      console.log('[GC] Mode: radial, nodes:', subgraphNodes.length, 'callers:', callers.length, 'callees:', callees.length)
      console.log('[GC] gapAngle:', (gapAngle * 180 / Math.PI).toFixed(1) + '°')
      console.log('[GC] callerStartAngle:', (callerStartAngle * 180 / Math.PI).toFixed(1) + '°',
        'callerEndAngle:', (callerEndAngle * 180 / Math.PI + 360).toFixed(1) + '°')
      console.log('[GC] calleeStartAngle:', (calleeStartAngle * 180 / Math.PI).toFixed(1) + '°',
        'calleeEndAngle:', (calleeEndAngle * 180 / Math.PI).toFixed(1) + '°')

      const positionedStr = Array.from(positionedIds)
      simNodes.forEach(n => {
        const role = n.id === focusNodeId ? 'FOCUS' :
          callerIds.has(n.id) && calleeIds.has(n.id) ? 'BOTH' :
          callerIds.has(n.id) ? 'CALLER' : 'CALLEE'
        console.log(`[GC]   ${role}: ${n.name} (${n.filePath.split('/').pop()}) → (${n.x?.toFixed(0)}, ${n.y?.toFixed(0)})`)
      })

      const posMap = new Map<string, string[]>()
      simNodes.forEach(n => {
        if (n.x === undefined || n.y === undefined) return
        const key = `${n.x.toFixed(1)},${n.y.toFixed(1)}`
        if (!posMap.has(key)) posMap.set(key, [])
        posMap.get(key)!.push(n.name)
      })
      posMap.forEach((names, pos) => {
        if (names.length > 1) {
          console.warn(`[GC] ⚠️ POSITION COLLISION at (${pos}): ${names.join(', ')}`)
        }
      })
      console.groupEnd()
    } else if (mode === 'tree') {
      // Custom fan layout — avoids single-column vertical stacking by spreading
      // callers/callees in a fan/arc pattern that uses 2D space efficiently.
      simNodes = subgraphNodes.map(n => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }))

      // Focus node stays at center
      const focusSim = simNodes.find(n => n.id === focusNodeId)
      if (focusSim) {
        focusSim.x = 0
        focusSim.y = 0
        focusSim.fx = 0
        focusSim.fy = 0
      }

      const callersSorted = simNodes.filter(n => callerIds.has(n.id)).sort((a, b) => a.name.localeCompare(b.name))
      const calleesSorted = simNodes.filter(n => calleeIds.has(n.id)).sort((a, b) => a.name.localeCompare(b.name))
      const maxSide = Math.max(callersSorted.length, calleesSorted.length, 1)

      // Adaptive span — use available viewport but keep nodes visible
      const verticalSpan = Math.min(height * 0.75, maxSide * 28)
      const horizontalSpan = Math.min(width * 0.3, 200)

      // Position callers on the left in a fan/arc shape
      for (let i = 0; i < callersSorted.length; i++) {
        const t = maxSide <= 1 ? 0 : (i / Math.max(maxSide - 1, 1)) * 2 - 1 // -1 to 1
        const y = t * verticalSpan / 2
        // Cos curve: nodes near top/bottom are closer to center (wider fan), middle ones go further out
        const xFactor = Math.cos(t * Math.PI / 3)
        callersSorted[i].x = -horizontalSpan * (0.6 + 0.4 * xFactor)
        callersSorted[i].y = y
        callersSorted[i].fx = callersSorted[i].x
        callersSorted[i].fy = callersSorted[i].y
      }

      // Position callees on the right in a fan/arc shape
      for (let i = 0; i < calleesSorted.length; i++) {
        const t = maxSide <= 1 ? 0 : (i / Math.max(maxSide - 1, 1)) * 2 - 1 // -1 to 1
        const y = t * verticalSpan / 2
        const xFactor = Math.cos(t * Math.PI / 3)
        calleesSorted[i].x = horizontalSpan * (0.6 + 0.4 * xFactor)
        calleesSorted[i].y = y
        calleesSorted[i].fx = calleesSorted[i].x
        calleesSorted[i].fy = calleesSorted[i].y
      }
    } else {
      // Force mode — circular initial positions (existing behavior)
      const otherNodes = subgraphNodes.filter(n => n.id !== focusNodeId)
      const r = Math.min(width, height) * 0.35

      simNodes = subgraphNodes.map(n => {
        if (n.id === focusNodeId) return { ...n, x: 0, y: 0, vx: 0, vy: 0 }
        const idx = otherNodes.indexOf(n)
        const angle = (2 * Math.PI * idx) / otherNodes.length
        return {
          ...n,
          x: r * Math.cos(angle),
          y: r * Math.sin(angle),
          vx: 0,
          vy: 0,
        }
      })
    }

    console.log('[GC] simNodes data:', simNodes.map(n => ({
      id: n.id,
      name: n.name,
      x: n.x?.toFixed(1),
      y: n.y?.toFixed(1),
      role: n.id === focusNodeId ? 'FOCUS' : callerIds.has(n.id) ? 'CALLER' : 'CALLEE'
    })))

    const nodeMap = new Map<string, SimNode>()
    for (const n of simNodes) nodeMap.set(n.id, n)

    // Detect name collisions in the subgraph to disambiguate labels
    const nameCounts = new Map<string, number>()
    for (const n of simNodes) {
      nameCounts.set(n.name, (nameCounts.get(n.name) ?? 0) + 1)
    }

    const simLinks: SimLink[] = visibleEdges.map(e => ({
      source: e.source,
      target: e.target,
      callCount: e.callCount,
      callSites: e.callSites,
      isExternal: e.isExternal,
      edgeKind: e.edgeKind,
    }))

    // ── Interrupt stale transitions before D3 join ──
    g.selectAll('*').interrupt()

    // ── Links: D3 join ──
    const linkGroup = g.selectAll<SVGGElement, unknown>('.link-group').data([null])
    const linkContainer = linkGroup.join('g').attr('class', 'link-group')

    const link = linkContainer
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks, d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        const tid = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
        return `${sid}:${tid}:${d.edgeKind ?? 'call'}`
      })

    console.log('[GC] Link data join:', {
      existingEls: linkContainer.selectAll('line').size(),
      dataSize: simLinks.length,
      enter: link.enter().size(),
      update: link.size(),
      exit: link.exit().size(),
    })

    link.exit()
      .transition().duration(200).attr('stroke-opacity', 0)
      .on('end interrupt', function() { d3.select(this).remove() })
      .remove()

    const linkEnter = link.enter()
      .append('line')
      .attr('stroke-opacity', 0)

    const linkMerge = linkEnter.merge(link)
      .attr('stroke', d => {
        if (d.edgeKind === 'trait_impl') return '#00bcd4'  // Cyan for trait edges
        return d.isExternal ? '#444' : '#888'
      })
      .attr('stroke-opacity', d => d.edgeKind === 'trait_impl' ? 0.8 : 0.6)
      .attr('stroke-width', d => {
        if (d.edgeKind === 'trait_impl') return 2
        return edgeWidthScale(d.callCount)
      })
      .attr('stroke-dasharray', d => {
        if (d.edgeKind === 'trait_impl') return '8,3,2,3'  // dash-dot-dash for trait edges
        return d.isExternal ? '4,2' : null
      })
      .attr('marker-end', 'url(#arrow)')

    linkEnter.transition().duration(300).attr('stroke-opacity', 0.6)

    // ── Nodes: D3 join ──
    const nodeGroup = g.selectAll<SVGGElement, unknown>('.node-group').data([null])
    const nodeContainer = nodeGroup.join('g').attr('class', 'node-group')

    const node = nodeContainer
      .selectAll<SVGGElement, SimNode>('.node')
      .data(simNodes, d => d.id)

    console.log('[GC] D3 node join:', {
      existingElements: nodeContainer.selectAll('.node').size(),
      dataSize: simNodes.length,
      enterSize: node.enter().size(),
      updateSize: node.size(),
      exitSize: node.exit().size(),
    })

    // Exit: remove old nodes
    node.exit()
      .transition().duration(200).attr('opacity', 0)
      .on('end interrupt', function() { d3.select(this).remove() })
      .remove()

    // Enter: create new nodes
    const nodeEnter = node.enter()
      .append('g')
      .attr('class', 'node')
      .attr('cursor', 'pointer')
      .attr('opacity', 0)

    nodeEnter.append('circle')
      .attr('r', d => d.isUserCode === false ? 5 : radiusScale(d.fanIn + d.fanOut))
      .attr('fill', d => d.isUserCode === false ? '#555' : colorScale(d.module))
      .attr('stroke', '#fff')
      .attr('stroke-width', d => d.isUserCode === false ? 2 : 1.5)
      .attr('stroke-dasharray', d => d.isUserCode === false ? '2,2' : null)

    nodeEnter.append('text')
      .attr('dx', d => (d.isUserCode === false ? 5 : radiusScale(d.fanIn + d.fanOut)) + 4)
      .attr('dy', 4)
      .attr('font-size', d => d.isUserCode === false ? 8 : LABEL_FONT_SIZE)
      .attr('fill', d => d.isUserCode === false ? '#666' : '#ccc')
      .attr('pointer-events', 'none')
      .style('text-shadow', '1px 1px 2px rgba(0,0,0,0.8)')
      .text(d => getDisplayName(d))  // belt-and-suspenders: set text on enter too

    // Merge: update all nodes
    const nodeMerge = nodeEnter.merge(node)

    // Ensure UPDATE elements have full opacity (stale Effect 2 runs can
    // interrupt their enter-fade transition, leaving them nearly invisible)
    node.attr('opacity', 1)

    console.log('[GC] Post-merge elements:', {
      nodeGroupElements: nodeContainer.selectAll('.node').size(),
      simNodeCount: simNodes.length,
    })

    // Update circle
    nodeMerge.select('circle')
      .attr('r', d => d.isUserCode === false ? 5 : radiusScale(d.fanIn + d.fanOut))
      .attr('fill', d => d.isUserCode === false ? '#555' : colorScale(d.module))
      .attr('stroke-width', d => d.isUserCode === false ? 2 : 1.5)
      .attr('opacity', 1)

    // Update text
    nodeMerge.select('text')
      .text(d => {
        const base = getDisplayName(d)
        const fileName = d.filePath.split('/').pop()?.replace(/\.[^.]*$/, '') ?? d.module
        if (d.id === focusNodeId) {
          const suffix = fileName
          return `${base} [${suffix}]`
        }
        const hasCollision = (nameCounts.get(d.name) ?? 0) > 1
        if (hasCollision) {
          const suffix = fileName
          return `${base} [${suffix}]`
        }
        return base
      })
      .attr('dx', d => (d.isUserCode === false ? 5 : radiusScale(d.fanIn + d.fanOut)) + 4)

    // Fade in new nodes
    nodeEnter.transition().duration(300).attr('opacity', 1)

    setTimeout(() => {
      const actualNodes = nodeContainer.selectAll('.node').size()
      const actualLinks = linkContainer.selectAll('line').size()
      const emptyTextNodes = nodeContainer.selectAll('.node text').filter(function() {
        return d3.select(this).text() === ''
      }).size()
      console.log('[GC] Post-fade DOM check:', {
        nodeElements: actualNodes,
        expectedNodes: simNodes.length,
        linkElements: actualLinks,
        expectedLinks: simLinks.length,
        emptyTextElements: emptyTextNodes,
      })
    }, 500)

    // ── Click handler ──
    nodeMerge.on('click', (_event, d) => {
      if (didDragRef.current) {
        return  // skip click events that follow a drag
      }

      // Clear peek state on navigation
      clearAllPeeks()

      // Only use the stable callback for navigation — it routes through App.tsx's handleNodeClick
      // which calls focusNode via the store. This avoids double-focusNode calls.
      setIsLoadingEdges(false)
      if (stableOnClickRef.current) {
        stableOnClickRef.current(d)
      }
    })

    // ── Hover / tooltip handler ──
    nodeMerge.on('mouseenter', function (this: SVGGElement, event: MouseEvent, d: SimNode) {
      // Cancel any pending hide
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }

      // On first hover, initialize tooltip to bottom-right corner
      if (!tooltipPosInitializedRef.current) {
        const container = svgRef.current?.parentElement
        if (container) {
          const rect = container.getBoundingClientRect()
          setTooltipPos({ x: rect.width - 412, y: rect.height - 412 })
        }
        tooltipPosInitializedRef.current = true
      }
      // Otherwise: keep current position (never reset on normal hover)

      hoveredNodeIdRef.current = d.id
      setTooltipVisible(true)

      // Start hover peek timer (transient third-layer)
      if (hoverPeekTimerRef.current !== null) {
        clearTimeout(hoverPeekTimerRef.current)
      }
      hoverPeekTimerRef.current = setTimeout(() => {
        setTransientPeekNode(d.id)
        hoverPeekTimerRef.current = null
      }, 200)

      // Check cache first
      const cache = tooltipCacheRef.current
      if (cache.has(d.id)) {
        setTooltipContent(cache.get(d.id)!)
        setTooltipLoading(false)
        return
      }

      // Avoid duplicate in-flight requests
      if (tooltipLoadingSetRef.current.has(d.id)) return
      tooltipLoadingSetRef.current.add(d.id)

      setTooltipLoading(true)
      setTooltipContent(null)

      getHoverInfo(d)
        .then(result => {
          if (result.found && result.markdown) {
            cache.set(d.id, result.markdown)
            if (hoveredNodeIdRef.current === d.id) {
              setTooltipContent(result.markdown)
            }
          } else {
            const fallback = [
              `**${getDisplayName(d)}**`,
              '',
              `**File:** \`${d.filePath}:${d.line}\``,
              `**Module:** ${d.module}`,
              `**Fan-in:** ${d.fanIn} | **Fan-out:** ${d.fanOut}`,
            ].join('\n')
            cache.set(d.id, fallback)
            if (hoveredNodeIdRef.current === d.id) {
              setTooltipContent(fallback)
            }
          }
        })
        .catch(() => {
          if (hoveredNodeIdRef.current === d.id) {
            setTooltipContent(null)
          }
        })
        .finally(() => {
          tooltipLoadingSetRef.current.delete(d.id)
          if (hoveredNodeIdRef.current === d.id) {
            setTooltipLoading(false)
          }
        })
    })

    nodeMerge.on('mouseleave', function (this: SVGGElement, _event: MouseEvent, d: SimNode) {
      if (hoveredNodeIdRef.current === d.id) {
        hoveredNodeIdRef.current = null
      }

      // Cancel hover peek timer if pending, or dismiss transient
      if (hoverPeekTimerRef.current !== null) {
        clearTimeout(hoverPeekTimerRef.current)
        hoverPeekTimerRef.current = null
      }
      setTransientPeekNode(null)

      // Small delay to avoid flicker when moving between adjacent nodes
      hideTimeoutRef.current = setTimeout(() => {
        setTooltipVisible(false)
        setTooltipContent(null)
        setTooltipLoading(false)
      }, 800)
    })

    // Set initial positions immediately (before simulation starts)
    nodeMerge.attr('transform', d => `translate(${d.x},${d.y})`)

    // ── Drag behavior ──
    const drag = d3.drag<SVGGElement, SimNode>()
      .clickDistance(3)
      .on('start', function (this: SVGGElement, event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>, d: SimNode) {
        didDragRef.current = false
        const se = event.sourceEvent as MouseEvent | undefined
        if (se) {
          setTooltipPos(computeRepelPos(se.clientX, se.clientY))
        }
        console.log('[GC] 🖱️ drag start:', d.name, 'at', event.x.toFixed(0), event.y.toFixed(0))
        // Store drag start position on the element for distance check
        d3.select(this).attr('data-drag-x', event.x).attr('data-drag-y', event.y)
        d.fx = d.x
        d.fy = d.y
        if (simRef.current) {
          simRef.current.alphaTarget(0.3).restart()
        }
        // NOTE: d3.select(this).raise() intentionally omitted — it interferes
        // with D3 v7's synthetic click dispatch after drag (the DOM move during
        // the start handler prevents the 'click' event from firing on mouseup).
      })
      .on('drag', function (this: SVGGElement, event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>, d: SimNode) {
        // Only treat as drag if mouse moved more than 3px — prevents tiny
        // click jitter from suppressing the click handler via didDrag.
        const el = d3.select(this)
        const startX = parseFloat(el.attr('data-drag-x'))
        const startY = parseFloat(el.attr('data-drag-y'))
        const dx = event.x - startX
        const dy = event.y - startY
        console.log('[GC] 🖱️ drag move:', d.name, 'dist²:', (dx*dx + dy*dy).toFixed(1))
        if (!isNaN(startX) && !isNaN(startY)) {
          if (dx * dx + dy * dy > 9) {
            didDragRef.current = true
          }
        }
        d.fx = event.x
        d.fy = event.y
        if (!simRef.current) {
          // Static mode: manually update DOM (no simulation tick handler running)
          d.x = event.x
          d.y = event.y
          d3.select(this).attr('transform', `translate(${d.x},${d.y})`)
          console.log('[GC] 🖱️ drag static mode:', d.id, d.name, 'pos:', event.x.toFixed(0), event.y.toFixed(0))
          linkContainer.selectAll<SVGLineElement, SimLink>('line')
            .filter(l => {
              const sid = typeof l.source === 'string' ? l.source : (l.source as SimNode).id
              const tid = typeof l.target === 'string' ? l.target : (l.target as SimNode).id
              return sid === d.id || tid === d.id
            })
            .attr('x1', l => {
              const sid = typeof l.source === 'string' ? l.source : (l.source as SimNode).id
              return nodeMap.get(sid)?.x ?? 0
            })
            .attr('y1', l => {
              const sid = typeof l.source === 'string' ? l.source : (l.source as SimNode).id
              return nodeMap.get(sid)?.y ?? 0
            })
            .attr('x2', l => {
              const sid = typeof l.source === 'string' ? l.source : (l.source as SimNode).id
              const tid = typeof l.target === 'string' ? l.target : (l.target as SimNode).id
              const src = nodeMap.get(sid)
              const tgt = nodeMap.get(tid)
              if (!src || !tgt) return 0
              return shortenTarget(src.x ?? 0, src.y ?? 0, tgt.x ?? 0, tgt.y ?? 0, GAP_MAIN).x
            })
            .attr('y2', l => {
              const sid = typeof l.source === 'string' ? l.source : (l.source as SimNode).id
              const tid = typeof l.target === 'string' ? l.target : (l.target as SimNode).id
              const src = nodeMap.get(sid)
              const tgt = nodeMap.get(tid)
              if (!src || !tgt) return 0
              return shortenTarget(src.x ?? 0, src.y ?? 0, tgt.x ?? 0, tgt.y ?? 0, GAP_MAIN).y
            })
        }

        // Update nodePositionsRef with new position
        nodePositionsRef.current.set(d.id, { x: d.x!, y: d.y! })

        // Update tooltip to repel from mouse during drag
        const se = event.sourceEvent as MouseEvent | undefined
        if (se) {
          setTooltipPos(computeRepelPos(se.clientX, se.clientY))
        }

        // Reposition peek children to follow parent
        const g = gRef.current
        if (g) {
          // Update peek node positions (children follow parent)
          g.selectAll<SVGGElement, unknown>(`.peek-node[data-parent-id="${d.id}"]`).each(function() {
            const el = d3.select(this)
            const ox = parseFloat(el.attr('data-offset-x') ?? '0')
            const oy = parseFloat(el.attr('data-offset-y') ?? '0')
            const newX = d.x! + ox
            const newY = d.y! + oy
            el.attr('transform', `translate(${newX}, ${newY})`)
            // Update edges connected to THIS peek child (its position relative to parent changed)
            const nodeId = el.attr('data-node-id')
            if (nodeId) {
              g.selectAll<SVGLineElement, unknown>(`.peek-edge[data-source="${nodeId}"]`)
                .attr('x1', newX).attr('y1', newY)
              g.selectAll<SVGLineElement, unknown>(`.peek-edge[data-target="${nodeId}"]`)
                .attr('x2', newX).attr('y2', newY)
            }
          })
          // Update peek edges connected to this node (the dragged parent)
          g.selectAll<SVGLineElement, unknown>(`.peek-edge[data-source="${d.id}"]`)
            .attr('x1', d.x!).attr('y1', d.y!)
          g.selectAll<SVGLineElement, unknown>(`.peek-edge[data-target="${d.id}"]`)
            .attr('x2', d.x!).attr('y2', d.y!)
        }
      })
      .on('end', function (_event: d3.D3DragEvent<SVGGElement, SimNode, SimNode>, _d: SimNode) {
        console.log('[GC] 🖱️ drag end:', _d.name, 'didDrag:', didDragRef.current)
        setTimeout(() => { didDragRef.current = false }, 0)
        if (simRef.current) {
          simRef.current.alphaTarget(0)
        }
        // Node stays where user placed it — do NOT clear fx/fy
      })

    nodeMerge.call(drag)

    // Position links using nodeMap
    linkContainer.selectAll<SVGLineElement, SimLink>('line')
      .attr('x1', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        return nodeMap.get(sid)?.x ?? 0
      })
      .attr('y1', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        return nodeMap.get(sid)?.y ?? 0
      })
      .attr('x2', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        const tid = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
        const src = nodeMap.get(sid)
        const tgt = nodeMap.get(tid)
        if (!src || !tgt) return 0
        return shortenTarget(src.x ?? 0, src.y ?? 0, tgt.x ?? 0, tgt.y ?? 0, GAP_MAIN).x
      })
      .attr('y2', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        const tid = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
        const src = nodeMap.get(sid)
        const tgt = nodeMap.get(tid)
        if (!src || !tgt) return 0
        return shortenTarget(src.x ?? 0, src.y ?? 0, tgt.x ?? 0, tgt.y ?? 0, GAP_MAIN).y
      })

    // Diagnostic: check if any link endpoints are missing from nodeMap
    const linkIds = new Set<string>()
    linkContainer.selectAll<SVGLineElement, SimLink>('line').each(function(d) {
      const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
      const tid = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
      if (!nodeMap.has(sid)) linkIds.add(`missing-source:${sid}`)
      if (!nodeMap.has(tid)) linkIds.add(`missing-target:${tid}`)
    })
    if (linkIds.size > 0) {
      console.warn('[GC] ⚠️ Link endpoints missing from nodeMap:', [...linkIds])
    } else {
      console.log('[GC] ✅ All link endpoints found in nodeMap')
    }

    if (!diagLoggedRef.current) {
      const linkCount = linkContainer.selectAll('line').size()
      console.log('[GC] Links rendered (initial):', linkCount, 'mode:', mode, 'simLinks:', simLinks.length)
      diagLoggedRef.current = true
    }

    // ── Layout-aware simulation ──
    if (simRef.current) {
      simRef.current.stop()
    }

    const tickHandler = () => {
      linkContainer.selectAll<SVGLineElement, SimLink>('line')
        .attr('x1', d => (d.source as SimNode).x!)
        .attr('y1', d => (d.source as SimNode).y!)
        .attr('x2', d => {
          const src = d.source as SimNode
          const tgt = d.target as SimNode
          return shortenTarget(src.x!, src.y!, tgt.x!, tgt.y!, GAP_MAIN).x
        })
        .attr('y2', d => {
          const src = d.source as SimNode
          const tgt = d.target as SimNode
          return shortenTarget(src.x!, src.y!, tgt.x!, tgt.y!, GAP_MAIN).y
        })

      if (!diagLoggedRef.current) {
        const linkCount = linkContainer.selectAll('line').size()
        console.log('[GC] Links rendered (tick):', linkCount, 'mode:', mode, 'simLinks:', simLinks.length)
        diagLoggedRef.current = true
      }

      nodeContainer.selectAll<SVGGElement, SimNode>('.node')
        .attr('transform', d => `translate(${d.x},${d.y})`)

      // Update position tracking
      nodeContainer.selectAll<SVGGElement, SimNode>('.node').each(function(d) {
        nodePositionsRef.current.set(d.id, { x: d.x ?? 0, y: d.y ?? 0 })
      })
    }

    if (mode === 'force') {
      const sim = d3.forceSimulation<SimNode>(simNodes)
        .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
          .id(d => d.id)
          .distance(60)
          .strength(0.05),
        )
        .force('charge', d3.forceManyBody().strength(-30))
        .force('center', d3.forceCenter(0, 0))
        .force('collision', d3.forceCollide<SimNode>().radius(d => radiusScale(d.fanIn + d.fanOut) + 3))
        .alphaDecay(0.04)
        .alpha(0.3)
        .on('tick', tickHandler)

      simRef.current = sim

      // Pre-tick to settle quickly
      for (let i = 0; i < 30; i++) {
        sim.tick()
      }

      return () => {
        sim.stop()
      }
    }

    // Radial / tree: static positions — render links directly without simulation
    // Nodes are pinned via fx/fy, so just position links and nodes immediately
    linkContainer.selectAll<SVGLineElement, SimLink>('line')
      .attr('x1', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        return nodeMap.get(sid)?.x ?? 0
      })
      .attr('y1', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        return nodeMap.get(sid)?.y ?? 0
      })
      .attr('x2', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        const tid = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
        const src = nodeMap.get(sid)
        const tgt = nodeMap.get(tid)
        if (!src || !tgt) return 0
        return shortenTarget(src.x ?? 0, src.y ?? 0, tgt.x ?? 0, tgt.y ?? 0, GAP_MAIN).x
      })
      .attr('y2', d => {
        const sid = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
        const tid = typeof d.target === 'string' ? d.target : (d.target as SimNode).id
        const src = nodeMap.get(sid)
        const tgt = nodeMap.get(tid)
        if (!src || !tgt) return 0
        return shortenTarget(src.x ?? 0, src.y ?? 0, tgt.x ?? 0, tgt.y ?? 0, GAP_MAIN).y
      })

    // Position nodes
    nodeContainer.selectAll<SVGGElement, SimNode>('.node')
      .attr('transform', d => `translate(${d.x},${d.y})`)

    // Update position tracking
    nodeContainer.selectAll<SVGGElement, SimNode>('.node').each(function(d) {
      nodePositionsRef.current.set(d.id, { x: d.x ?? 0, y: d.y ?? 0 })
    })

    if (!diagLoggedRef.current) {
      const linkCount = linkContainer.selectAll('line').size()
      console.log('[GC] Links rendered (static):', linkCount, 'mode:', mode, 'simLinks:', simLinks.length)
      diagLoggedRef.current = true
    }

    simRef.current = null

    // No simulation needed for static layout
    return () => {}
  }, [nodes, edges, analysisStatus, width, height, focusNodeId, showExternal])

  // ── Effect 3: Highlight updates (including focus node distinction) ─
  useEffect(() => {
    const svg = d3.select(svgRef.current)
    if (svg.empty() || !gRef.current) return

    const g = gRef.current

    g.selectAll<SVGGElement, SimNode>('.node').each(function (d) {
      const sel = d3.select(this)
      const circle = sel.select('circle')
      const text = sel.select('text')
      const isFocus = d.id === focusNodeId
      const isSelected = d.id === selectedNodeId
      const isHighlighted = highlightedNodeIds.includes(d.id)
      const hasHighlights = highlightedNodeIds.length > 0

      if (isFocus) {
        // Focus node always gets gold highlight with red fill
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('r', radiusScale(d.fanIn + d.fanOut) + 2)
          .attr('fill', '#e94560')
          .attr('stroke', '#ffd700')
          .attr('stroke-width', 3)
          .attr('opacity', 1)
        text.transition().duration(HIGHLIGHT_DURATION)
          .attr('fill', '#fff')
          .style('font-weight', 'bold')
        sel.raise()
      } else if (isSelected) {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#ffd700').attr('stroke-width', 3).attr('opacity', 1)
        text.style('font-weight', null)
        sel.raise()
      } else if (isHighlighted) {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('stroke', '#00ff88').attr('stroke-width', 2.5).attr('opacity', 1)
        text.style('font-weight', null)
      } else if (hasHighlights) {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('opacity', 0.3).attr('stroke', '#555').attr('stroke-width', 1)
        text.style('font-weight', null)
      } else {
        circle.transition().duration(HIGHLIGHT_DURATION)
          .attr('opacity', 0.9).attr('stroke', '#fff').attr('stroke-width', 1.5)
        text.style('font-weight', null)
      }
    })

    // Link highlights
    g.selectAll<SVGLineElement, SimLink>('.link-group line').each(function (d) {
      const line = d3.select(this)
      const sourceId = typeof d.source === 'string' ? d.source : (d.source as SimNode).id
      const targetId = typeof d.target === 'string' ? d.target : (d.target as SimNode).id

      // Trait edges keep their distinctive style
      if (d.edgeKind === 'trait_impl') {
        line.attr('stroke', '#00bcd4').attr('stroke-opacity', 0.8)
        return  // Skip further highlight processing
      }

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
  }, [selectedNodeId, highlightedNodeIds, focusNodeId])

  // ── Overlay props computation ────────────────────────────────────
  const focusNodeForOverlay = nodes.find(n => n.id === focusNodeId)
  const focusNodeName = focusNodeForOverlay?.name ?? ''

  const relatedEdgesForOverlay = focusNodeId
    ? edges.filter(e => e.source === focusNodeId || e.target === focusNodeId)
    : []
  const overlayEdgeCount = relatedEdgesForOverlay.length

  const overlayNodeCount = (() => {
    if (!focusNodeId) return 0
    const ids = new Set<string>([focusNodeId])
    for (const e of relatedEdgesForOverlay) {
      ids.add(e.source)
      ids.add(e.target)
    }
    return ids.size
  })()

  // ── Retry handler for error overlay ──────────────────────────────
  const handleRetry = useCallback(() => {
    const currentFocusId = useGraphStore.getState().selectedNodeId
    if (!currentFocusId) return
    loadEdgesWithProgress(currentFocusId)
  }, [loadEdgesWithProgress])

  // ── Effect 4: Recursive peek rendering ────────────────────────────────
  useEffect(() => {
    if (analysisStatus !== 'ready') return
    if (!gRef.current) return
    if (!focusNodeId) {
      gRef.current.selectAll('.peek-group').remove()
      gRef.current.selectAll('.peek-links-group').remove()
      return
    }

    const g = gRef.current
    const state = useGraphStore.getState()
    const { nodes: stateNodes, edges: stateEdges, showExternal: stShowExternal } = state
    const sPeekStack = state.peekStack
    const sTransientPeekNodeId = state.transientPeekNodeId

    // Early exit: nothing to show
    if (sPeekStack.length === 0 && !sTransientPeekNodeId) {
      g.selectAll('.peek-group').remove()
      g.selectAll('.peek-links-group').remove()
      return
    }

    // Step 1: Build base node IDs (focus + its direct callers/callees)
    const baseNodeIds = new Set<string>([focusNodeId])
    for (const e of stateEdges) {
      if (e.source === focusNodeId || e.target === focusNodeId) {
        if (stShowExternal || !e.isExternal) {
          baseNodeIds.add(e.source)
          baseNodeIds.add(e.target)
        }
      }
    }

    // Step 2: Build peek levels from peekStack + transient
    const allLevels: Array<{parentId: string; depth: number; isTransient: boolean}> = []
    sPeekStack.forEach((id, i) => allLevels.push({ parentId: id, depth: i + 1, isTransient: false }))
    if (sTransientPeekNodeId) {
      allLevels.push({ parentId: sTransientPeekNodeId, depth: sPeekStack.length + 1, isTransient: true })
    }

    // Step 3: Collect peek nodes and edges
    const posMap = nodePositionsRef.current
    const allPeekNodeIds = new Set<string>()
    const peekNodes: Array<{ nodeId: string; id: string; parentId: string; depth: number; isTransient: boolean; node: FunctionNode | undefined }> = []
    const peekEdges: Array<{ source: string; target: string; depth: number }> = []

    for (const level of allLevels) {
      const parentPos = posMap.get(level.parentId)
      if (!parentPos) continue

      const levelEdges = stateEdges.filter(e =>
        (e.source === level.parentId || e.target === level.parentId) &&
        (stShowExternal || !e.isExternal)
      )

      // Collect child IDs
      const childIds: string[] = []
      for (const e of levelEdges) {
        const childId = e.source === level.parentId ? e.target : e.source
        if (!baseNodeIds.has(childId) && !allPeekNodeIds.has(childId)) {
          childIds.push(childId)
          allPeekNodeIds.add(childId)
        }
      }

      // Cap at 50
      const capped = childIds.slice(0, 50)

      for (const childId of capped) {
        peekNodes.push({
          nodeId: childId,
          id: childId,        // for SVG delegation datum.id lookup
          parentId: level.parentId,
          depth: level.depth,
          isTransient: level.isTransient,
          node: stateNodes.find(n => n.id === childId),
        })
      }
      for (const e of levelEdges) {
        const tgt = e.source === level.parentId ? e.target : e.source
        if (capped.includes(tgt)) {
          peekEdges.push({ source: e.source, target: e.target, depth: level.depth })
        }
      }

      // Cross-layer edges: connect peek children to base nodes (focus + 1st/2nd layer)
      const crossLayerSeen = new Set<string>()
      for (const pn of peekNodes) {
        for (const e of stateEdges) {
          if (stShowExternal || !e.isExternal) {
            const isSrcPeek = pn.nodeId === e.source
            const isTgtPeek = pn.nodeId === e.target
            if (isSrcPeek && baseNodeIds.has(e.target)) {
              const key = `${e.source}:${e.target}:${pn.depth}`
              if (!crossLayerSeen.has(key)) {
                crossLayerSeen.add(key)
                peekEdges.push({ source: e.source, target: e.target, depth: pn.depth })
              }
            } else if (isTgtPeek && baseNodeIds.has(e.source)) {
              const key = `${e.source}:${e.target}:${pn.depth}`
              if (!crossLayerSeen.has(key)) {
                crossLayerSeen.add(key)
                peekEdges.push({ source: e.source, target: e.target, depth: pn.depth })
              }
            }
          }
        }
      }
    }

    if (peekNodes.length === 0) {
      g.selectAll('.peek-group').remove()
      g.selectAll('.peek-links-group').remove()
      return
    }

    // Step 4: Blur/opacity mapping by depth
    const depthStyle = (depth: number): { opacity: number; filter: string } => {
      switch (depth) {
        case 1: return { opacity: 0.7, filter: 'url(#peek-blur-1)' }
        case 2: return { opacity: 0.5, filter: 'url(#peek-blur-2)' }
        default: return { opacity: 0.35, filter: 'url(#peek-blur-3)' }
      }
    }

    // Step 5: Determine deepest persistent parent (for interactive gate)
    const deepestPersistentParent = sPeekStack.length > 0 ? sPeekStack[sPeekStack.length - 1] : null

    // Step 6: D3 join for peek nodes
    const peekNodeContainer = g.selectAll<SVGGElement, unknown>('.peek-group').data([null])
      .join('g').attr('class', 'peek-group')

    const peekNodeJoin = peekNodeContainer.selectAll<SVGGElement, typeof peekNodes[0]>('.peek-node')
      .data(peekNodes, d => d.nodeId)

    peekNodeJoin.exit().remove()

    const peekNodeEnter = peekNodeJoin.enter().append('g').attr('class', 'peek-node')
    peekNodeEnter.append('circle')
    peekNodeEnter.append('text')

    const peekNodeMerge = peekNodeEnter.merge(peekNodeJoin)

    // Position around parent in a semi-circular fan
    peekNodeMerge.each(function(d) {
      const parentPos = posMap.get(d.parentId)
      if (!parentPos) return
      const el = d3.select(this)
      // Group siblings by parent
      const siblings = peekNodes.filter(n => n.parentId === d.parentId)
      const idx = siblings.indexOf(d)
      const total = siblings.length
      // Semi-circle: -90° to +90° (callers left, callees right would need edge direction — simplified)
      const startAngle = -Math.PI / 2
      const endAngle = Math.PI / 2
      const angle = total <= 1 ? 0 : startAngle + (idx / Math.max(total - 1, 1)) * (endAngle - startAngle)
      const radius = 40 + d.depth * 5
      const relX = radius * Math.cos(angle)
      const relY = radius * Math.sin(angle)
      el.attr('transform', `translate(${parentPos.x + relX}, ${parentPos.y + relY})`)
      // Store relative offset for drag-following
      el.attr('data-parent-id', d.parentId)
      el.attr('data-node-id', d.nodeId)
      el.attr('data-offset-x', relX)
      el.attr('data-offset-y', relY)
    })

    // Styling
    peekNodeMerge.select('circle')
      .attr('r', 4)
      .attr('fill', '#999')
      .attr('stroke', '#bbb')
      .attr('stroke-width', 0.8)

    peekNodeMerge.select('text')
      .text(d => d.node?.name ?? d.nodeId.slice(0, 20))
      .attr('font-size', 8)
      .attr('dx', 5)
      .attr('dy', 2)
      .attr('fill', '#bbb')

    // Apply depth-based blur and opacity
    peekNodeMerge.each(function(d) {
      const el = d3.select(this)
      const style = depthStyle(d.depth)
      el.select('circle')
        .style('opacity', style.opacity)
        .style('filter', style.filter)
      el.select('text')
        .style('opacity', style.opacity)
    })

    // Interactive gate: only deepest persistent level children are interactive
    peekNodeMerge.style('pointer-events', d => {
      if (d.isTransient) return 'none'
      if (deepestPersistentParent && d.parentId === deepestPersistentParent) return 'auto'
      return 'none'
    })

    // Step 7: D3 join for peek edges
    const peekLinkContainer = g.selectAll<SVGGElement, unknown>('.peek-links-group').data([null])
      .join('g').attr('class', 'peek-links-group')

    const peekEdgeJoin = peekLinkContainer.selectAll<SVGLineElement, typeof peekEdges[0]>('.peek-edge')
      .data(peekEdges, d => `${d.source}:${d.target}:${d.depth}`)

    peekEdgeJoin.exit().remove()

    const peekEdgeEnter = peekEdgeJoin.enter().append('line').attr('class', 'peek-edge')

    const peekEdgeMerge = peekEdgeEnter.merge(peekEdgeJoin)

    peekEdgeMerge.each(function(d) {
      function getPeekPos(nodeId: string): {x: number; y: number} | null {
        // If this node has a .peek-node element, compute its rendered position
        const peekEl = g.select(`.peek-node[data-node-id="${nodeId}"]`)
        if (!peekEl.empty()) {
          const parentId = peekEl.attr('data-parent-id')
          if (parentId) {
            const parentPos = posMap.get(parentId)
            if (parentPos) {
              const ox = parseFloat(peekEl.attr('data-offset-x') ?? '0')
              const oy = parseFloat(peekEl.attr('data-offset-y') ?? '0')
              return { x: parentPos.x + ox, y: parentPos.y + oy }
            }
          }
        }
        // Fall back to main graph position
        const mainPos = posMap.get(nodeId)
        return mainPos ?? null
      }

      const srcPos = getPeekPos(d.source)
      const tgtPos = getPeekPos(d.target)
      if (!srcPos || !tgtPos) return

      const shortTgt = shortenTarget(srcPos.x, srcPos.y, tgtPos.x, tgtPos.y, GAP_PEEK)
      const el = d3.select(this)
      el.attr('x1', srcPos.x)
        .attr('y1', srcPos.y)
        .attr('x2', shortTgt.x)
        .attr('y2', shortTgt.y)
        .attr('data-source', d.source)
        .attr('data-target', d.target)
    })

    peekEdgeMerge
      .attr('stroke', '#aaa')
      .attr('stroke-width', 0.5)
      .attr('stroke-dasharray', '3,2')
      .each(function(d) {
        const style = depthStyle(d.depth)
        d3.select(this).style('opacity', style.opacity * 0.7)
      })
      .attr('marker-end', 'url(#peek-arrow)')

    // Cleanup function
    return () => {
      g.selectAll('.peek-group').remove()
      g.selectAll('.peek-links-group').remove()
    }
  }, [peekStack, transientPeekNodeId, analysisStatus, focusNodeId, nodes, edges, showExternal])

  // ── Effect: Clear peeks when focus changes (left panel navigation bypasses click handler) ──
  useEffect(() => {
    if (isFirstFocusRef.current) {
      isFirstFocusRef.current = false
      return
    }
    if (!focusNodeId) return
    clearAllPeeks()
  }, [focusNodeId, clearAllPeeks])

  return (
    <div style={{ position: 'relative', width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ background: '#1a1a2e', display: 'block' }}
      />

      {/* Rich hover tooltip */}
      {tooltipVisible && (
        <div
          style={{
            position: 'absolute',
            left: tooltipPos.x,
            top: tooltipPos.y,
            zIndex: 1000,
            maxWidth: 400,
            maxHeight: 400,
            overflow: 'auto',
            background: '#16213e',
            border: '1px solid #0f3460',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: 1.5,
            color: '#ccc',
            pointerEvents: 'auto',
            userSelect: 'text',
            cursor: 'auto',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
          onMouseEnter={() => {
            if (hideTimeoutRef.current) {
              clearTimeout(hideTimeoutRef.current)
              hideTimeoutRef.current = null
            }
          }}
          onMouseLeave={() => {
            hideTimeoutRef.current = setTimeout(() => {
              setTooltipVisible(false)
              setTooltipContent(null)
              setTooltipLoading(false)
            }, 200)
          }}
        >
          {tooltipLoading ? (
            <span style={{ color: '#888', fontStyle: 'italic' }}>Loading hover info...</span>
          ) : tooltipContent ? (
            renderHoverMarkdown(tooltipContent)
          ) : (
            <span style={{ color: '#888', fontStyle: 'italic' }}>No additional info</span>
          )}
        </div>
      )}

      <EdgeStateOverlay
        isLoading={isLoadingEdges}
        hasError={edgeError}
        nodeCount={overlayNodeCount}
        edgeCount={overlayEdgeCount}
        focusNodeName={focusNodeName}
        onRetry={handleRetry}
        loadingMessage={edgeLoadingMessage}
      />

      {analysisStatus === 'ready' && focusNodeId && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
          <button
            className={`toggle-external-btn${showExternal ? ' active' : ''}`}
            onClick={() => useGraphStore.getState().toggleShowExternal()}
          >
            External: {showExternal ? 'ON' : 'OFF'}
          </button>
        </div>
      )}
    </div>
  )
}

export default GraphCanvas
