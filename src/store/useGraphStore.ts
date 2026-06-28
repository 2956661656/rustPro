import { create } from 'zustand'
import type { FunctionNode, CallEdge, CallGraphData } from '../types/graph'

export interface GraphState {
  // Graph data
  nodes: FunctionNode[]
  edges: CallEdge[]
  stats: CallGraphData['stats'] | null

  // UI state
  selectedNodeId: string | null
  highlightedNodeIds: string[]
  focusHistory: string[]
  forwardHistory: string[]
  searchQuery: string
  searchResults: FunctionNode[]
  isLoading: boolean
  loadingProgress: number
  loadingMessage: string
  error: string | null
  currentProjectPath: string | null
  analysisStatus: 'idle' | 'analyzing' | 'ready' | 'error'
  showExternal: boolean
  fileFilter: string | null

  // Peek state (recursive long-press / right-click)
  peekStack: string[]                    // right-clicked nodes (persistent peeks)
  transientPeekNodeId: string | null    // long-pressed node (temporary peek)

  // Recursive edge loading tracking
  loadedNodeIds: string[]

  // Actions
  setGraphData: (data: { nodes: FunctionNode[]; edges: CallEdge[]; stats: CallGraphData['stats'] }) => void
  addEdges: (edges: CallEdge[]) => void
  addNodes: (nodes: FunctionNode[]) => void
  setSelectedNode: (nodeId: string | null) => void
  focusNode: (id: string) => void
  goBack: () => void
  goForward: () => void
  toggleHighlightNode: (nodeId: string) => void
  setHighlightedNodes: (nodeIds: string[]) => void
  clearHighlights: () => void
  setSearchQuery: (query: string) => void
  setSearchResults: (results: FunctionNode[]) => void
  setLoading: (isLoading: boolean, progress?: number, message?: string) => void
  setError: (error: string | null) => void
  setProjectPath: (path: string | null) => void
  setAnalysisStatus: (status: 'idle' | 'analyzing' | 'ready' | 'error') => void
  setShowExternal: (value: boolean) => void
  toggleShowExternal: () => void
  setFileFilter: (path: string | null) => void
  pushPeek: (nodeId: string) => void
  popToPeek: (nodeId: string) => void
  setTransientPeekNode: (nodeId: string | null) => void
  clearAllPeeks: () => void
  markNodesLoaded: (ids: string[]) => void
  clearLoadedNodes: () => void
  clearGraph: () => void
  reset: () => void
}

const initialState = {
  nodes: [],
  edges: [],
  stats: null,
  selectedNodeId: null,
  highlightedNodeIds: [],
  focusHistory: [] as string[],
  forwardHistory: [] as string[],
  searchQuery: '',
  searchResults: [],
  isLoading: false,
  loadingProgress: 0,
  loadingMessage: '',
  error: null,
  currentProjectPath: null,
  analysisStatus: 'idle' as const,
  showExternal: false,
  fileFilter: null,
  peekStack: [] as string[],
  transientPeekNodeId: null,
  loadedNodeIds: [] as string[],
}

