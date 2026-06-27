import { useEffect, useCallback, useRef } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import type { FunctionNode, CallEdge, CallGraphData } from '../types/graph'

export interface LSPAPI {
  ping: () => Promise<{ status: string; timestamp: number }>
  analyzeProject: (projectPath: string) => Promise<{
    nodes: FunctionNode[]
    filesProcessed: number
    totalFiles: number
    stats: { totalFunctions: number; filesProcessed: number }
  }>
  getEdgesForNode: (nodeJson: string) => Promise<{ incoming: CallEdge[]; outgoing: CallEdge[]; newNodes: FunctionNode[] }>
  getEdgesForNodes: (nodesJson: string) => Promise<{ edges: CallEdge[]; newNodes: FunctionNode[]; functionsProcessed: number; totalFunctions: number }>
  getCompleteGraph: (projectPath: string) => Promise<CallGraphData>
  getFunctionStats: (nodeJson: string) => Promise<any>
  shutdownLSP: () => Promise<{ status: string }>
  onProgress: (callback: (progress: number, message: string) => void) => () => void
  onError: (callback: (error: string) => void) => () => void
  logToFile: (level: string, message: string) => void
}

declare global {
  interface Window {
    electronAPI: LSPAPI
  }
}

/**
 * Hook that bridges IPC events from the main process to the Zustand store.
 * Also provides actions for the renderer to call LSP operations.
 */
export function useLSPClient() {
  const api = window.electronAPI
  const cleanupRef = useRef<Array<() => void>>([])

  const {
    setGraphData,
    addEdges,
    addNodes,
    setLoading,
    setError,
    setProjectPath,
    setAnalysisStatus,
    clearGraph,
    reset,
    nodes,
  } = useGraphStore()

  // Subscribe to IPC progress/error events on mount
  useEffect(() => {
    const cleanupProgress = api.onProgress((progress, message) => {
      useGraphStore.getState().setLoading(true, progress, message)
    })

    const cleanupError = api.onError((error) => {
      useGraphStore.getState().setError(error)
      useGraphStore.getState().setLoading(false)
    })

    cleanupRef.current = [cleanupProgress, cleanupError]

    return () => {
      cleanupProgress()
      cleanupError()
    }
  }, [api])

  /**
   * Analyze a Rust project: scans files, discovers nodes.
   */
  const analyzeProject = useCallback(async (projectPath: string) => {
    setLoading(true, 0, 'Starting analysis...')
    setAnalysisStatus('analyzing')
    setProjectPath(projectPath)
    setError(null)
    clearGraph()

    try {
      const result = await api.analyzeProject(projectPath)

      // Convert to store format
      setGraphData({
        nodes: result.nodes,
        edges: [],
        stats: {
          totalFunctions: result.stats.totalFunctions,
          totalEdges: 0,
          isolatedFunctions: result.nodes.length, // All isolated initially
          maxCallDepth: 0,
          topCalled: [],
          topCallers: [],
        },
      })

      setLoading(false, 100, 'Analysis complete')
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setLoading(false)
      setAnalysisStatus('error')
      throw err
    }
  }, [api, setGraphData, setLoading, setError, setProjectPath, setAnalysisStatus, clearGraph])

  /**
   * Load edges for a specific node (on-demand, Phase 6).
   */
  const loadEdgesForNode = useCallback(async (node: FunctionNode) => {
    try {
      const result = await api.getEdgesForNode(JSON.stringify(node))
      console.log(`[useLSP] loadEdgesForNode: ${node.name} → ${result.incoming.length} incoming, ${result.outgoing.length} outgoing, ${result.newNodes?.length ?? 0} new nodes`)
      // First add any new nodes discovered via call hierarchy (required by D3 force)
      if (result.newNodes && result.newNodes.length > 0) {
        addNodes(result.newNodes)
      }
      addEdges([...result.incoming, ...result.outgoing])
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to load edges:', message)
      throw err
    }
  }, [api, addEdges, addNodes])

  /**
   * Load edges for multiple nodes (bulk).
   */
  const loadEdgesForNodes = useCallback(async (targetNodes: FunctionNode[]) => {
    try {
      const result = await api.getEdgesForNodes(JSON.stringify(targetNodes))
      console.log(`[useLSP] loadEdgesForNodes batch: ${result.edges.length} edges, ${result.newNodes?.length ?? 0} new nodes`)
      if (result.newNodes && result.newNodes.length > 0) {
        addNodes(result.newNodes)
      }
      addEdges(result.edges)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to load edges:', message)
      throw err
    }
  }, [api, addEdges, addNodes])

  /**
   * Build the complete graph (all nodes + all edges).
   */
  const buildCompleteGraph = useCallback(async (projectPath: string) => {
    setLoading(true, 0, 'Building complete graph...')
    setAnalysisStatus('analyzing')

    try {
      const fullGraph = await api.getCompleteGraph(projectPath)
      setGraphData(fullGraph)
      setLoading(false, 100, 'Complete graph ready')
      return fullGraph
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setLoading(false)
      setAnalysisStatus('error')
      throw err
    }
  }, [api, setGraphData, setLoading, setError, setAnalysisStatus])

  /**
   * Shutdown the LSP client.
   */
  const shutdownLSP = useCallback(async () => {
    try {
      await api.shutdownLSP()
      reset()
    } catch (err) {
      console.error('Failed to shutdown LSP:', err)
    }
  }, [api, reset])

  /**
   * Ping the backend.
   */
  const ping = useCallback(async () => {
    return await api.ping()
  }, [api])

  return {
    analyzeProject,
    loadEdgesForNode,
    loadEdgesForNodes,
    buildCompleteGraph,
    shutdownLSP,
    ping,
  }
}