export const useGraphStore = create<GraphState>((set, get) => ({
  ...initialState,

  setGraphData: (data) => set({
    nodes: data.nodes,
    edges: data.edges,
    stats: data.stats,
    analysisStatus: 'ready',
    error: null,
  }),

  addEdges: (newEdges) => set((state) => {
    // Deduplicate edges by source+target+edgeKind
    const existingKeys = new Set(state.edges.map(e => `${e.source}:${e.target}:${e.edgeKind ?? 'call'}`))
    const uniqueNew = newEdges.filter(e => !existingKeys.has(`${e.source}:${e.target}:${e.edgeKind ?? 'call'}`))

    if (uniqueNew.length === 0) return state

    return {
      edges: [...state.edges, ...uniqueNew],
    }
  }),

  addNodes: (newNodes) => set((state) => {
    const existingIds = new Set(state.nodes.map(n => n.id))
    const uniqueNew = newNodes.filter(n => !existingIds.has(n.id))
    if (uniqueNew.length === 0) return state
    console.log(`[Store] Adding ${uniqueNew.length} new nodes (was ${state.nodes.length})`)
    return {
      nodes: [...state.nodes, ...uniqueNew],
    }
  }),

  setSelectedNode: (nodeId) => set({
    selectedNodeId: nodeId,
  }),

  focusNode: (id) => set((state) => {
    const oldId = state.selectedNodeId
    console.log(`[Store] focusNode: ${oldId} -> ${id}`)
    if (oldId !== null && oldId !== id) {
      return {
        selectedNodeId: id,
        focusHistory: [...state.focusHistory, oldId],
        forwardHistory: [],
      }
    }
    return { selectedNodeId: id }
  }),

  goBack: () => set((state) => {
    if (state.focusHistory.length === 0) {
      console.log('[Store] goBack to null')
      return { selectedNodeId: null }
    }
    const history = [...state.focusHistory]
    const popped = history.pop()!
    console.log(`[Store] goBack to ${popped}`)
    return {
      selectedNodeId: popped,
      focusHistory: history,
      forwardHistory: state.selectedNodeId !== null
        ? [...state.forwardHistory, state.selectedNodeId]
        : state.forwardHistory,
    }
  }),

  goForward: () => set((state) => {
    if (state.forwardHistory.length === 0) {
      console.log('[Store] goForward: no forward history')
      return {}
    }
    const forward = [...state.forwardHistory]
    const popped = forward.pop()!
    console.log(`[Store] goForward to ${popped}`)
    return {
      selectedNodeId: popped,
      forwardHistory: forward,
      focusHistory: state.selectedNodeId !== null
        ? [...state.focusHistory, state.selectedNodeId]
        : state.focusHistory,
    }
  }),

  toggleHighlightNode: (nodeId) => set((state) => {
    const isHighlighted = state.highlightedNodeIds.includes(nodeId)
    return {
      highlightedNodeIds: isHighlighted
        ? state.highlightedNodeIds.filter(id => id !== nodeId)
        : [...state.highlightedNodeIds, nodeId],
    }
  }),

  setHighlightedNodes: (nodeIds) => set({
    highlightedNodeIds: nodeIds,
  }),

  clearHighlights: () => set({
    highlightedNodeIds: [],
  }),

  setSearchQuery: (query) => set({
    searchQuery: query,
  }),

  setSearchResults: (results) => set({
    searchResults: results,
  }),

  setLoading: (isLoading, progress = 0, message = '') => set({
    isLoading,
    loadingProgress: progress,
    loadingMessage: message,
  }),

  setError: (error) => set({
    error,
    analysisStatus: error ? 'error' : get().analysisStatus,
  }),

  setProjectPath: (path) => set({
    currentProjectPath: path,
  }),

  setAnalysisStatus: (status) => set({
    analysisStatus: status,
  }),

  setShowExternal: (value) => set({
    showExternal: value,
  }),

  toggleShowExternal: () => set((state) => ({
    showExternal: !state.showExternal,
  })),

  setFileFilter: (path) => set({
    fileFilter: path,
  }),

  pushPeek: (nodeId) => set((state) => {
    if (state.peekStack.includes(nodeId)) return state  // already in stack
    return { peekStack: [...state.peekStack, nodeId] }
  }),

  popToPeek: (nodeId) => set((state) => {
    const idx = state.peekStack.indexOf(nodeId)
    if (idx === -1) return state
    // Remove nodeId and all deeper entries
    return { peekStack: state.peekStack.slice(0, idx) }
  }),

  setTransientPeekNode: (nodeId) => set({
    transientPeekNodeId: nodeId,
  }),

  clearAllPeeks: () => set({
    peekStack: [],
    transientPeekNodeId: null,
  }),

  markNodesLoaded: (ids) => set((state) => ({
    loadedNodeIds: [...new Set([...state.loadedNodeIds, ...ids])],
  })),

  clearLoadedNodes: () => set({
    loadedNodeIds: [],
  }),

  clearGraph: () => set({
    nodes: [],
    edges: [],
    stats: null,
    selectedNodeId: null,
    focusHistory: [],
    forwardHistory: [],
    highlightedNodeIds: [],
    searchResults: [],
    showExternal: false,
    peekStack: [],
    transientPeekNodeId: null,
    fileFilter: null,
    analysisStatus: 'idle',
    error: null,
    loadedNodeIds: [],
  }),

  reset: () => set(initialState),
}))

// Selectors
export const selectSelectedNode = (state: GraphState): FunctionNode | null => {
  if (!state.selectedNodeId) return null
  return state.nodes.find(n => n.id === state.selectedNodeId) ?? null
}

export const selectNodeById = (nodeId: string) => (state: GraphState): FunctionNode | null => {
  return state.nodes.find(n => n.id === nodeId) ?? null
}

export const selectFilteredNodes = (state: GraphState): FunctionNode[] => {
  const query = state.searchQuery.toLowerCase().trim()
  if (!query) return state.nodes
  return state.nodes.filter(n =>
    n.name.toLowerCase().includes(query) ||
    n.filePath.toLowerCase().includes(query) ||
    n.module.toLowerCase().includes(query)
  )
}

export const selectHighlightedNodes = (state: GraphState): FunctionNode[] => {
  return state.nodes.filter(n => state.highlightedNodeIds.includes(n.id))
}

export const selectTopCalled = (state: GraphState): Array<{ name: string; count: number }> => {
  return state.stats?.topCalled ?? []
}

export const selectTopCallers = (state: GraphState): Array<{ name: string; count: number }> => {
  return state.stats?.topCallers ?? []
}

export const selectVisiblePeekNodeIds = (state: GraphState): Set<string> => {
  const ids = new Set(state.peekStack)
  if (state.transientPeekNodeId) ids.add(state.transientPeekNodeId)
  return ids
}
